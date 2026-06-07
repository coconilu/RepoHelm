import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProviderRegistry } from "./providers.js";
import type { CliModelOption, CliTestResult, LocalCliInfo, ProviderId } from "./types.js";

const execFileAsync = promisify(execFile);

const DEFAULT_MODEL_OPTION: CliModelOption = { id: "default", label: "Default (CLI config)" };

export interface CliDefinition {
  id: string;
  name: string;
  tagline: string;
  bin: string;
  fallbackBins?: string[];
  versionArgs: string[];
  /** Subcommand that prints one model id per line; omitted when the CLI has none. */
  listModels?: { args: string[]; timeoutMs?: number };
  /** Underlying provider — when set, live models can be pulled via the provider REST API using an env key. */
  providerId?: ProviderId;
  /** CLI-only aliases (e.g. sonnet/opus) kept even when live provider models are merged in. */
  aliasModels?: CliModelOption[];
  fallbackModels: CliModelOption[];
}

export const CLI_DEFINITIONS: CliDefinition[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    tagline: "Anthropic official CLI",
    bin: "claude",
    fallbackBins: ["openclaude"],
    versionArgs: ["--version"],
    providerId: "anthropic",
    aliasModels: [
      { id: "sonnet", label: "Sonnet (alias)" },
      { id: "opus", label: "Opus (alias)" },
      { id: "haiku", label: "Haiku (alias)" }
    ],
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: "sonnet", label: "Sonnet (alias)" },
      { id: "opus", label: "Opus (alias)" },
      { id: "haiku", label: "Haiku (alias)" }
    ]
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    tagline: "OpenAI official CLI",
    bin: "codex",
    versionArgs: ["--version"],
    providerId: "openai",
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: "gpt-5.1-codex", label: "gpt-5.1-codex" },
      { id: "gpt-5.1", label: "gpt-5.1" },
      { id: "o4-mini", label: "o4-mini" }
    ]
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    tagline: "Google official CLI",
    bin: "gemini",
    versionArgs: ["--version"],
    providerId: "gemini",
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: "gemini-2.5-pro", label: "gemini-2.5-pro" },
      { id: "gemini-2.5-flash", label: "gemini-2.5-flash" }
    ]
  },
  {
    id: "opencode",
    name: "OpenCode",
    tagline: "Open-source agent CLI",
    bin: "opencode",
    fallbackBins: ["opencode-cli"],
    versionArgs: ["--version"],
    listModels: { args: ["models"], timeoutMs: 15_000 },
    fallbackModels: [
      DEFAULT_MODEL_OPTION,
      { id: "anthropic/claude-sonnet-4-5", label: "anthropic/claude-sonnet-4-5" },
      { id: "openai/gpt-5", label: "openai/gpt-5" },
      { id: "google/gemini-2.5-pro", label: "google/gemini-2.5-pro" }
    ]
  }
];

export class LocalCliRegistry {
  constructor(
    private readonly definitions: CliDefinition[] = CLI_DEFINITIONS,
    private readonly providerRegistry: ProviderRegistry = new ProviderRegistry()
  ) {}

  list(): CliDefinition[] {
    return this.definitions;
  }

  get(id: string): CliDefinition | undefined {
    return this.definitions.find((def) => def.id === id);
  }

  async detect(def: CliDefinition, options: { refresh?: boolean } = {}): Promise<LocalCliInfo> {
    const resolvedBin = await this.resolveBin(def);
    if (!resolvedBin) {
      return {
        id: def.id,
        name: def.name,
        tagline: def.tagline,
        bin: def.bin,
        available: false,
        models: def.fallbackModels,
        modelsLive: false,
        detail: `未检测到 ${def.bin}。`
      };
    }

    const version = await this.probeVersion(resolvedBin, def);
    let models = def.fallbackModels;
    let modelsLive = false;
    let detail: string;

    if (options.refresh && def.listModels) {
      // CLIs that ship their own enumerate command (e.g. opencode models).
      const live = await this.fetchModels(resolvedBin, def);
      if (live && live.length > 0) {
        models = [DEFAULT_MODEL_OPTION, ...live.filter((option) => option.id !== DEFAULT_MODEL_OPTION.id)];
        modelsLive = true;
        detail = `已从 ${resolvedBin} 拉取 ${models.length - 1} 个实时模型。`;
      } else {
        detail = "未能从 CLI 拉取模型,显示内置默认值。";
      }
    } else if (options.refresh && def.providerId) {
      // CLIs backed by a provider: pull live models via REST using the env API key
      // the CLI itself authenticates with (e.g. ANTHROPIC_API_KEY for Claude Code).
      const provider = this.providerRegistry.get(def.providerId);
      const apiKey = provider ? this.providerRegistry.envKey(provider) : undefined;
      if (provider && apiKey) {
        const result = await this.providerRegistry.fetchModels(provider, { apiKey });
        if (result.live) {
          const aliases = def.aliasModels ?? [];
          models = [DEFAULT_MODEL_OPTION, ...aliases, ...result.models];
          modelsLive = true;
          detail = `已通过 ${provider.envKeys[0]} 从 ${provider.name} 拉取 ${result.models.length} 个实时模型。`;
        } else {
          detail = result.detail;
        }
      } else {
        detail = provider
          ? `设置 ${provider.envKeys.join(" / ")} 环境变量后,重新扫描即可拉取 ${provider.name} 实时模型。`
          : "显示内置别名/默认值(可直接作为 --model 传入)。";
      }
    } else if (def.listModels) {
      detail = "正在显示内置默认值。点击“重新扫描”可从 CLI 拉取实时模型。";
    } else if (def.providerId) {
      const provider = this.providerRegistry.get(def.providerId);
      detail = provider
        ? `内置别名/默认值。设置 ${provider.envKeys.join(" / ")} 后点击“重新扫描”可拉取 ${provider.name} 实时模型。`
        : "内置别名/默认值(可直接作为 --model 传入)。";
    } else {
      detail = "该 CLI 没有列模型命令,显示内置别名/默认值(可直接作为 --model 传入)。";
    }

    return {
      id: def.id,
      name: def.name,
      tagline: def.tagline,
      bin: resolvedBin,
      available: true,
      version,
      models,
      modelsLive,
      detail
    };
  }

  async detectAll(options: { refresh?: boolean } = {}): Promise<LocalCliInfo[]> {
    return Promise.all(this.definitions.map((def) => this.detect(def, options)));
  }

  async test(def: CliDefinition): Promise<CliTestResult> {
    const resolvedBin = await this.resolveBin(def);
    if (!resolvedBin) {
      return { id: def.id, ok: false, latencyMs: 0, message: `未检测到 ${def.bin}，无法测试。` };
    }
    const startedAt = Date.now();
    try {
      // Connectivity + latency probe only — we run --version rather than a real
      // model call so the test never consumes tokens or blocks on auth/interaction.
      await execFileAsync(resolvedBin, def.versionArgs, {
        timeout: 12_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
      const latencyMs = Date.now() - startedAt;
      return { id: def.id, ok: true, latencyMs, message: `${def.name} 在 ${latencyMs} 毫秒内响应 — 'ok'` };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      return { id: def.id, ok: false, latencyMs, message: `${def.name} 测试失败：${message}` };
    }
  }

  private async resolveBin(def: CliDefinition): Promise<string | undefined> {
    for (const candidate of [def.bin, ...(def.fallbackBins ?? [])]) {
      if (await this.commandExists(candidate)) {
        return candidate;
      }
    }
    return undefined;
  }

  private async commandExists(command: string): Promise<boolean> {
    try {
      await execFileAsync("which", [command]);
      return true;
    } catch {
      return false;
    }
  }

  private async probeVersion(bin: string, def: CliDefinition): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(bin, def.versionArgs, { timeout: 4000 });
      return stdout.trim().split("\n")[0]?.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async fetchModels(bin: string, def: CliDefinition): Promise<CliModelOption[] | undefined> {
    if (!def.listModels) {
      return undefined;
    }
    try {
      const { stdout } = await execFileAsync(bin, def.listModels.args, {
        timeout: def.listModels.timeoutMs ?? 15_000,
        maxBuffer: 1024 * 1024
      });
      const seen = new Set<string>();
      const out: CliModelOption[] = [];
      for (const line of stdout.split("\n")) {
        const id = line.trim();
        if (!id || id.startsWith("#") || seen.has(id)) {
          continue;
        }
        seen.add(id);
        out.push({ id, label: id });
      }
      return out;
    } catch {
      return undefined;
    }
  }
}
