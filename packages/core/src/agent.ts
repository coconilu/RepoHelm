import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentBackendId, Quest, WorktreeState } from "./types.js";

const execFileAsync = promisify(execFile);

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 48) || "quest";

export interface AgentBackendAvailability {
  id: AgentBackendId;
  name: string;
  available: boolean;
  configured: boolean;
  command?: string;
  detail: string;
}

export interface AgentBackendRunInput {
  quest: Quest;
  worktrees: WorktreeState[];
}

export interface AgentBackendRunResult {
  status: "completed" | "blocked" | "failed";
  summary: string;
  events: Array<{
    type: string;
    title: string;
    detail: string;
    agent: string;
  }>;
}

export interface AgentBackend {
  id: AgentBackendId;
  name: string;
  getAvailability(): Promise<AgentBackendAvailability>;
  run(input: AgentBackendRunInput): Promise<AgentBackendRunResult>;
}

export class MockAgentBackend implements AgentBackend {
  id: AgentBackendId = "mock";
  name = "Mock Implementation Agent";

  async getAvailability(): Promise<AgentBackendAvailability> {
    return {
      id: this.id,
      name: this.name,
      available: true,
      configured: true,
      detail: "内置 backend，用于验证 Quest、worktree 和 diff review 闭环。"
    };
  }

  async run(input: AgentBackendRunInput): Promise<AgentBackendRunResult> {
    const createdWorktrees = input.worktrees.filter((worktree) => worktree.status === "created");
    await Promise.all(createdWorktrees.map((worktree) => this.writeArtifact(input.quest, worktree)));
    return {
      status: "completed",
      summary: `Mock backend wrote artifacts to ${createdWorktrees.length} worktree(s).`,
      events: [
        {
          type: "agent.backend.started",
          title: "Mock backend 已启动",
          detail: "RepoHelm 使用内置 mock implementation backend 执行本次 Quest。",
          agent: this.name
        },
        {
          type: "implementation.changed_files",
          title: createdWorktrees.length > 0 ? "Implementation 产物已写入" : "Implementation 无可写入 worktree",
          detail:
            createdWorktrees.length > 0
              ? `Mock backend 已在 ${createdWorktrees.length} 个 worktree 中写入文件。`
              : "没有成功创建的 worktree，mock backend 未写入文件。",
          agent: this.name
        }
      ]
    };
  }

  private async writeArtifact(quest: Quest, worktree: WorktreeState): Promise<void> {
    const artifactDir = join(worktree.worktreePath, "repohelm-quest-output");
    const artifactPath = join(artifactDir, `${slugify(quest.title)}.md`);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      artifactPath,
      [
        `# ${quest.title}`,
        "",
        "## Requirement",
        "",
        quest.requirement,
        "",
        "## Implementation Notes",
        "",
        "- RepoHelm created an isolated Git worktree for this Quest.",
        "- This file is produced by the MVP mock Implementation Agent.",
        "- The diff review panel should show this file as an untracked change.",
        "",
        "## Acceptance Criteria Snapshot",
        "",
        ...quest.spec.acceptanceCriteria.map((item) => `- ${item}`),
        ""
      ].join("\n"),
      "utf8"
    );
  }
}

export class ExternalCliAgentBackend implements AgentBackend {
  constructor(
    readonly id: AgentBackendId,
    readonly name: string,
    private readonly binary: string,
    private readonly commandEnv: string
  ) {}

  async getAvailability(): Promise<AgentBackendAvailability> {
    const commandExists = await this.commandExists(this.binary);
    const commandTemplate = process.env[this.commandEnv];
    return {
      id: this.id,
      name: this.name,
      available: Boolean(commandTemplate),
      configured: Boolean(commandTemplate),
      command: commandTemplate ?? this.binary,
      detail: commandExists
        ? commandTemplate
          ? `已检测到 ${this.binary}，并通过 ${this.commandEnv} 配置执行命令。`
          : `已检测到 ${this.binary}，但还没有配置 ${this.commandEnv}。`
        : commandTemplate
          ? `未检测到 ${this.binary}，但已通过 ${this.commandEnv} 配置自定义执行命令。`
          : `未检测到 ${this.binary}。`
    };
  }

  async run(input: AgentBackendRunInput): Promise<AgentBackendRunResult> {
    const availability = await this.getAvailability();
    if (!availability.available) {
      return {
        status: "blocked",
        summary: availability.detail,
        events: [
          {
            type: "agent.backend.blocked",
            title: `${this.name} 不可用`,
            detail: availability.detail,
            agent: this.name
          }
        ]
      };
    }

    const commandTemplate = process.env[this.commandEnv];
    const createdWorktrees = input.worktrees.filter((worktree) => worktree.status === "created");
    if (!commandTemplate || createdWorktrees.length === 0) {
      return {
        status: "blocked",
        summary:
          createdWorktrees.length === 0
            ? `${this.name} 没有可执行的 worktree。`
            : `${this.name} 缺少 ${this.commandEnv} 命令配置。`,
        events: [
          {
            type: "agent.backend.blocked",
            title: `${this.name} 无法启动`,
            detail:
              createdWorktrees.length === 0
                ? "没有成功创建的 worktree，外部 agent backend 未执行。"
                : `请先配置 ${this.commandEnv}。`,
            agent: this.name
          }
        ]
      };
    }

    const runs = await Promise.all(
      createdWorktrees.map((worktree) => this.runCommand(commandTemplate, input.quest, worktree))
    );
    const completed = runs.filter((run) => run.ok);
    const failed = runs.filter((run) => !run.ok);

    return {
      status: failed.length === 0 ? "completed" : completed.length > 0 ? "completed" : "failed",
      summary: `${this.name} executed ${completed.length}/${runs.length} worktree command(s).`,
      events: [
        {
          type: "agent.backend.started",
          title: `${this.name} 已启动`,
          detail: `RepoHelm 使用 ${this.commandEnv} 在 ${runs.length} 个 worktree 中执行外部 agent backend。`,
          agent: this.name
        },
        ...runs.map((run) => ({
          type: run.ok ? "agent.backend.completed" : "agent.backend.failed",
          title: run.ok ? `${this.name} 执行完成` : `${this.name} 执行失败`,
          detail: [
            `Worktree: ${run.worktreePath}`,
            run.stdout ? `stdout: ${truncate(run.stdout, 500)}` : "",
            run.stderr ? `stderr: ${truncate(run.stderr, 500)}` : "",
            run.error ? `error: ${truncate(run.error, 300)}` : ""
          ]
            .filter(Boolean)
            .join("\n"),
          agent: this.name
        })),
        {
          type: "agent.artifacts.standardized",
          title: "Agent 输出已标准化",
          detail: "RepoHelm 已采集外部 CLI 的 stdout、stderr、退出状态和 worktree diff，作为可审查产物。",
          agent: this.name
        }
      ]
    };
  }

  private async runCommand(commandTemplate: string, quest: Quest, worktree: WorktreeState) {
    await writeAgentInput(quest, worktree);
    try {
      const { stdout, stderr } = await execFileAsync("sh", ["-lc", commandTemplate], {
        cwd: worktree.worktreePath,
        timeout: Number(process.env.REPOHELM_AGENT_TIMEOUT_MS ?? 120_000),
        env: {
          ...process.env,
          REPOHELM_QUEST_ID: quest.id,
          REPOHELM_QUEST_TITLE: quest.title,
          REPOHELM_QUEST_REQUIREMENT: quest.requirement,
          REPOHELM_WORKTREE_PATH: worktree.worktreePath,
          REPOHELM_AGENT_INPUT: join(worktree.worktreePath, ".repohelm", "agent-input.json")
        }
      });
      return { ok: true, worktreePath: worktree.worktreePath, stdout, stderr };
    } catch (error) {
      const maybeError = error as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        worktreePath: worktree.worktreePath,
        stdout: maybeError.stdout ?? "",
        stderr: maybeError.stderr ?? "",
        error: maybeError.message ?? String(error)
      };
    }
  }

  private async commandExists(command: string): Promise<boolean> {
    try {
      await execFileAsync("which", [command]);
      return true;
    } catch {
      return false;
    }
  }
}

export class OpenAICompatibleAgentBackend implements AgentBackend {
  id: AgentBackendId = "openai-compatible";
  name = "OpenAI-compatible Provider";

  async getAvailability(): Promise<AgentBackendAvailability> {
    const baseUrl = process.env.REPOHELM_OPENAI_BASE_URL;
    const model = process.env.REPOHELM_OPENAI_MODEL;
    const apiKey = process.env.REPOHELM_OPENAI_API_KEY;
    const configured = Boolean(baseUrl && model && apiKey);
    return {
      id: this.id,
      name: this.name,
      available: configured,
      configured,
      command: baseUrl,
      detail: configured
        ? `已配置 REPOHELM_OPENAI_BASE_URL 和模型 ${model}，可用于 Qwen、DeepSeek 等 OpenAI-compatible provider。`
        : "需要配置 REPOHELM_OPENAI_BASE_URL、REPOHELM_OPENAI_MODEL 和 REPOHELM_OPENAI_API_KEY。"
    };
  }

  async run(input: AgentBackendRunInput): Promise<AgentBackendRunResult> {
    const availability = await this.getAvailability();
    if (!availability.available) {
      return {
        status: "blocked",
        summary: availability.detail,
        events: [
          {
            type: "agent.backend.blocked",
            title: `${this.name} 不可用`,
            detail: availability.detail,
            agent: this.name
          }
        ]
      };
    }

    const createdWorktrees = input.worktrees.filter((worktree) => worktree.status === "created");
    if (createdWorktrees.length === 0) {
      return {
        status: "blocked",
        summary: `${this.name} 没有可执行的 worktree。`,
        events: [
          {
            type: "agent.backend.blocked",
            title: `${this.name} 无法启动`,
            detail: "没有成功创建的 worktree，provider backend 未执行。",
            agent: this.name
          }
        ]
      };
    }
    const runs = await Promise.all(createdWorktrees.map((worktree) => this.runProvider(input.quest, worktree)));
    const completed = runs.filter((run) => run.ok);

    return {
      status: completed.length === runs.length ? "completed" : completed.length > 0 ? "completed" : "failed",
      summary: `${this.name} generated artifacts for ${completed.length}/${runs.length} worktree(s).`,
      events: [
        {
          type: "agent.backend.started",
          title: `${this.name} 已启动`,
          detail: "RepoHelm 已调用 OpenAI-compatible chat completions provider。",
          agent: this.name
        },
        ...runs.map((run) => ({
          type: run.ok ? "agent.provider.completed" : "agent.provider.failed",
          title: run.ok ? "Provider 输出已写入" : "Provider 调用失败",
          detail: run.ok
            ? `Worktree: ${run.worktreePath}\nartifact: ${run.artifactPath}`
            : `Worktree: ${run.worktreePath}\nerror: ${run.error}`,
          agent: this.name
        }))
      ]
    };
  }

  private async runProvider(quest: Quest, worktree: WorktreeState) {
    await writeAgentInput(quest, worktree);
    const baseUrl = process.env.REPOHELM_OPENAI_BASE_URL!;
    const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.REPOHELM_OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.REPOHELM_OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are RepoHelm's implementation agent. Return concise implementation notes and concrete file changes to make."
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                title: quest.title,
                requirement: quest.requirement,
                spec: quest.spec
              },
              null,
              2
            )
          }
        ]
      })
    }).catch((error: unknown) => ({
      ok: false,
      statusText: error instanceof Error ? error.message : String(error),
      json: async () => ({})
    }));

    if (!response.ok) {
      return {
        ok: false,
        worktreePath: worktree.worktreePath,
        error: `Provider request failed: ${response.statusText}`
      };
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content ?? "";
    const artifactDir = join(worktree.worktreePath, "repohelm-quest-output");
    const artifactPath = join(artifactDir, `${slugify(quest.title)}-provider.md`);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(artifactPath, content || "Provider returned an empty response.", "utf8");
    return { ok: true, worktreePath: worktree.worktreePath, artifactPath };
  }
}

export class AgentBackendRegistry {
  private readonly backends: AgentBackend[] = [
    new MockAgentBackend(),
    new ExternalCliAgentBackend("codex-cli", "Codex CLI", "codex", "REPOHELM_CODEX_COMMAND"),
    new ExternalCliAgentBackend("claude-code", "Claude Code", "claude", "REPOHELM_CLAUDE_COMMAND"),
    new ExternalCliAgentBackend("opencode", "OpenCode", "opencode", "REPOHELM_OPENCODE_COMMAND"),
    new OpenAICompatibleAgentBackend()
  ];

  get(id: AgentBackendId): AgentBackend {
    return this.backends.find((backend) => backend.id === id) ?? this.backends[0]!;
  }

  async listAvailability(): Promise<AgentBackendAvailability[]> {
    return Promise.all(this.backends.map((backend) => backend.getAvailability()));
  }
}

async function writeAgentInput(quest: Quest, worktree: WorktreeState): Promise<void> {
  const inputDir = join(worktree.worktreePath, ".repohelm");
  await mkdir(inputDir, { recursive: true });
  await writeFile(
    join(inputDir, "agent-input.json"),
    `${JSON.stringify(
      {
        questId: quest.id,
        title: quest.title,
        requirement: quest.requirement,
        spec: quest.spec,
        worktree
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
