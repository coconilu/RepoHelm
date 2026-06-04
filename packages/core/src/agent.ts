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
      available: commandExists && Boolean(commandTemplate),
      configured: Boolean(commandTemplate),
      command: this.binary,
      detail: commandExists
        ? commandTemplate
          ? `已检测到 ${this.binary}，并通过 ${this.commandEnv} 配置执行命令。`
          : `已检测到 ${this.binary}，但还没有配置 ${this.commandEnv}。`
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

    return {
      status: "blocked",
      summary: `${this.name} adapter 已注册，但外部 CLI 执行协议尚未启用。`,
      events: [
        {
          type: "agent.backend.blocked",
          title: `${this.name} adapter 待启用`,
          detail: "RepoHelm 已完成 backend 检测与选择流程，下一步需要为该 CLI 定义安全执行协议。",
          agent: this.name
        }
      ]
    };
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

export class AgentBackendRegistry {
  private readonly backends: AgentBackend[] = [
    new MockAgentBackend(),
    new ExternalCliAgentBackend("codex-cli", "Codex CLI", "codex", "REPOHELM_CODEX_COMMAND"),
    new ExternalCliAgentBackend("claude-code", "Claude Code", "claude", "REPOHELM_CLAUDE_COMMAND"),
    new ExternalCliAgentBackend("opencode", "OpenCode", "opencode", "REPOHELM_OPENCODE_COMMAND")
  ];

  get(id: AgentBackendId): AgentBackend {
    return this.backends.find((backend) => backend.id === id) ?? this.backends[0]!;
  }

  async listAvailability(): Promise<AgentBackendAvailability[]> {
    return Promise.all(this.backends.map((backend) => backend.getAvailability()));
  }
}
