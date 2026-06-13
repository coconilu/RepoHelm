import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OrchestrationPlan } from "./types.js";
import { renderContractMarkdownLines, parseContractFromBlock } from "./task-contract.js";

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
    // Collapse any newlines in description so the ### heading stays on one
    // line — otherwise parsePlanMarkdown's regex will fail to match the step.
    const safeDescription = step.description.replace(/\s*\n\s*/g, " ").trim();
    lines.push(`### ${step.id}: ${safeDescription}`);
    lines.push(``);
    lines.push(`- **Agent**: ${step.agentName} (\`${step.agentId}\`)`);
    lines.push(`- **Dependencies**: ${step.dependencies.length > 0 ? step.dependencies.join(", ") : "none"}`);
    lines.push(`- **Expected Output**: ${step.expectedOutput}`);
    if (step.targetProjectId) {
      lines.push(`- **Target Project**: ${step.targetProjectId}`);
    }
    for (const contractLine of renderContractMarkdownLines(step)) {
      lines.push(contractLine);
    }
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

  // Parse steps by scanning for ### headings and collecting metadata lines.
  // This is more robust than a single regex because descriptions may contain
  // newlines or stray lines (e.g. legacy "操作项目: xxx" lines).
  const steps: OrchestrationPlan["steps"] = [];
  const headingRegex = /^### (\S+): (.+)$/gm;
  let headingMatch;
  while ((headingMatch = headingRegex.exec(content)) !== null) {
    const stepId = headingMatch[1]!;
    const description = headingMatch[2]!.trim();
    // Find the metadata block that follows this heading (up to the next ### or ##).
    const blockStart = headingMatch.index + headingMatch[0].length;
    const nextHeadingMatch = content.slice(blockStart).match(/\n###? /);
    const blockEnd = nextHeadingMatch ? blockStart + nextHeadingMatch.index! : content.length;
    const block = content.slice(blockStart, blockEnd);

    const agentMatch = block.match(/- \*\*Agent\*\*: (.+?) \(`([^)]+)`\)/);
    const depsMatch = block.match(/- \*\*Dependencies\*\*: (.+)/);
    const outputMatch = block.match(/- \*\*Expected Output\*\*: (.+)/);
    const targetProjectMatch = block.match(/- \*\*Target Project\*\*: (.+)/);
    if (!agentMatch || !depsMatch || !outputMatch) {
      continue;
    }
    const depsRaw = depsMatch[1]!.trim();
    const contract = parseContractFromBlock(block);
    steps.push({
      id: stepId,
      description,
      agentName: agentMatch[1]!.trim(),
      agentId: agentMatch[2]!.trim(),
      dependencies: depsRaw === "none" ? [] : depsRaw.split(",").map((d) => d.trim()),
      expectedOutput: outputMatch[1]!.trim(),
      ...(targetProjectMatch?.[1]?.trim() ? { targetProjectId: targetProjectMatch[1].trim() } : {}),
      ...(contract ? { contract } : {})
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
