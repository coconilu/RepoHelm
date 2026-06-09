import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepoHelmService } from "./service.js";
import { SqliteStateStore } from "./store.js";
import { InMemoryWikiStore } from "./wiki-store.js";

describe("RepoHelmService project knowledge", () => {
  let dir: string;
  let service: RepoHelmService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "svc-knowledge-"));
    service = new RepoHelmService(new SqliteStateStore(dir), dir, {
      knowledgeRootDir: join(dir, "knowledge"),
      wikiStore: new InMemoryWikiStore()
    });
    await service.bootstrap();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("getProjectKnowledge reports empty status before indexing", async () => {
    const project = await service.createProject({ name: "Demo", path: dir, defaultBranch: "main" });
    const view = await service.getProjectKnowledge(project.id);
    expect(view.status).toBe("empty");
    expect(view.pages).toEqual([]);
  });

  it("setProjectKnowledgeBranch persists the branch", async () => {
    const project = await service.createProject({ name: "Demo", path: dir, defaultBranch: "main" });
    const updated = await service.setProjectKnowledgeBranch(project.id, "develop");
    expect(updated.knowledgeBranch).toBe("develop");
  });
});
