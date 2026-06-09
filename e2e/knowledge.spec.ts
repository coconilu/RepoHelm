import { test, expect } from "@playwright/test";

test("bootstrap then stale-detect on a repo", async ({ request }) => {
  const before = await request.get("/api/projects/project_repohelm/knowledge");
  expect(before.ok()).toBeTruthy();
  const beforeBody = await before.json();
  expect(["empty", "ready", "stale"]).toContain(beforeBody.status);

  const synced = await request.post("/api/projects/project_repohelm/knowledge/sync");
  expect(synced.ok()).toBeTruthy();
  const syncedBody = await synced.json();
  expect(syncedBody.status === "ready" || syncedBody.status === "error").toBeTruthy();
  if (syncedBody.status === "ready") {
    expect(syncedBody.pages.length).toBe(6);
  }
});
