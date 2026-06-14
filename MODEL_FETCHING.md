# 真实模型列表获取方案

> 目标:把设置里「执行模式」的模型下拉,从当前硬编码的内置回退值,升级为**从真实来源拉取**。
> 覆盖两条链路:**BYOK**(直连提供商 REST `/models`)与**本机 CLI**(命令/配置文件)。
>
> 前置背景:「执行模式」面板(本机 CLI / BYOK 两个子模式)的引擎配置与持久化设计见姊妹文档
> [`docs/model-config-plan.md`](docs/model-config-plan.md);本文档承接其遗留的「模型写死」问题。
>
> **状态:已实现(2026-06-07)。** 落点见 `packages/core/src/providers.ts`(ProviderRegistry +
> 6 类 provider parse + 缓存)、`service.ts` 的 `listProviders/listProviderModels`(SQLite 缓存 TTL 6h)、
> server `GET /api/providers` + `POST /api/providers/:id/models`、web BYOK 面板的实时模型下拉 + 刷新。
> CLI 模式经 `cli.ts` 的 `providerId` 映射,用对应 env key(如 `ANTHROPIC_API_KEY`)拉取实时模型。
> 单测 `providers.test.ts`(7 例 mock fetch);真实验证:OpenRouter 免鉴权返回 341 个实时模型。

---

## 0. 现状与问题

| 来源 | 现状 | 是否真实 |
| --- | --- | --- |
| CLI 名称 / 版本 | `which` + `--version` 实时探测 | ✅ 真实 |
| OpenCode 模型 | `opencode models` 实时拉取 | ✅ 真实 |
| Claude / Codex / Gemini CLI 模型 | `CLI_DEFINITIONS[].fallbackModels` 硬编码 | ❌ 写死 |
| BYOK 模型 | 用户手填一个字符串 | ❌ 无校验、无列表 |

核心结论:**官方 CLI(claude/codex/gemini)没有「列模型」子命令**,无法靠命令枚举。要拿真实列表只有两条路——
1. 走**提供商 REST API**(BYOK 模式天然适配,因为已经有 apiKey + baseUrl);
2. **解析 CLI 的本地配置/缓存文件**(各家格式不同,维护成本高,作为补充)。

因此主推方案:**以 BYOK 的 `/models` REST 拉取为一等公民;CLI 模式复用同一份提供商目录做映射**。

---

## 1. 各提供商 `/models` 接口速查

所有主流提供商都提供「列模型」REST 接口,且绝大多数遵循 OpenAI 兼容格式 `GET /v1/models` → `{ data: [{ id, ... }] }`。

### 1.1 OpenAI
```
GET https://api.openai.com/v1/models
Authorization: Bearer <API_KEY>
```
返回 `{ object, data: [{ id, object, created, owned_by }] }`。`id` 即 `--model` 可用值(如 `gpt-4o`, `o4-mini`)。

### 1.2 Anthropic(Claude)
```
GET https://api.anthropic.com/v1/models
x-api-key: <API_KEY>
anthropic-version: 2023-06-01
```
返回 `{ data: [{ id, display_name, created_at, type }] }`。`id` 如 `claude-opus-4-20250514`、`claude-sonnet-4-5`。
> 注意:**Claude Code CLI 用的别名**(`sonnet`/`opus`/`haiku`)不在此列表,需要额外补充为「快捷别名」分组。

### 1.3 Google Gemini
```
GET https://generativelanguage.googleapis.com/v1beta/models?key=<API_KEY>
```
返回 `{ models: [{ name: "models/gemini-2.5-pro", displayName, supportedGenerationMethods }] }`。
- `name` 带 `models/` 前缀,取值时 strip 掉。
- 建议按 `supportedGenerationMethods` 包含 `generateContent` 过滤,排除 embedding / aqa 等非对话模型。

### 1.4 DeepSeek(OpenAI 兼容)
```
GET https://api.deepseek.com/models
Authorization: Bearer <API_KEY>
```
返回 OpenAI 格式。`id` 如 `deepseek-chat`、`deepseek-reasoner`。

### 1.5 OpenRouter(聚合,**列表免鉴权**)
```
GET https://openrouter.ai/api/v1/models
```
无需 key 即可列全量(数百个)。返回 `{ data: [{ id, name, context_length, pricing }] }`。`id` 形如 `anthropic/claude-3.7-sonnet`。
> 适合做「探索/选型」入口,但量大,UI 需搜索过滤。

### 1.6 其它 OpenAI 兼容(xAI / Groq / Together / Moonshot / 本地 vLLM / Ollama 等)
统一走 `GET {baseUrl}/models`,鉴权 `Authorization: Bearer <key>`(本地服务可能无需 key)。
- Ollama 另有原生 `GET http://localhost:11434/api/tags`。

### 汇总表

| Provider | Endpoint | Auth | 响应根 | id 处理 |
| --- | --- | --- | --- | --- |
| OpenAI | `{base}/models` | `Bearer` | `data[].id` | 直接用 |
| Anthropic | `{base}/models` | `x-api-key` + `anthropic-version` | `data[].id` | 直接用;另补 alias 分组 |
| Gemini | `{base}/models?key=` | query `key` | `models[].name` | strip `models/` + 过滤 generateContent |
| DeepSeek | `{base}/models` | `Bearer` | `data[].id` | 直接用 |
| OpenRouter | `{base}/models` | 可空 | `data[].id` | 直接用(量大,需搜索) |
| OpenAI 兼容 | `{base}/models` | `Bearer`(可空) | `data[].id` | 直接用 |

---

## 2. 设计:统一 Provider Catalog 抽象

在 `packages/core` 新增 provider 适配层,把"各家差异"收敛到一处。

```ts
// packages/core/src/providers.ts
export interface ProviderDef {
  id: "openai" | "anthropic" | "gemini" | "deepseek" | "openrouter" | "openai-compatible";
  name: string;
  defaultBaseUrl: string;
  /** 列模型请求的构造:头、query、解析。 */
  listModels: {
    path: string;                  // 相对 baseUrl,如 "/models"
    auth: "bearer" | "x-api-key" | "query-key" | "none";
    extraHeaders?: Record<string, string>;
    parse: (body: unknown) => CliModelOption[];
  };
  /** 不依赖网络的内置回退(离线/限流时兜底)。 */
  fallbackModels: CliModelOption[];
}
```

- `fetchProviderModels(provider, { apiKey, baseUrl })`:用 `fetch`(Node 20+ 原生)发请求,超时 + 单次重试,失败回退 `fallbackModels` 并在 `detail` 里如实标注「实时/内置」。
- 复用现有 `CliModelOption { id, label }`;实时项加 `live: true` 标记,UI 可加「实时」徽标。
- **缓存**:结果写入 SQLite(`state.modelCache[providerId] = { fetchedAt, models }`),TTL 默认 6h;首屏读缓存秒开,后台静默刷新(stale-while-revalidate)。

### CLI 模式如何复用

CLI(claude/codex/gemini)虽无列模型命令,但其**底层就是对应提供商**:

| CLI | 映射 Provider | 取真实列表方式 |
| --- | --- | --- |
| claude-code | anthropic | 若用户在 BYOK/设置里提供了 Anthropic key → 走 REST;否则只展示别名分组 + 内置 |
| codex-cli | openai | 同上(OpenAI key) |
| gemini-cli | gemini | 同上(Gemini key) |
| opencode | (自带) | 维持 `opencode models` 实时拉取 |

即:**CLI 卡片的模型列表 = 别名分组(CLI 专属,如 sonnet/opus)+ 该提供商 REST 实时列表(若有可用 key)**。无 key 时退回内置,并提示「填入 API Key 可拉取实时模型」。

---

## 3. 落地步骤(建议顺序)

1. **core**:新增 `providers.ts`(ProviderDef + `fetchProviderModels`);为 6 类 provider 写 parse。
2. **types**:`CliModelOption` 加可选 `live?: boolean`、`group?: "alias" | "live" | "builtin"`;`RepoHelmState` 加 `modelCache`。
3. **service**:`listProviderModels(providerId, { refresh })`,带缓存 + TTL;BYOK 保存后自动触发一次拉取。
4. **server**:`GET /api/providers/:id/models?refresh=1`(用当前 engine.byok 的 key/baseUrl,或显式传入)。
5. **web**:
   - BYOK 表单:provider 下拉选定后,模型字段从「输入框」升级为「Radix Select + 搜索」,数据来自 `/api/providers/:id/models`;右侧「刷新」按钮强制 `refresh=1`;实时项带徽标。
   - CLI 卡片:模型下拉 = 别名分组 + 实时分组(来自映射 provider),沿用现有 UI。
6. **测试**:`fetchProviderModels` 用 mock fetch 做单测(各家响应样例固定);e2e 用 API 注入避免真实网络。

---

## 4. 安全与边界

- **API Key**:目前明文存本地 SQLite(已知项)。`/models` 请求仅发往官方 `baseUrl`,**不经过任何第三方**;日志里脱敏 key。
- **网络**:全部带超时(默认 10s)+ 单次重试;失败**永不报错阻塞 UI**,静默回退内置并标注。
- **不耗 token**:`/models` 是元数据接口,不产生推理计费。
- **限流**:命中缓存优先;`refresh` 才打网络;OpenRouter 全量较大,前端必须可搜索。
- **CLI 别名真实性**:`sonnet/opus/haiku` 是 Claude Code 真实接受的别名(保留);手填的全名 ID 改为只在 REST 实时列表里出现,避免"猜"。

---

## 5. 不做 / 暂缓

- 解析各 CLI 的本地配置文件(`~/.claude`、codex config 等)枚举模型:格式私有、易随版本漂移,**不作为主路径**,仅在用户完全无 key 且强需求时再评估。
- 模型能力/价格元数据展示(context length、$/Mtok):OpenRouter / Gemini 返回里有,后续可作为选型增强。

---

*关联:`docs/model-config-plan.md`(执行模式整体规划)、`packages/core/src/cli.ts`(现有 CLI 探测)。*
