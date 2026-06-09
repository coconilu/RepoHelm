import type { RepoChangeSet } from "./git.js";
import type { WikiStore } from "./wiki-store.js";
import { chunkMarkdown, topKBySimilarity } from "./vector.js";
import { REPO_WIKI_SLUGS, type RepoWikiPage, type RepoWikiSlug, type WikiChunkEmbedding } from "./types.js";

const PAGE_TITLES: Record<RepoWikiSlug, string> = {
  overview: "概览",
  architecture: "架构",
  modules: "模块",
  "key-flows": "关键流程",
  conventions: "约定",
  decisions: "决策日志"
};

const MAX_DIFF_CHARS = 40_000;

export interface KeyFile {
  path: string;
  content: string;
}

export interface WikiSearchHit {
  projectId: string;
  pageId: string;
  slug: RepoWikiSlug;
  chunkText: string;
  score: number;
}

/** Injectable side-effect deps. The service wires git + llm; tests pass fakes. */
export interface RepoWikiDeps {
  resolveHead(repoPath: string, ref: string): Promise<string>;
  countNewCommits(repoPath: string, from: string, ref: string): Promise<number>;
  listKeyFiles(repoPath: string, ref: string): Promise<KeyFile[]>;
  collectChanges(repoPath: string, from: string, ref: string): Promise<RepoChangeSet>;
  /** Calls the chat model and returns parsed JSON. Throws if the model returns non-JSON. */
  chatJson(prompt: string): Promise<any>;
  embed(texts: string[]): Promise<number[][]>;
}

export interface IndexResult {
  lastIndexedSha: string;
  lastIndexedAt: string;
}

const nowIso = () => new Date().toISOString();

export class RepoWikiManager {
  constructor(
    private readonly store: WikiStore,
    private readonly deps: RepoWikiDeps,
    private readonly writePageFile?: (page: RepoWikiPage) => Promise<string>
  ) {}

  async resolveHead(repoPath: string, ref: string): Promise<string> {
    return this.deps.resolveHead(repoPath, ref);
  }

  async countNewCommits(repoPath: string, ref: string, from: string): Promise<number> {
    return this.deps.countNewCommits(repoPath, from, ref);
  }

  async bootstrap(projectId: string, repoPath: string, ref: string): Promise<IndexResult> {
    const head = await this.deps.resolveHead(repoPath, ref);
    const keyFiles = await this.deps.listKeyFiles(repoPath, ref);
    const prompt = this.bootstrapPrompt(keyFiles);
    const parsed = await this.deps.chatJson(prompt);
    const bodies: Record<string, string> = parsed?.pages ?? {};

    await this.store.deleteProject(projectId); // clear any stale pages/embeddings from a prior index
    const pages: RepoWikiPage[] = [];
    for (const slug of REPO_WIKI_SLUGS) {
      pages.push(await this.buildPage(projectId, slug, String(bodies[slug] ?? ""), head));
    }
    await this.store.upsertPages(pages);
    for (const page of pages) {
      await this.embedPage(page);
    }
    return { lastIndexedSha: head, lastIndexedAt: nowIso() };
  }

  async incremental(projectId: string, repoPath: string, ref: string, from: string): Promise<IndexResult> {
    const head = await this.deps.resolveHead(repoPath, ref);
    const changes = await this.deps.collectChanges(repoPath, from, ref);
    const existing = await this.store.listPages(projectId);
    const byslug = new Map(existing.map((p) => [p.slug, p]));

    const prompt = this.incrementalPrompt(existing, changes);
    const parsed = await this.deps.chatJson(prompt);
    const updated: Record<string, string> = parsed?.updatedPages ?? {};
    const decisionEntry: string | undefined = parsed?.decisionEntry;

    const touched: RepoWikiPage[] = [];
    for (const slug of Object.keys(updated) as RepoWikiSlug[]) {
      if (!REPO_WIKI_SLUGS.includes(slug)) continue;
      touched.push(await this.buildPage(projectId, slug, String(updated[slug] ?? ""), head));
    }

    if (decisionEntry) {
      const shortSha = changes.commits[0]?.sha.slice(0, 7) ?? head.slice(0, 7);
      const prior = byslug.get("decisions");
      const priorBody = touched.find((p) => p.slug === "decisions")?.body ?? prior?.body ?? "";
      const entryLine = `- ${decisionEntry} (commit ${shortSha})`;
      const merged = `${entryLine}\n${priorBody}`.trim();
      const idx = touched.findIndex((p) => p.slug === "decisions");
      const decisionsPage = await this.buildPage(projectId, "decisions", merged, head);
      if (idx >= 0) touched[idx] = decisionsPage;
      else touched.push(decisionsPage);
    }

    await this.store.upsertPages(touched);
    for (const page of touched) {
      await this.embedPage(page);
    }
    return { lastIndexedSha: head, lastIndexedAt: nowIso() };
  }

  async search(projectIds: string[], query: string, k: number): Promise<WikiSearchHit[]> {
    const [queryVec] = await this.deps.embed([query]);
    if (!queryVec) return [];
    const all: WikiChunkEmbedding[] = [];
    for (const pid of projectIds) {
      all.push(...(await this.store.listEmbeddings(pid)));
    }
    return topKBySimilarity(queryVec, all, k).map(({ item, score }) => ({
      projectId: item.projectId,
      pageId: item.pageId,
      slug: item.slug,
      chunkText: item.chunkText,
      score
    }));
  }

  private async buildPage(
    projectId: string,
    slug: RepoWikiSlug,
    body: string,
    sha: string
  ): Promise<RepoWikiPage> {
    const page: RepoWikiPage = {
      id: `wiki_${projectId}_${slug}`,
      projectId,
      slug,
      title: PAGE_TITLES[slug],
      body,
      sourcePath: "",
      updatedAtSha: sha,
      updatedAt: nowIso()
    };
    if (this.writePageFile) {
      page.sourcePath = await this.writePageFile(page);
    }
    return page;
  }

  private async embedPage(page: RepoWikiPage): Promise<void> {
    const chunks = chunkMarkdown(page.body);
    if (chunks.length === 0) {
      await this.store.replacePageEmbeddings(page.id, []);
      return;
    }
    let vectors: number[][];
    try {
      vectors = await this.deps.embed(chunks);
    } catch {
      // No embedding ModelKit configured (or embed failed): persist the page WITHOUT
      // vectors so it stays usable via keyword fallback, instead of failing the sync.
      await this.store.replacePageEmbeddings(page.id, []);
      return;
    }
    const embeddings: WikiChunkEmbedding[] = chunks.map((chunkText, idx) => ({
      id: `chunk_${page.id}_${idx}`,
      projectId: page.projectId,
      pageId: page.id,
      slug: page.slug,
      chunkText,
      vector: vectors[idx] ?? [],
      model: "configured",
      createdAt: nowIso()
    }));
    await this.store.replacePageEmbeddings(page.id, embeddings);
  }

  private bootstrapPrompt(keyFiles: KeyFile[]): string {
    const files = keyFiles
      .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 4000)}\n\`\`\``)
      .join("\n\n");
    return [
      "你是代码库知识库生成器。基于下面的关键文件,为这个仓库生成 6 页结构化 wiki。",
      "只返回 JSON,形如 {\"pages\":{\"overview\":\"...\",\"architecture\":\"...\",\"modules\":\"...\",\"key-flows\":\"...\",\"conventions\":\"...\",\"decisions\":\"初次建立知识库。\"}}。",
      "每页用中文 Markdown,简洁准确。",
      "",
      files
    ].join("\n");
  }

  private incrementalPrompt(pages: RepoWikiPage[], changes: RepoChangeSet): string {
    const current = pages.map((p) => `## ${p.slug}\n${p.body}`).join("\n\n");
    const commitList = changes.commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.subject}`).join("\n");
    let diffText = changes.files.map((f) => `### ${f.status} ${f.path}\n${f.diff}`).join("\n\n");
    if (diffText.length > MAX_DIFF_CHARS) {
      diffText = changes.files
        .map((f) => `### ${f.status} ${f.path}\n${f.diff.split("\n").slice(0, 20).join("\n")}\n...(truncated)`)
        .join("\n\n");
    }
    return [
      "你在维护一个仓库的结构化 wiki。下面是当前 6 页内容,以及一批新提交的 diff。",
      "判断哪些页需要更新,只返回受影响页的新全文。",
      "只返回 JSON: {\"updatedPages\":{\"<slug>\":\"<新全文>\"},\"decisionEntry\":\"<一句话决策摘要,可省略>\"}。",
      "slug 必须是 overview/architecture/modules/key-flows/conventions/decisions 之一。decisions 页不要自己改,用 decisionEntry。",
      "",
      "# 当前 wiki",
      current,
      "",
      "# 新提交",
      commitList,
      "",
      "# 变更 diff",
      diffText
    ].join("\n");
  }
}
