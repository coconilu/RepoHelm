import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

export async function changedPaths(cwd: string): Promise<string[]> {
  const output = await gitOutput(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return output
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim());
}
