import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepoHelmState } from "./types.js";

const emptyState = (): RepoHelmState => ({
  workspaces: [],
  projects: [],
  quests: [],
  events: [],
  knowledge: []
});

export class JsonStateStore {
  readonly statePath: string;

  constructor(rootDir: string) {
    this.statePath = join(rootDir, ".repohelm", "state.json");
  }

  async read(): Promise<RepoHelmState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return JSON.parse(raw) as RepoHelmState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyState();
      }
      throw error;
    }
  }

  async write(state: RepoHelmState): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

