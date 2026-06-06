import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeItem, Project } from "./types.js";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 56) || "knowledge";

export class KnowledgeFileStore {
  constructor(readonly rootDir: string) {}

  async writeKnowledgeItem(item: KnowledgeItem): Promise<string> {
    const dir = join(this.rootDir, item.type);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${slugify(item.title)}-${item.id}.md`);
    await writeFile(filePath, this.renderKnowledgeItem(item), "utf8");
    return filePath;
  }

  async writeProjectSummary(project: Project, timestamp: string): Promise<KnowledgeItem> {
    const item: KnowledgeItem = {
      id: `knowledge_project_${project.id}`,
      workspaceId: "",
      projectId: project.id,
      type: "repo-wiki",
      title: `Repo Summary: ${project.name}`,
      body: [
        `Repo ${project.name} is registered in the global repository registry.`,
        `Path: ${project.path}`,
        `Default branch: ${project.defaultBranch}`
      ].join("\n"),
      tags: ["repo", "summary"],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    return {
      ...item,
      sourcePath: await this.writeKnowledgeItem(item)
    };
  }

  private renderKnowledgeItem(item: KnowledgeItem) {
    return [
      "---",
      `id: ${item.id}`,
      `workspaceId: ${item.workspaceId}`,
      item.projectId ? `projectId: ${item.projectId}` : "",
      item.questId ? `questId: ${item.questId}` : "",
      `type: ${item.type}`,
      `title: ${JSON.stringify(item.title)}`,
      `tags: ${JSON.stringify(item.tags)}`,
      `createdAt: ${item.createdAt}`,
      `updatedAt: ${item.updatedAt}`,
      "---",
      "",
      `# ${item.title}`,
      "",
      item.body,
      ""
    ]
      .filter((line) => line !== "")
      .join("\n");
  }
}
