import type { LlmToolSpec } from "../llm.js";
import type { RepoHelmService } from "../service.js";
import type { UserPreference } from "../types.js";

export const RECORD_PREFERENCE_TOOL = "record_preference";
export const GET_USER_PROFILE_TOOL = "get_user_profile";
export const SUGGEST_CONVENTIONS_TOOL = "suggest_conventions";

export const habitsToolSpecs: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: RECORD_PREFERENCE_TOOL,
      description:
        "Record or update a user preference. If a preference with the same category and key already exists, update its value and confidence. Use this when you observe a consistent pattern in user corrections, style choices, or workflow habits.",
      parameters: {
        type: "object",
        required: ["category", "key", "value"],
        additionalProperties: false,
        properties: {
          category: {
            type: "string",
            enum: ["coding_style", "naming", "architecture", "tooling", "workflow", "other"],
            description: "The category of the preference."
          },
          key: {
            type: "string",
            description: "A unique key within the category, e.g. 'use-single-quotes', 'test-framework', 'prefer-fp'."
          },
          value: {
            type: "string",
            description: "The preference value, e.g. 'always', 'avoid', 'jest'."
          },
          source: {
            type: "string",
            enum: ["explicit", "observed", "correction", "inferred"],
            description: "How this preference was discovered. Default: observed."
          },
          confidence: {
            type: "number",
            description: "Initial confidence 0.0-1.0. Default: 0.5 for observed, 0.8 for explicit/correction."
          },
          example: {
            type: "string",
            description: "A concrete example of the preference in action, e.g. a code snippet showing the user's preferred style."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: GET_USER_PROFILE_TOOL,
      description:
        "Retrieve the user's accumulated preferences, filtered by category and/or minimum confidence. Use this before starting a task to understand the user's coding style, naming conventions, architecture preferences, and workflow habits.",
      parameters: {
        type: "object",
        required: [],
        additionalProperties: false,
        properties: {
          categories: {
            type: "array",
            items: { type: "string" },
            description: "Filter by preference categories. Omit to get all."
          },
          minConfidence: {
            type: "number",
            description: "Minimum confidence threshold (0.0-1.0). Default: 0.5."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: SUGGEST_CONVENTIONS_TOOL,
      description:
        "Generate convention guidance text based on the user's accumulated preferences, tailored to a specific task context. Use this to produce instructions for other agents about how the user wants things done.",
      parameters: {
        type: "object",
        required: ["taskContext"],
        additionalProperties: false,
        properties: {
          taskContext: {
            type: "string",
            description: "A description of the current task to filter relevant conventions for."
          },
          format: {
            type: "string",
            enum: ["bullet", "paragraph"],
            description: "Output format. Default: bullet (concise list of rules)."
          }
        }
      }
    }
  }
];

export interface HabitsToolDeps {
  service: RepoHelmService;
}

export interface HabitsToolHandlers {
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

export function buildHabitsToolHandlers(deps: HabitsToolDeps): HabitsToolHandlers {
  const { service } = deps;

  return {
    async handle(name, args) {
      try {
        if (name === RECORD_PREFERENCE_TOOL) {
          const category = typeof args.category === "string" ? args.category : "";
          const key = typeof args.key === "string" ? args.key : "";
          const value = typeof args.value === "string" ? args.value : "";
          if (!category || !key || !value) {
            return JSON.stringify({ ok: false, error: "category, key, and value are required" });
          }
          const source = (typeof args.source === "string" ? args.source : "observed") as UserPreference["source"];
          const confidence = typeof args.confidence === "number" ? args.confidence : undefined;
          const example = typeof args.example === "string" ? args.example : undefined;
          const pref = await service.recordPreference({
            category: category as UserPreference["category"],
            key,
            value,
            source,
            confidence,
            example
          });
          return JSON.stringify({
            ok: true,
            preference: {
              id: pref.id,
              category: pref.category,
              key: pref.key,
              value: pref.value,
              confidence: pref.confidence,
              source: pref.source,
              occurrences: pref.occurrences
            }
          });
        }

        if (name === GET_USER_PROFILE_TOOL) {
          const categories = Array.isArray(args.categories)
            ? args.categories.filter((c): c is string => typeof c === "string")
            : undefined;
          const minConfidence = typeof args.minConfidence === "number" ? args.minConfidence : 0.5;
          const prefs = await service.getUserPreferences(categories as UserPreference["category"][] | undefined, minConfidence);
          if (prefs.length === 0) {
            return JSON.stringify({ ok: true, preferences: [], summary: "No preferences recorded yet." });
          }
          const summary = prefs.map((p) =>
            `- [${p.category}] ${p.key} = ${p.value} (confidence: ${p.confidence.toFixed(1)}, source: ${p.source})`
          ).join("\n");
          return JSON.stringify({ ok: true, count: prefs.length, preferences: prefs, summary });
        }

        if (name === SUGGEST_CONVENTIONS_TOOL) {
          const taskContext = typeof args.taskContext === "string" ? args.taskContext : "";
          if (!taskContext) {
            return JSON.stringify({ ok: false, error: "taskContext is required" });
          }
          const format = typeof args.format === "string" ? args.format : "bullet";
          const guidance = await service.suggestConventions(taskContext);
          if (format === "paragraph") {
            return JSON.stringify({ ok: true, conventions: guidance.replace(/^- /gm, "").replace(/\n/g, " ") });
          }
          return JSON.stringify({ ok: true, conventions: guidance });
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
