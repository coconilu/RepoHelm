import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeItem, Project, Workspace } from "./types.js";

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

  async writeProjectSummary(workspace: Workspace, project: Project, timestamp: string): Promise<KnowledgeItem> {
    const item: KnowledgeItem = {
      id: `knowledge_project_${project.id}`,
      workspaceId: workspace.id,
      projectId: project.id,
      type: "repo-wiki",
      title: `Project Summary: ${project.name}`,
      body: [
        `Project ${project.name} is linked to workspace ${workspace.name}.`,
        `Path: ${project.path}`,
        `Role: ${project.role}`,
        `Default branch: ${project.defaultBranch}`,
        project.validationCommand ? `Validation command: ${project.validationCommand}` : "Validation command: not configured"
      ].join("\n"),
      tags: ["project", "summary", project.role],
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
