import { describe, expect, it } from "vitest";
import { buildChildEnv, scrubSecretEnv } from "./env.js";

describe("scrubSecretEnv", () => {
  it("removes secret-looking variables", () => {
    const out = scrubSecretEnv({
      OPENAI_API_KEY: "sk-1",
      ANTHROPIC_API_KEY: "sk-2",
      GH_TOKEN: "ghp_x",
      AWS_SECRET_ACCESS_KEY: "aws",
      MY_PASSWORD: "pw",
      DB_CREDENTIAL: "c",
      REPOHELM_OPENAI_API_KEY: "k"
    });
    expect(Object.keys(out)).toEqual([]);
  });

  it("keeps non-secret variables like PATH and HOME", () => {
    const out = scrubSecretEnv({ PATH: "/usr/bin", HOME: "/home/x", LANG: "en", NODE_ENV: "test" });
    expect(out).toEqual({ PATH: "/usr/bin", HOME: "/home/x", LANG: "en", NODE_ENV: "test" });
  });

  it("drops only the secret keys from a mixed env", () => {
    const out = scrubSecretEnv({ PATH: "/usr/bin", GH_TOKEN: "ghp", SHELL: "/bin/sh" });
    expect(out).toEqual({ PATH: "/usr/bin", SHELL: "/bin/sh" });
  });
});

describe("buildChildEnv", () => {
  it("scrubs secrets and applies the standard overrides", () => {
    const env = buildChildEnv({ PATH: "/usr/bin", OPENAI_API_KEY: "sk" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.NO_COLOR).toBe("1");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
  });
});
