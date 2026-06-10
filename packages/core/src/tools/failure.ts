import type { LlmToolSpec } from "../llm.js";
import type { RepoHelmService } from "../service.js";

export const RECORD_FAILURE_TOOL = "record_failure";
export const SEARCH_FAILURES_TOOL = "search_failures";
export const CHECK_RISK_TOOL = "check_risk";

export const failureToolSpecs: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: RECORD_FAILURE_TOOL,
      description:
        "Record a failure pattern with root cause analysis and mitigation. Before recording, use search_failures to check for similar existing failures — merge if found. Every recorded failure MUST have a concrete, actionable mitigation.",
      parameters: {
        type: "object",
        required: ["category", "title", "description", "rootCause", "context", "mitigation"],
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: ["type_error", "test_failure", "build_error", "logic_bug", "architecture", "security", "performance", "other"],
            description: "The failure category."
          },
          title: {
            type: "string",
            description: "A short, descriptive label for the failure pattern."
          },
          description: {
            type: "string",
            description: "What went wrong — a clear description of the failure."
          },
          rootCause: {
            type: "string",
            description: "Root cause analysis — WHY it happened, not just WHAT happened."
          },
          context: {
            type: "string",
            description: "What were we trying to do when the failure occurred."
          },
          mitigation: {
            type: "string",
            description: "Concrete, actionable steps to prevent this failure from recurring. 'Be more careful' is NOT a valid mitigation."
          },
          signals: {
            type: "array",
            items: { type: "string" },
            description: "Keywords or patterns to detect similar situations in the future."
          },
          projectId: {
            type: "string",
            description: "The project ID where the failure occurred (optional)."
          },
          questId: {
            type: "string",
            description: "The quest ID where the failure occurred (optional)."
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "Severity level. Default: medium."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: SEARCH_FAILURES_TOOL,
      description:
        "Search for similar past failure patterns. Use semantic matching to find failures with similar context, signals, or root causes. Always call this BEFORE recording a new failure to avoid duplicates.",
      parameters: {
        type: "object",
        required: ["query"],
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "Search query describing the situation or failure to look for."
          },
          category: {
            type: "string",
            description: "Optional: filter by failure category."
          },
          projectId: {
            type: "string",
            description: "Optional: filter by project ID."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: CHECK_RISK_TOOL,
      description:
        "Check if a task or quest has known risks based on past failure patterns. Returns relevant warnings to inject into agent context before execution. Use this before starting any quest or significant task.",
      parameters: {
        type: "object",
        required: ["taskDescription", "projectIds"],
        additionalProperties: false,
        properties: {
          taskDescription: {
            type: "string",
            description: "Description of the task or quest being planned."
          },
          projectIds: {
            type: "array",
            items: { type: "string" },
            description: "List of project IDs involved in the task."
          }
        }
      }
    }
  }
];

export interface FailureToolDeps {
  service: RepoHelmService;
}

export interface FailureToolHandlers {
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

export function buildFailureToolHandlers(deps: FailureToolDeps): FailureToolHandlers {
  const { service } = deps;

  return {
    async handle(name, args) {
      try {
        if (name === RECORD_FAILURE_TOOL) {
          const category = typeof args.category === "string" ? args.category : "";
          const title = typeof args.title === "string" ? args.title : "";
          const description = typeof args.description === "string" ? args.description : "";
          const rootCause = typeof args.rootCause === "string" ? args.rootCause : "";
          const context = typeof args.context === "string" ? args.context : "";
          const mitigation = typeof args.mitigation === "string" ? args.mitigation : "";
          if (!category || !title || !description || !rootCause || !context || !mitigation) {
            return JSON.stringify({ ok: false, error: "category, title, description, rootCause, context, and mitigation are all required" });
          }
          const signals = Array.isArray(args.signals)
            ? args.signals.filter((s): s is string => typeof s === "string")
            : [];
          const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
          const questId = typeof args.questId === "string" ? args.questId : undefined;
          const severity = (typeof args.severity === "string" ? args.severity : "medium") as "low" | "medium" | "high";

          // Semantic dedup: search for similar failures first
          const similar = await service.searchFailures(description, { category: category as any, projectId });
          if (similar.length > 0 && similar[0]!.severity !== "resolved" as any) {
            // Update existing instead of creating new
            const existing = similar[0]!;
            const updated = await service.updateFailure(existing.id, {
              severity: severity === "high" ? "high" : existing.severity,
              mitigation: existing.mitigation + "\n\n更新: " + mitigation
            });
            return JSON.stringify({
              ok: true,
              merged: true,
              existingId: existing.id,
              failure: {
                id: updated.id,
                title: updated.title,
                category: updated.category,
                severity: updated.severity,
                resolved: updated.resolved
              }
            });
          }

          const pattern = await service.recordFailure({
            category: category as any,
            title,
            description,
            rootCause,
            context,
            mitigation,
            signals,
            projectId,
            questId,
            severity
          });
          return JSON.stringify({
            ok: true,
            failure: {
              id: pattern.id,
              title: pattern.title,
              category: pattern.category,
              severity: pattern.severity,
              resolved: pattern.resolved
            }
          });
        }

        if (name === SEARCH_FAILURES_TOOL) {
          const query = typeof args.query === "string" ? args.query : "";
          if (!query) {
            return JSON.stringify({ ok: false, error: "query is required" });
          }
          const category = typeof args.category === "string" ? args.category : undefined;
          const projectId = typeof args.projectId === "string" ? args.projectId : undefined;
          const failures = await service.searchFailures(query, { category: category as any, projectId });
          return JSON.stringify({
            ok: true,
            count: failures.length,
            failures: failures.map((f) => ({
              id: f.id,
              title: f.title,
              category: f.category,
              severity: f.severity,
              rootCause: f.rootCause,
              mitigation: f.mitigation,
              resolved: f.resolved,
              createdAt: f.createdAt
            }))
          });
        }

        if (name === CHECK_RISK_TOOL) {
          const taskDescription = typeof args.taskDescription === "string" ? args.taskDescription : "";
          const projectIds = Array.isArray(args.projectIds)
            ? args.projectIds.filter((p): p is string => typeof p === "string")
            : [];
          if (!taskDescription) {
            return JSON.stringify({ ok: false, error: "taskDescription is required" });
          }
          const risks = await service.checkRisk(taskDescription, projectIds);
          if (risks.length === 0) {
            return JSON.stringify({ ok: true, riskLevel: "none", risks: [], summary: "No known risks for this task." });
          }
          const highRisks = risks.filter((r) => r.severity === "high");
          const summary = risks.map((r) =>
            `- [${r.severity.toUpperCase()}] ${r.title}: ${r.mitigation}`
          ).join("\n");
          return JSON.stringify({
            ok: true,
            riskLevel: highRisks.length > 0 ? "high" : risks.length > 2 ? "medium" : "low",
            count: risks.length,
            risks: risks.map((r) => ({
              id: r.id,
              title: r.title,
              category: r.category,
              severity: r.severity,
              mitigation: r.mitigation,
              rootCause: r.rootCause
            })),
            summary
          });
        }

        return JSON.stringify({ ok: false, error: `unknown tool: ${name}` });
      } catch (error) {
        return JSON.stringify({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
}
