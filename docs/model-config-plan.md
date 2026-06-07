# 模型接入升级方案(本机 CLI + BYOK)

参考 open-design 的「执行模式」设置面板,把 RepoHelm 设置里的「大模型接入」tab 升级为
**本机 CLI / BYOK** 两个子模式,支持:扫描本机 CLI、显示版本、按 CLI 选择模型、连接测试、
重新扫描;以及 BYOK(自带 API Key)的 provider 配置与持久化。

## 参考来源
open-design 的实现要点(`apps/daemon/src/runtimes/`):
- 每个 CLI 一份 **runtime def**:`{ id, name, bin, fallbackBins, versionArgs, listModels{args,parse}, fallbackModels }`。
- 探测:`which <bin>` + `<bin> --version`,取首行作为版本。
- 模型:优先跑 `<bin> models` 实时拉取,失败回退到 `fallbackModels`;列表首项恒为合成的
  `Default (CLI config)`。
- 测试:运行一次轻量调用,记录延迟,banner 显示「在 X 毫秒内响应」。
- BYOK:独立的 provider 模型配置。

RepoHelm 架构更简单(core / server(Hono) / web(React)),按其风格落地,不照搬 daemon。

## 数据模型(packages/core/src/types.ts)
```ts
interface CliModelOption { id: string; label: string; }
interface LocalCliInfo {
  id: string;            // claude-code / codex-cli / gemini-cli / opencode
  name: string;          // Claude Code
  tagline: string;       // Anthropic official CLI
  bin: string;           // claude
  available: boolean;    // 是否在 PATH 中
  version?: string;      // 2.1.167
  models: CliModelOption[]; // 含 Default(CLI config) 在首位
  modelsLive: boolean;   // 是否实时拉取(否=内置默认列表)
  detail: string;
}
interface EngineConfig {
  mode: "cli" | "byok";
  cliId: string;                       // 当前选中的本机 CLI
  cliModels: Record<string, string>;   // 每个 CLI 选中的 model id
  byok: { provider: string; baseUrl: string; model: string; apiKey: string };
  updatedAt: string;
}
// RepoHelmState 增加 engine: EngineConfig
```

## CLI 注册表(新文件 packages/core/src/cli.ts)
- `CLI_DEFINITIONS`:claude-code(claude)、codex-cli(codex)、gemini-cli(gemini)、opencode(opencode),
  各带 tagline、versionArgs、listModels 命令、fallbackModels。
- `detectCli(def, {refresh})`:探测 which+version;refresh 时跑 listModels(带超时,失败回退);
  非 refresh 用 fallbackModels(快)。
- `testCli(def)`:跑一次 `<bin> --version`(连通性 + 延迟探测,**不调用模型、不耗 token、不交互**),
  返回 `{ ok, latencyMs, message }`。这是相对 open-design 的安全收敛,plan 里显式说明。

## service(packages/core/src/service.ts)
- `listLocalClis(refresh=false): Promise<LocalCliInfo[]>`
- `testLocalCli(id): Promise<{ ok; latencyMs; message }>`
- `getEngine(): EngineConfig` / `updateEngine(patch): EngineConfig`
- bootstrap / normalizeState 注入 engine 默认值(mode=cli, cliId=claude-code, byok 默认 OpenAI)。

## server(apps/server/src/index.ts)
- `GET  /api/clis`            → 列表(内置默认模型,快)
- `POST /api/clis/rescan`     → 列表(refresh=true,实时拉模型)
- `POST /api/clis/:id/test`   → 连通性测试 + 延迟
- `GET  /api/engine`          → EngineConfig
- `PATCH /api/engine`         → 更新(mode / cliId / cliModels / byok)

## web(apps/web)
- api.ts:类型 + `listClis()` / `rescanClis()` / `testCli(id)` / `getEngine()` / `updateEngine()`。
- App.tsx:把设置里的「大模型接入」tab 改为「执行模式」,内部 seg-control 切 **本机 CLI / BYOK**。
  - 本机 CLI:`你的 CLI (N)` + 重新扫描;每个 CLI 一张卡片(图标/名称/tagline/版本 + 测试按钮);
    点击卡片选中(accent 左条 + 展开「模型」Radix 下拉);测试结果 banner(绿/红)。
  - BYOK:保留 provider 快填 + apiKey/baseUrl/model 表单,改为持久化到 engine.byok。
  - 选中状态、模型选择、BYOK 表单都通过 `PATCH /api/engine` 持久化。
- styles.css:`.cli-card`(选中态左条/展开)、`.seg-control`(子 tab)、`.cli-test-banner`(绿/红)等,
  全部走现有 token,深浅主题自适配。

## 验收标准(用户 review 用)
1. 设置 → 执行模式 显示 本机 CLI / BYOK 两个子 tab。
2. 本机 CLI 列出已知 CLI,检测到的显示版本(未检测到显示「未检测到」)。
3. 点卡片可选中(accent 左条),展开模型下拉(Radix,主题化),首项为 Default (CLI config)。
4. 重新扫描:重新探测,尝试实时拉模型(失败回退内置)。
5. 测试:显示「<CLI> 在 X 毫秒内响应」绿条 / 失败红条。
6. BYOK:provider 快填 + apiKey(可隐藏)/baseUrl/model,保存后持久化(刷新后仍在)。
7. 选中的 CLI/模型与 BYOK 配置持久化到 SQLite state。
8. typecheck / 单测 / e2e / 构建全绿;深浅主题下都协调。

## 明确不在本次范围
- 不改 Quest 执行链路真正消费 engine(composer 仍可独立选 backend);仅打通配置与持久化,
  后续可把 engine.cliId 作为新建 Quest 的默认 backend。
- 测试为连通性/延迟探测,不真正调用模型(避免 token 消耗与交互式卡住)。
- BYOK apiKey 以明文存于本地 SQLite(本地优先工具);生产级密钥保管为后续项。
