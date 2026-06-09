# 仓库绑定知识库（Repo-Bound Knowledge Base）设计

> 状态：已与产品方确认设计方向，待评审实现计划。
> 日期：2026-06-09
> 关联：`docs/architecture.md`、`MODEL_FETCHING.md`、内部调研《Agent Memory Landscape》。

## 1. 背景与目标

### 现状（为什么现在的知识库不可用）

- 知识以 `KnowledgeItem[]` 存在整块 `RepoHelmState` SQLite blob 里，并镜像为 `.repohelm/knowledge/<type>/*.md`。
- 唯一的「仓库知识」是一行 `Repo Summary`（路径 + 默认分支，见 `packages/core/src/knowledge.ts:23`），**从不从代码里提取任何真实内容**。
- 知识归属于 **workspace**（`KnowledgeItem.workspaceId`），但仓库是**全局**的——归属错位。
- 检索是朴素子串匹配（`searchKnowledgeItems`，`packages/core/src/service.ts:1744`），仅用于给 Quest spec 注入「top 3 相关」。
- 没有触发机制、没有增量更新、没有「已索引到 commit X」的概念。

### 目标

把知识库重做成**与仓库绑定、随主干提交增量维护的结构化 Repo Wiki**：

1. 知识库挂在 **Project（仓库）** 下，并绑定一个真相分支。
2. 打开知识库面板时**懒检测**新提交，提示用户确认后跑增量更新。
3. 内容是**固定主题的结构化 wiki 页**，Markdown 即真相源。
4. 检索用 **embedding 向量**（未配置时降级到关键词）。

### 非目标（v1 明确不做）

- 不做后台守护进程 / 自动定时索引。
- 不侵入用户仓库的 `.git/hooks`。
- 不做 GitHub webhook / 远端 PR 事件监听。
- 不做 wiki 页的人工在线编辑（Markdown 文件可手改，但 UI 不提供编辑器）。
- 不做 sqlite-vec 等原生向量扩展（MVP 规模用 JS 算 cosine）。
- 不做完整知识图谱 / 三阶段混合检索（关键词预筛 + 向量重排留作未来）。

## 2. 设计决策（已确认）

| 维度 | 决策 |
| --- | --- |
| 触发机制 | 打开面板时懒检测 `lastIndexedSha..HEAD`，有新提交则提示，用户确认才跑增量。 |
| 内容模型 | 结构化 Repo Wiki，每仓库一套固定主题页。 |
| 检索 | embedding 向量检索；未配置 embedding ModelKit 时降级到现有关键词匹配。 |
| embedding 来源 | EngineConfig 新增专用 **embedding ModelKit**（BYOK，OpenAI-compatible `/embeddings`）。 |
| 存储 | Markdown 文件 = 真相源；SQLite 存元数据 + `lastIndexedSha` + 向量。 |

## 3. 数据模型

### 3.1 Project 扩展

`packages/core/src/types.ts` 的 `Project` 增加知识库绑定字段：

```ts
interface Project {
  // ...现有字段
  knowledgeBranch?: string;        // KB 真相分支，默认 = defaultBranch
  knowledge?: {
    lastIndexedSha?: string;       // 上次索引到的 commit
    lastIndexedAt?: string;        // ISO 时间戳
    status: "empty" | "indexing" | "ready" | "stale" | "error";
    error?: string;                // status === "error" 时的原因
  };
}
```

`status` 语义：

- `empty`：从未索引（无 wiki 页）。
- `indexing`：正在 bootstrap 或增量更新（串行锁内）。
- `ready`：已索引且 `lastIndexedSha === HEAD`。
- `stale`：已索引但检测到新提交（`lastIndexedSha !== HEAD`）。注意：`stale` 由懒检测在读取时**计算**得出，不必持久化；持久化的是 `ready`，UI 比对 HEAD 后渲染为 stale。
- `error`：上次索引失败。

### 3.2 RepoWikiPage 实体

取代空洞的 `Repo Summary`：

```ts
interface RepoWikiPage {
  id: string;                      // wiki_<projectId>_<slug>
  projectId: string;               // 绑定仓库
  slug: RepoWikiSlug;
  title: string;
  body: string;                    // Markdown，真相源
  sourcePath: string;              // .repohelm/knowledge/<projectId>/<slug>.md
  updatedAtSha?: string;           // 这页最后被哪个 commit 更新
  updatedAt: string;
}

type RepoWikiSlug =
  | "overview"      // 一句话定位 + 技术栈
  | "architecture"  // 跨文件结构
  | "modules"       // 模块拆解
  | "key-flows"     // 关键流程
  | "conventions"   // 代码约定 / 规范
  | "decisions";    // 决策日志（追加式，带 commit 引用）
```

固定 6 页主题。`decisions` 页是**追加式**——每次增量在顶部插入一条带 `(commit <shortSha>)` 引用的决策项，为调研文档强调的「温度 / 何时被推翻」留口子。

### 3.3 向量存储

SQLite 新表（或 state blob 内的并列结构，实现时择一，倾向独立表以免膨胀主 blob）：

```ts
interface WikiChunkEmbedding {
  id: string;                      // chunk_<pageId>_<idx>
  projectId: string;
  pageId: string;                  // RepoWikiPage.id
  slug: RepoWikiSlug;
  chunkText: string;
  vector: number[];                // 存为 Float32 blob
  model: string;                   // 生成该向量的 embedding 模型，便于模型切换时失效
  createdAt: string;
}
```

> 实现注记：`SqliteStateStore` 当前是整块 blob 读改写。向量数据体积大、变更频繁，**不应**塞进主 blob。在 `.repohelm/state.sqlite` 里新建独立表（`wiki_pages`、`wiki_embeddings`），与现有 state blob 共库但分表；服务层照旧通过 `_mutationQueue` 串行化写入。

### 3.4 EngineConfig：embedding ModelKit

`EngineConfig` 增加可选的 embedding ModelKit 引用（与现有 ModelKit 机制一致）：

```ts
interface EngineConfig {
  // ...现有
  embeddingModelKitId?: string;    // 指向一个 BYOK ModelKit；未设则检索降级
}
```

`llm.ts` 增加 `embed(texts: string[]): Promise<number[][]>`，走 OpenAI-compatible `/embeddings`，由 embedding ModelKit 解析 baseUrl/model/apiKey。

## 4. 索引管线

新建 `packages/core/src/repo-wiki.ts`，封装 bootstrap 与增量逻辑；`RepoHelmService` 上新增对应方法（符合「方法属于 service」原则）。全程走现有 `_mutationQueue` 串行化，LLM 走现有 `llm.ts`。

### 4.1 首次索引（bootstrap，无 `lastIndexedSha`）

1. 读仓库结构：`git ls-files`（限定 `knowledgeBranch`）取文件树 + 体积分布；启发式挑关键文件（README、`package.json` / `Cargo.toml` / `pyproject.toml` 等清单、入口文件、顶层配置）。
2. 一次 LLM 调用，产出 6 页初始 wiki。超大仓库：分批喂目录树 + 关键文件摘要。
3. 写 6 个 `.md`（`KnowledgeFileStore` 扩展为按 `projectId/slug` 写）→ 每页分 chunk → embedding → 存 `wiki_embeddings`。
4. `lastIndexedSha = 当前 HEAD`，`status = "ready"`，各页 `updatedAtSha = HEAD`。

### 4.2 增量更新（有 `lastIndexedSha`，检测到新提交）

1. `git log/diff lastIndexedSha..HEAD`（限定 `knowledgeBranch`）→ 拿 commit 列表（message + SHA）+ 文件级 diff。
2. **超大 diff 防护**：总 diff 超阈值（如 token 估算上限）时，只喂「文件清单 + commit message + 每文件 diff 摘要（首尾 N 行 / hunk 头）」，不喂全量。
3. 一次 LLM 调用：输入 = 当前 6 页内容 + 这段 diff/commit → 输出结构化结果：`{ updatedPages: {slug, body}[], decisionEntry?: string }`。
4. 只重写受影响的页 + 只重算这些页的 embedding（删旧 chunk 再插新 chunk）。`decisions` 页在顶部追加 `decisionEntry`（带 short SHA）。
5. `lastIndexedSha = HEAD`，受影响页 `updatedAtSha = HEAD`，`status = "ready"`。
6. 任一步失败 → `status = "error"` + `error` 文案，不破坏已有 wiki。

### 4.3 懒检测（读取时计算）

`getProjectKnowledge(projectId)` 在返回前：

1. `git rev-parse <knowledgeBranch>` 取 HEAD。
2. 若 `HEAD !== lastIndexedSha`：`git rev-list --count lastIndexedSha..HEAD` 算待更新 commit 数，返回 `{ status: "stale", pendingCommits: N, head }`。
3. 仓库不可达 / 非 git → 复用现有 `ProjectHealth` 语义，返回对应错误态，不抛。

## 5. 检索与消费

替换 `service.ts:1744` 的 substring 函数：

1. query → `embed([query])` → 对该仓库（或相关仓库集合）所有 `wiki_embeddings` 算 cosine → top-k chunk → 回溯所属 `RepoWikiPage`。
2. **降级**：`embeddingModelKitId` 未配置或 `embed` 失败 → 回退到关键词匹配（保留现有逻辑），不阻塞主流程。
3. **模型一致性**：检索时用当前 embedding 模型；若 chunk 的 `model` 与当前不符，视为需重建（标记 `stale` 或检索时忽略并提示重建）。
4. **Quest spec 消费**：从 workspace 的 `projectIds` 出发，对相关仓库检索注入（替换现有 `relatedKnowledge` 来源，`service.ts:1007`）。

## 6. 服务层与 API

### 6.1 RepoHelmService 新增方法

- `getProjectKnowledge(projectId)` → 6 页 + 状态 + 懒检测的 `pendingCommits`。
- `syncProjectKnowledge(projectId)` → 无 `lastIndexedSha` 走 bootstrap，否则走增量。
- `setProjectKnowledgeBranch(projectId, branch)`。
- `searchProjectKnowledge(projectIds, query)` → 向量检索（降级关键词）。

### 6.2 Server 路由（thin Zod 层，`apps/server/src/index.ts`）

- `GET  /api/projects/:id/knowledge` → 6 页 + 状态 + 待更新 commit 数。
- `POST /api/projects/:id/knowledge/sync` → bootstrap 或增量（异步：返回 `indexing`，前端轮询或重查）。
- `PATCH /api/projects/:id/knowledge` → 设 `knowledgeBranch`。

CORS / 路径解析沿用现有 `REPOHELM_KNOWLEDGE_ROOT` 等约定。

## 7. UI（`apps/web/src/App.tsx`，token 驱动样式）

- 知识库面板从「workspace 知识列表」改为**按仓库分组**展示 6 页 wiki。
- 每仓库顶部状态条：`status` + `lastIndexedAt`；懒检测发现 N 个新提交 → 显示「**有 N 个新提交，可更新知识库**」+ 更新按钮。
- 点更新 → `POST .../sync` → 显示 `indexing` → 完成后刷新。
- 全局设置「仓库管理」：绑定仓库时可设 `knowledgeBranch`；首次绑定后提供「建立知识库」按钮触发 bootstrap。
- 设置页 EngineConfig：新增「embedding ModelKit」配置项；未配置时知识库面板提示「向量检索未启用，当前用关键词检索」。
- 所有样式走 Tailwind v4 + CSS 变量 token，不硬编码颜色（见 `repohelm-ui-design-system`）。

## 8. 迁移

- 老的 workspace-scoped `KnowledgeItem`（`architecture seed`、`repo summary`）：store 迁移时**丢弃**（它们无真实价值），不转存。
- `.repohelm/knowledge/<type>/` 旧目录：保留不动（不删用户文件），新内容写入 `.repohelm/knowledge/<projectId>/`。
- `searchKnowledge(workspaceId)` 旧签名：保留为兼容入口或下线，实现时确认无其它调用方后择一。

## 9. 边界与错误处理

- 仓库路径缺失 / 非 git / 分支不存在 → 复用 `ProjectHealth`，面板显示对应错误态，不抛栈。
- LLM / embedding 调用失败 → `status = "error"`，保留上一版 wiki，可重试。
- 超大仓库 / 超大 diff → 摘要降级（§4.1、§4.2）。
- embedding 模型切换 → chunk 的 `model` 字段失配 → 提示重建。
- 并发：所有写经 `_mutationQueue`；`indexing` 期间拒绝重复 sync。

## 10. 测试

- 单测（vitest，core）：
  - 懒检测：构造 `lastIndexedSha != HEAD` → 正确算 `pendingCommits`。
  - 增量：mock LLM 返回 `updatedPages` → 只重写受影响页 + 重算其 embedding。
  - 检索降级：无 embedding ModelKit → 回退关键词。
  - cosine / top-k 排序正确性。
  - 迁移：旧 `KnowledgeItem` 被正确丢弃。
- 用真实 git 临时仓库（建仓 → commit → 改文件 → commit）验证 diff 抽取。
- e2e（Playwright）：绑定仓库 → bootstrap → 新提交 → 面板提示 → 点更新 → wiki 刷新。注意 e2e 用隔离 state dir，LLM/embedding 走 mock 注入（参考 `repohelm-delivery-validation-gap` 的 e2e 注入手法）。

## 11. 实现顺序建议

1. 数据模型（types + store 新表 + 迁移）。
2. `llm.embed` + embedding ModelKit 配置。
3. `repo-wiki.ts` bootstrap + 增量 + 懒检测。
4. service 方法 + server 路由。
5. 向量检索 + Quest 消费替换。
6. UI 面板 + 设置项。
7. 单测 + e2e。
