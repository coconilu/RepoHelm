# 合并文件与产物 Tab 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除"产物"tab，将其功能合并到"文件"tab；文件 tab 按 worktree 分组展示变更文件，每个 worktree 分组旁提供"打开目录"按钮（后端调 macOS `open` 命令）。

**Architecture:** 后端新增 `POST /api/quests/:questId/worktrees/:worktreeId/open` 路由执行 `open <worktreePath>`；前端删除 `DeliverablesPanel` 组件和 deliverables tab，重写 `FilesPanel` 为按 worktreePath 分组，每组显示 worktree 名+文件计数和"打开目录"按钮。

**Tech Stack:** Hono (server), React 19 + Framer Motion (web), TypeScript

---

### Task 1: 删除"产物" tab 和 DeliverablesPanel 组件

**Files:**
- Modify: `apps/web/src/App.tsx` — 删除 deliverables tab 定义、渲染、导入
- Delete: `apps/web/src/components/DeliverablesPanel.tsx`

- [ ] **Step 1: 删除 App.tsx 中 deliverables tab 的类型定义**

修改 `InspectorTab` 类型，移除 `"deliverables"`：

```ts
type InspectorTab = "spec" | "plan" | "overview" | "capabilities" | "files" | "diff" | "orchestration" | "progress" | "acceptance" | "references" | "research";
```

- [ ] **Step 2: 从 allTabs 数组中移除 deliverables 条目**

删除这一行：
```ts
{ id: "deliverables", label: "产物" },
```

- [ ] **Step 3: 从 visibleTabs 的 switch 中移除 deliverables case**

将 `visibleTabs` 过滤逻辑中的 `case "deliverables":` 及其相邻的 `"references"` / `"research"` 一起处理，让这三个 expert-only tabs 保持现状（deliverables 被删后只剩 references 和 research）：

```ts
      case "orchestration":
      case "progress":
      case "acceptance":
      case "references":
      case "research":
        return !!expertSession;
```

- [ ] **Step 4: 删除 deliverables 渲染分支**

删除这段：
```tsx
{effectiveTab === "deliverables" && expertSession ? (
  <DeliverablesPanel tasks={expertSession.flatTasks} />
) : null}
```

- [ ] **Step 5: 删除 DeliverablesPanel 的 import 语句**

在 App.tsx 顶部找到 `import { DeliverablesPanel } from "./components/DeliverablesPanel.js"` 并删除。

- [ ] **Step 6: 删除 DeliverablesPanel.tsx 文件**

```bash
rm apps/web/src/components/DeliverablesPanel.tsx
```

- [ ] **Step 7: 运行 typecheck 确认无引用错误**

```bash
pnpm typecheck
```

Expected: PASS（无类型错误）

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/DeliverablesPanel.tsx
git commit -m "refactor: remove deliverables tab, merge into files tab"
```

---

### Task 2: 后端新增打开 worktree 目录的 API

**Files:**
- Modify: `apps/server/src/index.ts` — 新增路由
- Test: 手动测试（curl 调用）

- [ ] **Step 1: 在 server index.ts 中新增路由**

在 `POST /api/quests/:id/deliver` 路由之后（约行 491），插入：

```ts
app.post("/api/quests/:questId/worktrees/:worktreeId/open", async (context) => {
  const { questId, worktreeId } = context.req.param();
  const state = await service.getState();
  const quest = state.quests.find((q) => q.id === questId);
  if (!quest) {
    return context.json({ error: "Quest not found" }, 404);
  }
  const worktree = quest.worktrees.find((wt) => wt.projectId === worktreeId || (wt as any).id === worktreeId);
  if (!worktree) {
    return context.json({ error: "Worktree not found" }, 404);
  }
  const worktreePath = (worktree as any).worktreePath;
  if (!worktreePath) {
    return context.json({ error: "Worktree path not available" }, 400);
  }
  try {
    await execFileAsync("open", [worktreePath]);
    return context.json({ ok: true, path: worktreePath });
  } catch (error) {
    return context.json({ error: `Failed to open directory: ${error instanceof Error ? error.message : String(error)}` }, 500);
  }
});
```

注意：`WorktreeState` 类型（`api.ts:104-111`）没有 `id` 字段，只有 `projectId`。worktree 的唯一标识是 `projectId`，所以 API 路径用 `:worktreeId` 实际上匹配的是 `projectId`。

- [ ] **Step 2: 确认 execFileAsync 已在文件顶部 import**

检查 `apps/server/src/index.ts` 第 6 行已有：
```ts
import { execFile, spawn } from "node:child_process";
```
和第 12 行：
```ts
const execFileAsync = promisify(execFile);
```

- [ ] **Step 3: 运行 typecheck 确认**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "feat: add API to open worktree directory in Finder"
```

---

### Task 3: 前端新增 openWorktree API 调用

**Files:**
- Modify: `apps/web/src/api.ts` — 新增 `openWorktree` 方法

- [ ] **Step 1: 在 api.ts 的 `api` 对象中新增方法**

在 `deliverQuest` 之后（约行 785），插入：

```ts
  openWorktree: (questId: string, worktreeProjectId: string) =>
    request<{ ok: true; path: string }>(`/api/quests/${questId}/worktrees/${worktreeProjectId}/open`, {
      method: "POST"
    }),
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/api.ts
git commit -m "feat: add openWorktree API client method"
```

---

### Task 4: 重写 FilesPanel 为按 worktree 分组

**Files:**
- Modify: `apps/web/src/App.tsx` — 重写 FilesPanel 组件

这是最大的改动。需要：
1. 按 `worktreePath` 对 `changedFiles` 分组
2. 每个分组显示 worktree 名称（从 `quest.worktrees` 或 `projectById` 获取）
3. 添加"打开目录"按钮
4. 保持现有的文件行样式和动画

- [ ] **Step 1: 新增分组工具函数**

在 `changedFileKey` 函数之后（约行 3315），新增：

```ts
function groupFilesByWorktree(files: ChangedFile[]): Map<string, ChangedFile[]> {
  const groups = new Map<string, ChangedFile[]>();
  for (const file of files) {
    const key = file.worktreePath || "unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(file);
  }
  return groups;
}
```

- [ ] **Step 2: 重写 FilesPanel 组件**

替换现有的 `FilesPanel`（行 1747-1782）为：

```tsx
function FilesPanel({
  changedFiles,
  projectById,
  quest,
  onFileSelect
}: {
  changedFiles: ChangedFile[];
  projectById: Map<string, Project>;
  quest?: Quest;
  onFileSelect: (file: ChangedFile) => void;
}) {
  const [openingPath, setOpeningPath] = useState<string | null>(null);

  const handleOpenWorktree = async (worktreePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!quest) return;
    setOpeningPath(worktreePath);
    try {
      await api.openWorktree(quest.id, worktreePath);
    } catch (error) {
      console.error("Failed to open worktree:", error);
    } finally {
      setOpeningPath(null);
    }
  };

  const fileGroups = groupFilesByWorktree(changedFiles);

  return (
    <div className="changed-file-list">
      {changedFiles.length === 0 ? (
        <p className="muted">
          {questHasExecuted(quest) ? "本次执行没有产生文件变更。" : "运行 Quest 后会展示变更文件。"}
        </p>
      ) : null}
      {[...fileGroups.entries()].map(([worktreePath, files], groupIndex) => {
        const projectName = files[0] ? (projectById.get(files[0].projectId)?.name ?? files[0].projectId) : worktreePath;
        return (
          <div key={worktreePath} className="worktree-file-group" style={{ marginBottom: 16 }}>
            <div className="worktree-group-header" style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 0",
              borderBottom: "1px solid var(--color-border-subtle, rgba(255,255,255,0.06))",
              marginBottom: 4
            }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {projectName}
                <span style={{ color: "var(--color-text-muted, rgba(255,255,255,0.45))", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
                  {files.length} 个文件
                </span>
              </span>
              <button
                type="button"
                onClick={(e) => handleOpenWorktree(worktreePath, e)}
                disabled={openingPath === worktreePath}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--color-border-subtle, rgba(255,255,255,0.1))",
                  background: "transparent",
                  color: "var(--color-text-muted, rgba(255,255,255,0.55))",
                  cursor: "pointer"
                }}
                title="在 Finder 中打开"
              >
                {openingPath === worktreePath ? "打开中…" : "📂 打开"}
              </button>
            </div>
            {files.map((file, fileIndex) => (
              <motion.button
                className="changed-file-row"
                key={changedFileKey(file)}
                onClick={() => onFileSelect(file)}
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min((groupIndex * 4 + fileIndex) * 0.03, 0.3), ease: [0.22, 0.61, 0.36, 1] }}
              >
                <code>{file.path}</code>
                <em>{file.status}</em>
              </motion.button>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

注意：需要确保 App.tsx 顶部有 `React` 和 `useState` 的 import（已有），以及 `api` 对象的引用。`api` 对象是在 `api.ts` 中导出的，App.tsx 中应该已经有 `import { api, ... } from "./api.js"`。需要确认。

- [ ] **Step 3: 确认 api 已在 App.tsx 中 import**

检查 App.tsx 顶部 import 中是否有 `api`。如果没有，需要在 import 语句中添加。

- [ ] **Step 4: 运行 typecheck 确认**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat: group files by worktree with open-in-finder button"
```

---

### Task 5: 删除服务端 deliverables 路由（清理）

**Files:**
- Modify: `apps/server/src/index.ts` — 删除 deliverables 路由

- [ ] **Step 1: 查找并删除 deliverables 路由**

在 `apps/server/src/index.ts` 中搜索 `deliverables` 相关路由：
```ts
app.get("/api/expert/session/:id/deliverables", ...)
```
删除整个路由定义。

- [ ] **Step 2: 运行 typecheck 确认**

```bash
pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/index.ts
git commit -m "refactor: remove unused deliverables API endpoint"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 启动开发服务器**

```bash
pnpm dev
```

- [ ] **Step 2: 验证 UI**

1. 打开浏览器，访问 http://localhost:5173
2. 创建一个 quest 并运行（或用已有的有 changedFiles 的 quest）
3. 确认"产物" tab 不再出现
4. 确认"文件" tab 按 worktree 分组显示
5. 确认每组有" 打开"按钮
6. 点击按钮，确认 Finder 打开对应目录

- [ ] **Step 3: 运行全部测试**

```bash
pnpm test:all
```

Expected: PASS（e2e 测试如果有引用 deliverables 的需要一并更新）
