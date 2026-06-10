import type { LlmToolSpec } from "../llm.js";
import type { RepoHelmService } from "../service.js";
import type { RepoWikiPage, ProjectKnowledgeView } from "../types.js";

export const SEARCH_KNOWLEDGE_TOOL = "search_knowledge";
export const READ_KNOWLEDGE_TOOL = "read_knowledge";
export const WRITE_KNOWLEDGE_TOOL = "write_knowledge";
export const INDEX_KNOWLEDGE_TOOL = "index_knowledge";
export const GET_KNOWLEDGE_CONTEXT_TOOL = "get_knowledge_context";

export const knowledgeToolSpecs: LlmToolSpec[] = [
  {
    type: "function",
    function: {
      name: SEARCH_KNOWLEDGE_TOOL,
      description:
        "Search project knowledge base (wiki pages) using semantic search. Returns the most relevant wiki pages with their content chunks. Use this to find information about a project's architecture, modules, conventions, decisions, key flows, or overview.",
      parameters: {
        type: "object",
        required: ["query", "projectIds"],
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "The search query, e.g. 'how is authentication implemented' or 'project architecture overview'."
          },
          projectIds: {
            type: "array",
            items: { type: "string" },
            description: "List of project IDs to search within."
          },
          topK: {
            type: "number",
            description: "Maximum number of results to return. Defaults to 6."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: READ_KNOWLEDGE_TOOL,
      description:
        "Read the full content of a specific wiki page from a project. Use this after search_knowledge when you need the complete content of a particular page.",
      parameters: {
        type: "object",
        required: ["projectId", "slug"],
        additionalProperties: false,
        properties: {
          projectId: {
            type: "string",
            description: "The project ID."
          },
          slug: {
            type: "string",
            description: "The wiki page slug: overview, architecture, modules, key-flows, conventions, or decisions."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: WRITE_KNOWLEDGE_TOOL,
      description:
        "Create or update a wiki page for a project. Use this to record new knowledge, update existing documentation, or summarize learnings after a Quest. Merges new information with existing content rather than replacing entirely.",
      parameters: {
        type: "object",
        required: ["projectId", "slug", "title", "body"],
        additionalProperties: false,
        properties: {
          projectId: {
            type: "string",
            description: "The project ID."
          },
          slug: {
            type: "string",
            description: "The wiki page slug: overview, architecture, modules, key-flows, conventions, or decisions."
          },
          title: {
            type: "string",
            description: "The page title in Chinese, e.g. '架构' or '关键流程'."
          },
          body: {
            type: "string",
            description: "The MARKDOWN content of the page. Include headings, code blocks, and structured information as appropriate."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: INDEX_KNOWLEDGE_TOOL,
      description:
        "Trigger knowledge base indexing for a project. This scans the project repository, analyzes key files, and generates/updates wiki pages. Use this when the knowledge base is empty or stale.",
      parameters: {
        type: "object",
        required: ["projectId"],
        additionalProperties: false,
        properties: {
          projectId: {
            type: "string",
            description: "The project ID to index."
          },
          branch: {
            type: "string",
            description: "Optional: the branch to index. Defaults to the project's configured knowledge branch."
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: GET_KNOWLEDGE_CONTEXT_TOOL,
      description:
        "Get relevant knowledge base context for a specific task or question. This combines search across projects and returns a structured context block suitable for injecting into agent prompts. Use this when preparing context for another agent or when answering a broad question.",
      parameters: {
        type: "object",
        required: ["taskDescription", "projectIds"],
        additionalProperties: false,
        properties: {
          taskDescription: {
            type: "string",
            description: "A description of the task or question to get context for."
          },
          projectIds: {
            type: "array",
            items: { type: "string" },
            description: "List of project IDs to gather context from."
          }
        }
      }
    }
  }
];

export interface KnowledgeToolDeps {
  service: RepoHelmService;
}

export interface KnowledgeToolHandlers {
  handle(name: string, args: Record<string, unknown>): Promise<string>;
}

export function buildKnowledgeToolHandlers(deps: KnowledgeToolDeps): KnowledgeToolHandlers {
  const { service } = deps;

  return {
    async handle(name, args) {
      try {
        if (name === SEARCH_KNOWLEDGE_TOOL) {
          const query = typeof args.query === "string" ? args.query : "";
          const projectIds = Array.isArray(args.projectIds)
            ? args.projectIds.filter((p): p is string => typeof p === "string")
            : [];
          const topK = typeof args.topK === "number" ? args.topK : 6;
          if (!query || projectIds.length === 0) {
            return JSON.stringify({ ok: false, error: "query and projectIds are required" });
          }
          const pages = await service.searchProjectKnowledge(projectIds, query);
          const result = pages.slice(0, topK).map((p) => ({
            id: p.id,
            projectId: p.projectId,
            slug: p.slug,
            title: p.title,
            body: p.body.slice(0, 2000) // return first 2000 chars as preview
          }));
          return JSON.stringify({ ok: true, count: result.length, pages: result });
        }

        if (name === READ_KNOWLEDGE_TOOL) {
          const projectId = typeof args.projectId === "string" ? args.projectId : "";
          const slug = typeof args.slug === "string" ? args.slug : "";
          if (!projectId || !slug) {
            return JSON.stringify({ ok: false, error: "projectId and slug are required" });
          }
          const view = await service.getProjectKnowledge(projectId);
          const page = view.pages.find((p) => p.slug === slug);
          if (!page) {
            return JSON.stringify({
              ok: false,
              error: `Page '${slug}' not found in project ${projectId}. Available: ${view.pages.map((p) => p.slug).join(", ") || "none"}`
            });
          }
          return JSON.stringify({
            ok: true,
            page: {
              id: page.id,
              projectId: page.projectId,
              slug: page.slug,
              title: page.title,
              body: page.body
            }
          });
        }

        if (name === WRITE_KNOWLEDGE_TOOL) {
          const projectId = typeof args.projectId === "string" ? args.projectId : "";
          const slug = typeof args.slug === "string" ? args.slug : "";
          const title = typeof args.title === "string" ? args.title : "";
          const body = typeof args.body === "string" ? args.body : "";
          if (!projectId || !slug || !title || !body) {
            return JSON.stringify({ ok: false, error: "projectId, slug, title, and body are required" });
          }
          const page = await service.writeWikiPage(projectId, { slug, title, body });
          return JSON.stringify({ ok: true, page: { id: page.id, projectId: page.projectId, slug: page.slug, title: page.title } });
        }

        if (name === INDEX_KNOWLEDGE_TOOL) {
          const projectId = typeof args.projectId === "string" ? args.projectId : "";
          if (!projectId) {
            return JSON.stringify({ ok: false, error: "projectId is required" });
          }
          const branch = typeof args.branch === "string" ? args.branch : undefined;
          if (branch) {
            await service.setProjectKnowledgeBranch(projectId, branch);
          }
          const view = await service.syncProjectKnowledge(projectId);
          return JSON.stringify({
            ok: true,
            status: view.status,
            projectId: view.projectId,
            pageCount: view.pages.length,
            lastIndexedSha: view.lastIndexedSha
          });
        }

        if (name === GET_KNOWLEDGE_CONTEXT_TOOL) {
          const taskDescription = typeof args.taskDescription === "string" ? args.taskDescription : "";
          const projectIds = Array.isArray(args.projectIds)
            ? args.projectIds.filter((p): p is string => typeof p === "string")
            : [];
          if (!taskDescription || projectIds.length === 0) {
            return JSON.stringify({ ok: false, error: "taskDescription and projectIds are required" });
          }
          const pages = await service.searchProjectKnowledge(projectIds, taskDescription);
          // Build a structured context block for agent consumption
          const contextBlocks = pages.slice(0, 5).map((p) =>
            `## [${p.title}](${p.projectId}/${p.slug})\n\n${p.body.slice(0, 1500)}`
          );
          const context = contextBlocks.length > 0
            ? `Found ${pages.length} relevant knowledge page(s):\n\n${contextBlocks.join("\n\n---\n\n")}`
            : "No relevant knowledge found for this task.";
          return JSON.stringify({ ok: true, context, pageCount: pages.length });
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
