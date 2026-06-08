import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OrchestrationPlan } from "./types.js";

export class QuestWorkspaceManager {
  constructor(private readonly rootDir: string) {}

  getQuestDir(questId: string): string {
    return join(this.rootDir, ".repohelm", "quests", questId);
  }

  async ensureQuestDir(questId: string): Promise<string> {
    const dir = this.getQuestDir(questId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async writePlan(questId: string, plan: OrchestrationPlan): Promise<string> {
    const dir = await this.ensureQuestDir(questId);
    const content = renderPlanMarkdown(plan);
    const planPath = join(dir, "plan.md");
    await writeFile(planPath, content, "utf8");
    return planPath;
  }

  async readPlan(questId: string): Promise<OrchestrationPlan | undefined> {
    const planPath = join(this.getQuestDir(questId), "plan.md");
    try {
      const content = await readFile(planPath, "utf8");
      return parsePlanMarkdown(content);
    } catch {
      return undefined;
    }
  }

  async writeWorkerArtifact(
    questId: string,
    stepId: string,
    agentName: string,
    content: string
  ): Promise<string> {
    const dir = await this.ensureQuestDir(questId);
    const artifactsDir = join(dir, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const slug = `${stepId}-${agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const artifactPath = join(artifactsDir, `${slug}.md`);
    await writeFile(artifactPath, content, "utf8");
    return artifactPath;
  }

  async listArtifacts(questId: string): Promise<string[]> {
    const artifactsDir = join(this.getQuestDir(questId), "artifacts");
    try {
      const entries = await readdir(artifactsDir);
      return entries.filter((name) => name.endsWith(".md"));
    } catch {
      return [];
    }
  }
}

function renderPlanMarkdown(plan: OrchestrationPlan): string {
  const lines: string[] = [
    `# Orchestration Plan`,
    ``,
    `- Quest ID: ${plan.questId}`,
    `- Generated: ${plan.generatedAt}`,
    ``,
    `## Summary`,
    ``,
    plan.summary,
    ``,
    `## Steps`,
    ``
  ];
  for (const step of plan.steps) {
    lines.push(`### ${step.id}: ${step.description}`);
    lines.push(``);
    lines.push(`- **Agent**: ${step.agentName} (\`${step.agentId}\`)`);
    lines.push(`- **Dependencies**: ${step.dependencies.length > 0 ? step.dependencies.join(", ") : "none"}`);
    lines.push(`- **Expected Output**: ${step.expectedOutput}`);
    lines.push(``);
  }
  if (plan.notes) {
    lines.push(`## Notes`, ``);
    lines.push(plan.notes);
    lines.push(``);
  }
  return lines.join("\n");
}

function parsePlanMarkdown(content: string): OrchestrationPlan {
  const questIdMatch = content.match(/- Quest ID: (.+)/);
  const generatedMatch = content.match(/- Generated: (.+)/);
  const summaryMatch = content.match(/## Summary\n\n([\s\S]*?)(?=\n## )/);
  const notesMatch = content.match(/## Notes\n\n([\s\S]*?)$/);

  const steps: OrchestrationPlan["steps"] = [];
  const stepRegex = /### (\S+): (.+)\n\n- \*\*Agent\*\*: (.+?) \(`([^)]+)`\)\n- \*\*Dependencies\*\*: (.+)\n- \*\*Expected Output\*\*: (.+)/g;
  let match;
  while ((match = stepRegex.exec(content)) !== null) {
    const depsRaw = match[5]!.trim();
    steps.push({
      id: match[1]!,
      description: match[2]!,
      agentName: match[3]!,
      agentId: match[4]!,
      dependencies: depsRaw === "none" ? [] : depsRaw.split(",").map((d) => d.trim()),
      expectedOutput: match[6]!
    });
  }

  return {
    questId: questIdMatch?.[1]?.trim() ?? "",
    generatedAt: generatedMatch?.[1]?.trim() ?? "",
    summary: summaryMatch?.[1]?.trim() ?? "",
    steps,
    notes: notesMatch?.[1]?.trim()
  };
}
