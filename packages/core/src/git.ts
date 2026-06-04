import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CreateWorktreeInput {
  repoPath: string;
  branchName: string;
  worktreePath: string;
}

export interface CreateWorktreeResult {
  status: "created" | "failed";
  note: string;
  branchName: string;
  worktreePath: string;
  repoRoot?: string;
}

export class GitWorktreeManager {
  async createWorktree(input: CreateWorktreeInput): Promise<CreateWorktreeResult> {
    try {
      const repoRoot = await this.getRepoRoot(input.repoPath);
      if (await this.pathExists(input.worktreePath)) {
        const existingRepoRoot = await this.getRepoRoot(input.worktreePath).catch(() => undefined);
        if (existingRepoRoot) {
          return {
            status: "created",
            note: "Worktree 已存在，复用现有目录。",
            branchName: input.branchName,
            worktreePath: input.worktreePath,
            repoRoot
          };
        }
        return {
          status: "failed",
          note: "目标 worktree 路径已存在，但不是 Git worktree。",
          branchName: input.branchName,
          worktreePath: input.worktreePath,
          repoRoot
        };
      }

      await mkdir(dirname(input.worktreePath), { recursive: true });
      await this.git(repoRoot, ["worktree", "add", "-b", input.branchName, input.worktreePath, "HEAD"]);
      return {
        status: "created",
        note: "Git worktree 已创建。",
        branchName: input.branchName,
        worktreePath: input.worktreePath,
        repoRoot
      };
    } catch (error) {
      return {
        status: "failed",
        note: this.formatError(error),
        branchName: input.branchName,
        worktreePath: input.worktreePath
      };
    }
  }

  async getChangedFiles(worktreePath: string): Promise<string[]> {
    const output = await this.git(worktreePath, ["status", "--short"]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter(Boolean);
  }

  private async getRepoRoot(path: string): Promise<string> {
    const output = await this.git(path, ["rev-parse", "--show-toplevel"]);
    return output.trim();
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0"
      }
    });
    return stdout;
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private formatError(error: unknown): string {
    if (error && typeof error === "object") {
      const maybeError = error as { stderr?: string; stdout?: string; message?: string };
      return (maybeError.stderr || maybeError.stdout || maybeError.message || "Git worktree 创建失败。").trim();
    }
    return String(error);
  }
}

