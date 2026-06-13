import { execFile } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function createFixtureRepo(options: {
  repoRoot: string;
  runDir: string;
  fixtureName: string;
}): Promise<string> {
  const source = join(options.repoRoot, "fixtures", "repos", options.fixtureName);
  const target = join(options.runDir, "repos", options.fixtureName);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: target });
  await execFileAsync("git", ["config", "user.email", "qa-agent@example.local"], { cwd: target });
  await execFileAsync("git", ["config", "user.name", "RepoHelm QA Agent"], { cwd: target });
  await execFileAsync("git", ["add", "."], { cwd: target });
  await execFileAsync("git", ["commit", "-m", "Initialize golden fixture repo"], { cwd: target });
  return target;
}
