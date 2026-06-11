import { RepoHelmService, SqliteStateStore } from "@repohelm/core";
import { Hono } from "hono";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { setupSSE, formatSSE } from "./sse.js";

// 导入 schema 定义(从 index.ts 复制)
const testModelSchema = z.object({
  type: z.enum(["cli", "byok"]),
  backendId: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  name: z.string().min(1),
  costTier: z.enum(["free", "low", "medium", "high"]).optional(),
  performanceProfile: z.enum(["fast", "balanced", "accurate"]).optional()
});

describe("Server API - ModelKit Endpoints", () => {
  let rootDir: string;
  let service: RepoHelmService;
  let app: Hono;

  beforeAll(async () => {
    rootDir = await mkdtemp(join(tmpdir(), "repohelm-server-test-"));
    service = new RepoHelmService(new SqliteStateStore(rootDir), rootDir);
    
    // 创建一个简单的 Hono 应用用于测试
    app = new Hono();
    
    // POST /api/model-kits/test-and-save - 测试并保存 ModelKit
    app.post("/api/model-kits/test-and-save", async (context) => {
      const input = testModelSchema.parse(await context.req.json());
      try {
        const modelKit = await service.testAndSaveModelKit(input);
        return context.json(modelKit, 201);
      } catch (error) {
        return context.json({ error: String(error) }, 400);
      }
    });

    // GET /api/model-kits - 列出所有 ModelKits
    app.get("/api/model-kits", async (context) => {
      const modelKits = await service.listModelKits();
      return context.json(modelKits);
    });

    // DELETE /api/model-kits/:id - 删除 ModelKit
    app.delete("/api/model-kits/:id", async (context) => {
      try {
        await service.deleteModelKit(context.req.param("id"));
        return context.json({ ok: true });
      } catch (error) {
        return context.json({ error: String(error) }, 400);
      }
    });
  });

  describe("POST /api/model-kits/test-and-save", () => {
    it("应该接受 CLI 类型的请求(无 apiKey/baseUrl)", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "default",
        name: "Test CLI Kit"
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.type).toBe("cli");
      expect(data.backendId).toBe("mock");
      expect(data.name).toBe("Test CLI Kit");
      // 验证配置中不包含 apiKey 或 baseUrl
      expect(data.config.apiKey).toBeUndefined();
      expect(data.config.baseUrl).toBeUndefined();
    });

    it("应该接受 BYOK 类型的请求(有 apiKey/baseUrl)", async () => {
      const requestBody = {
        type: "byok",
        providerId: "openai",
        model: "gpt-4",
        name: "Test BYOK Kit",
        apiKey: "sk-test-key",
        baseUrl: "https://api.openai.com/v1"
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      // 由于没有真实的 API key,这个测试会失败,但我们应该验证 schema 验证是通过的
      const data = (await res.json()) as any;
      
      if (res.status === 400) {
        // 如果是 400,应该是测试失败(网络/认证错误),而不是 schema 验证失败
        // Schema 验证失败的错误通常包含 "Invalid input" 或字段名
        const errorMsg = data.error.toLowerCase();
        const isSchemaError = errorMsg.includes("invalid") || 
                             errorMsg.includes("required") ||
                             errorMsg.includes("expected");
        
        expect(isSchemaError).toBe(false);
      } else {
        // 如果成功,验证返回的数据结构
        expect(res.status).toBe(201);
        expect(data.type).toBe("byok");
        expect(data.providerId).toBe("openai");
      }
    });

    it("BYOK 类型缺少 providerId 时应该返回 400", async () => {
      const requestBody = {
        type: "byok",
        model: "gpt-4",
        name: "Invalid BYOK Kit",
        apiKey: "sk-test-key",
        baseUrl: "https://api.openai.com/v1"
        // 缺少 providerId
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toContain("providerId");
    });

    it("CLI 类型缺少 backendId 时应该返回 400", async () => {
      const requestBody = {
        type: "cli",
        model: "default",
        name: "Invalid CLI Kit"
        // 缺少 backendId
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toContain("backendId");
    });

    it("无效的 type 值应该返回 400", async () => {
      const requestBody = {
        type: "invalid-type",
        model: "default",
        name: "Invalid Type Kit"
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
    });

    it("缺少 name 字段应该返回 400", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "default"
        // 缺少 name
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
    });

    it("缺少 model 字段应该返回 400", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        name: "No Model Kit"
        // 缺少 model
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
    });

    it("无效的 costTier 值应该返回 400", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "default",
        name: "Invalid Cost Tier",
        costTier: "invalid-tier"
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
    });

    it("无效的 performanceProfile 值应该返回 400", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "default",
        name: "Invalid Profile",
        performanceProfile: "invalid-profile"
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/model-kits", () => {
    it("应该返回空数组当没有 ModelKits 时", async () => {
      const res = await app.request("/api/model-kits", {
        method: "GET"
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any[];
      expect(Array.isArray(data)).toBe(true);
    });

    it("应该返回已创建的 ModelKits", async () => {
      // 先创建一个 ModelKit
      await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "cli",
          backendId: "mock",
          model: "default",
          name: "List Test Kit"
        })
      });

      const res = await app.request("/api/model-kits", {
        method: "GET"
      });

      expect(res.status).toBe(200);
      const data = (await res.json()) as any[];
      expect(data.length).toBeGreaterThan(0);
      expect(data.some((kit) => kit.name === "List Test Kit")).toBe(true);
    });
  });

  describe("DELETE /api/model-kits/:id", () => {
    it("应该可以删除已创建的 ModelKit", async () => {
      // 先创建一个 ModelKit
      const createRes = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "cli",
          backendId: "mock",
          model: "default",
          name: "Delete Test Kit"
        })
      });

      const createdKit = (await createRes.json()) as any;

      // 删除它
      const deleteRes = await app.request(`/api/model-kits/${createdKit.id}`, {
        method: "DELETE"
      });

      expect(deleteRes.status).toBe(200);
      const deleteData = (await deleteRes.json()) as any;
      expect(deleteData.ok).toBe(true);

      // 验证已被删除
      const listRes = await app.request("/api/model-kits", {
        method: "GET"
      });
      const kits = (await listRes.json()) as any[];
      expect(kits.find((k) => k.id === createdKit.id)).toBeUndefined();
    });

    it("删除不存在的 ModelKit 应该返回 400", async () => {
      const res = await app.request("/api/model-kits/nonexistent-id", {
        method: "DELETE"
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as any;
      expect(data.error).toContain("not found");
    });
  });

  describe("Schema Validation Edge Cases", () => {
    it("应该接受空的 apiKey 和 baseUrl 对于 CLI 类型", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "default",
        name: "Empty Fields CLI",
        apiKey: "",
        baseUrl: ""
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(201);
    });

    it("应该接受可选的 costTier 和 performanceProfile", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "default",
        name: "Optional Fields Kit"
        // 没有 costTier 和 performanceProfile
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(201);
      const data = (await res.json()) as any;
      expect(data.metadata.costTier).toBe("medium"); // 默认值
      expect(data.metadata.performanceProfile).toBe("balanced"); // 默认值
    });

    it("应该拒绝空字符串的 name", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "default",
        name: ""
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
    });

    it("应该拒绝空字符串的 model", async () => {
      const requestBody = {
        type: "cli",
        backendId: "mock",
        model: "",
        name: "Empty Model"
      };

      const res = await app.request("/api/model-kits/test-and-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
      });

      expect(res.status).toBe(400);
    });
  });
});

describe("Server API - Quest spec stream", () => {
  it("GET /api/quests/:id/spec-stream streams spec events", async () => {
    process.env.REPOHELM_FAKE_MODELS = "1";
    process.env.REPOHELM_FAKE_STREAM_TEXT =
      '分析。\n```json\n{"userGoal":"g","background":"b","functionalRequirements":[],"nonFunctionalRequirements":[],"affectedSurfaces":[],"outOfScope":[],"acceptanceCriteria":[],"openQuestions":[]}\n```';
    const rootDir = await mkdtemp(join(tmpdir(), "repohelm-server-sse-"));
    try {
      const service = new RepoHelmService(new SqliteStateStore(rootDir), rootDir);
      const state = await service.bootstrap();
      const ws = state.workspaces[0]!;
      const quest = await service.createQuest({ workspaceId: ws.id, title: "t", requirement: "做个动画" });

      const app = new Hono();
      app.get("/api/quests/:id/spec-stream", async (c) => {
        const questId = c.req.param("id");
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const ev of service.streamQuestSpec(questId)) {
                controller.enqueue(encoder.encode(formatSSE(ev.type, ev)));
              }
            } catch (err) {
              controller.enqueue(encoder.encode(formatSSE("error", { message: String((err as Error)?.message ?? err) })));
            } finally {
              controller.close();
            }
          }
        });
        return setupSSE(c, stream);
      });

      const res = await app.request(`/api/quests/${quest.id}/spec-stream`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      const body = await res.text();
      expect(body).toContain("event: analysis_delta");
      expect(body).toContain("event: spec_ready");
      expect(body).toContain("event: done");
    } finally {
      delete process.env.REPOHELM_FAKE_MODELS;
      delete process.env.REPOHELM_FAKE_STREAM_TEXT;
    }
  });
});
