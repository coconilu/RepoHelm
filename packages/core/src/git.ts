import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { ChangedFile, ChangeKind, ProjectHealth } from "./types.js";

const execFileAsync = promisify(execFile);

export interface CreateWorktreeInput {
  repoPath: string;
  branchName: string;
  worktreePath: string;
  /** Start point for the new branch. Defaults to HEAD when omitted. */
  baseBranch?: string;
}

export interface CreateWorktreeResult {
  status: "created" | "failed";
  note: string;
  branchName: string;
  worktreePath: string;
  repoRoot?: string;
}

export interface GitOperationResult {
  status: "ok" | "failed" | "skipped";
  note: string;
  output?: string;
  commitSha?: string;
  prUrl?: string;
}

export interface RepoCommitSummary {
  sha: string;
  subject: string;
}

export interface RepoFileChange {
  path: string;
  status: string; // git name-status letter (A/M/D/R...)
  diff: string;
}

export interface RepoChangeSet {
  commits: RepoCommitSummary[];
  files: RepoFileChange[];
}

export class GitWorktreeManager {
  async inspectRepository(path: string, defaultBranch: string): Promise<ProjectHealth> {
    try {
      await access(path);
    } catch {
      return {
        status: "missing",
        message: "项目路径不存在。"
      };
    }

    try {
      const repoRoot = await this.getRepoRoot(path);
      const currentBranch = (await this.git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const branchNote =
        currentBranch === defaultBranch
          ? `当前分支为 ${currentBranch}。`
          : `当前分支为 ${currentBranch}，默认分支配置为 ${defaultBranch}。`;
      return {
        status: "ok",
        message: `Git 仓库可用。${branchNote}`
      };
    } catch (error) {
      return {
        status: "not_git",
        message: this.formatError(error)
      };
    }
  }

  async listBranches(path: string): Promise<{ branches: string[]; defaultBranch: string }> {
    const repoRoot = await this.getRepoRoot(path);
    const output = await this.git(repoRoot, ["branch", "--format=%(refname:short)"]);
    const branches = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const currentBranch = (await this.git(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
    const defaultBranch = branches.includes("main")
      ? "main"
      : branches.includes("master")
        ? "master"
        : currentBranch || branches[0] || "main";
    return { branches, defaultBranch };
  }

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
      const startPoint = await this.resolveStartPoint(repoRoot, input.baseBranch);
      await this.git(repoRoot, ["worktree", "add", "-b", input.branchName, input.worktreePath, startPoint]);
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

  async getChangedFiles(projectId: string, worktreePath: string): Promise<ChangedFile[]> {
    const output = await this.git(worktreePath, ["status", "--short", "--untracked-files=all"]);
    const entries = output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => this.parseStatusLine(line))
      .filter((entry) => entry.path.length > 0);

    return Promise.all(
      entries.map(async (entry) => ({
        projectId,
        path: entry.path,
        status: entry.status,
        diff: await this.getFileDiff(worktreePath, entry.path, entry.status),
        worktreePath
      }))
    );
  }

  async removeWorktree(repoPath: string, worktreePath: string, branchName: string): Promise<GitOperationResult> {
    try {
      const repoRoot = await this.getRepoRoot(repoPath);
      await this.git(repoRoot, ["worktree", "remove", "--force", worktreePath]).catch(() => "");
      await this.git(repoRoot, ["branch", "-D", branchName]).catch(() => "");
      return {
        status: "ok",
        note: "Worktree 和对应分支已清理。"
      };
    } catch (error) {
      return {
        status: "failed",
        note: this.formatError(error)
      };
    }
  }

  async runValidation(worktreePath: string, command: string): Promise<GitOperationResult> {
    if (!command.trim()) {
      return {
        status: "skipped",
        note: "项目未配置交付前验证命令。"
      };
    }
    try {
      const { stdout, stderr } = await execFileAsync("sh", ["-lc", command], {
        cwd: worktreePath,
        timeout: Number(process.env.REPOHELM_DELIVERY_TIMEOUT_MS ?? 120_000),
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0"
        }
      });
      return {
        status: "ok",
        note: "交付前验证命令通过。",
        output: [stdout, stderr].filter(Boolean).join("\n").trim()
      };
    } catch (error) {
      return {
        status: "failed",
        note: this.formatError(error),
        output: this.formatError(error)
      };
    }
  }

  async commitAll(worktreePath: string, message: string): Promise<GitOperationResult> {
    try {
      const changedFiles = await this.getChangedFiles("delivery", worktreePath);
      if (changedFiles.length === 0) {
        return {
          status: "skipped",
          note: "没有可提交的文件变更。"
        };
      }
      await this.git(worktreePath, ["add", "-A"]);
      await this.git(worktreePath, [
        "-c",
        "user.name=RepoHelm",
        "-c",
        "user.email=repohelm@example.com",
        "commit",
        "-m",
        message
      ]);
      const commitSha = (await this.git(worktreePath, ["rev-parse", "HEAD"])).trim();
      return {
        status: "ok",
        note: "Worktree 变更已提交。",
        commitSha
      };
    } catch (error) {
      return {
        status: "failed",
        note: this.formatError(error)
      };
    }
  }

  async createPullRequest(worktreePath: string, title: string, body: string): Promise<GitOperationResult> {
    if (process.env.REPOHELM_ENABLE_GH_PR !== "1") {
      return {
        status: "skipped",
        note: `PR handoff 已生成。设置 REPOHELM_ENABLE_GH_PR=1 后可使用 gh 创建 PR。\nTitle: ${title}\nBody: ${body}`
      };
    }
    try {
      const { stdout } = await execFileAsync("gh", ["pr", "create", "--title", title, "--body", body], {
        cwd: worktreePath,
        timeout: Number(process.env.REPOHELM_DELIVERY_TIMEOUT_MS ?? 120_000),
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0"
        }
      });
      return {
        status: "ok",
        note: "Pull request 已创建。",
        prUrl: stdout.trim()
      };
    } catch (error) {
      return {
        status: "failed",
        note: this.formatError(error)
      };
    }
  }

  async resolveRef(repoPath: string, ref: string): Promise<string> {
    return (await this.git(repoPath, ["rev-parse", ref])).trim();
  }

  async countCommitsBetween(repoPath: string, from: string, toRef: string): Promise<number> {
    const out = (await this.git(repoPath, ["rev-list", "--count", `${from}..${toRef}`])).trim();
    return Number.parseInt(out || "0", 10);
  }

  async listTrackedFiles(repoPath: string, ref: string): Promise<string[]> {
    const out = await this.git(repoPath, ["ls-tree", "-r", "--name-only", ref]);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }

  async collectChangesBetween(repoPath: string, from: string, toRef: string): Promise<RepoChangeSet> {
    const logOut = await this.git(repoPath, [
      "log",
      "--no-merges",
      "--pretty=format:%H%x1f%s",
      `${from}..${toRef}`
    ]);
    const commits: RepoCommitSummary[] = logOut
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, subject] = line.split("\x1f");
        return { sha: sha ?? "", subject: subject ?? "" };
      });

    const nameStatus = await this.git(repoPath, ["diff", "--name-status", `${from}..${toRef}`]);
    const files: RepoFileChange[] = [];
    for (const line of nameStatus.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const parts = line.split(/\t+/);
      const status = parts[0] ?? "M";
      const path = parts[parts.length - 1] ?? "";
      if (!path) continue;
      const diff = await this.gitAllowingDiffExit(repoPath, ["diff", `${from}..${toRef}`, "--", path]);
      files.push({ path, status, diff });
    }
    return { commits, files };
  }

  private parseStatusLine(line: string): { path: string; status: ChangeKind } {
    const rawStatus = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1)!.trim() : rawPath;
    if (rawStatus === "??") {
      return { path, status: "untracked" };
    }
    if (rawStatus.includes("R")) {
      return { path, status: "renamed" };
    }
    if (rawStatus.includes("D")) {
      return { path, status: "deleted" };
    }
    if (rawStatus.includes("A")) {
      return { path, status: "added" };
    }
    if (rawStatus.includes("M")) {
      return { path, status: "modified" };
    }
    return { path, status: "unknown" };
  }

  private async getFileDiff(worktreePath: string, path: string, status: ChangeKind): Promise<string> {
    if (status === "untracked") {
      return this.gitAllowingDiffExit(worktreePath, ["diff", "--no-index", "--", "/dev/null", join(worktreePath, path)]);
    }
    const unstaged = await this.git(worktreePath, ["diff", "--", path]);
    if (unstaged.trim().length > 0) {
      return unstaged;
    }
    return this.git(worktreePath, ["diff", "--cached", "--", path]);
  }

  private async resolveStartPoint(repoRoot: string, baseBranch?: string): Promise<string> {
    if (!baseBranch) {
      return "HEAD";
    }
    try {
      await this.git(repoRoot, ["rev-parse", "--verify", "--quiet", baseBranch]);
      return baseBranch;
    } catch {
      return "HEAD";
    }
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

  private async gitAllowingDiffExit(cwd: string, args: string[]): Promise<string> {
    try {
      return await this.git(cwd, args);
    } catch (error) {
      if (error && typeof error === "object") {
        const maybeError = error as { stdout?: string };
        if (maybeError.stdout) {
          return maybeError.stdout;
        }
      }
      throw error;
    }
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
