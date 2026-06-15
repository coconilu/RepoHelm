/**
 * Environment scrubbing for child processes spawned by worker tools
 * (`run_command`, `start_process`). The worker runs model-generated commands on
 * the host; passing the full `process.env` would expose API keys / tokens to
 * those commands (an exfiltration surface, especially once web access is on).
 * We strip secret-looking variables while keeping what commands legitimately
 * need (PATH, HOME, locale, …).
 */

// Key names (case-insensitive) considered secret. Deliberately broad/deny-leaning.
const SECRET_KEY_RE = /(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)/i;

export type EnvLike = Record<string, string | undefined>;

/** Return a copy of `env` with secret-looking keys removed. */
export function scrubSecretEnv(env: EnvLike): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SECRET_KEY_RE.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Build the environment for a spawned child: the scrubbed host env plus the
 * standard non-interactive overrides used by the command/process tools.
 */
export function buildChildEnv(env: EnvLike = process.env): Record<string, string> {
  return { ...scrubSecretEnv(env), NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0" };
}
