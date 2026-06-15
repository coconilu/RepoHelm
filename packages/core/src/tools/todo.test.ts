import { describe, expect, it } from "vitest";
import { buildTodoToolHandler, WRITE_TODOS_TOOL } from "./todo.js";

describe("buildTodoToolHandler", () => {
  it("stores a todo list and echoes it back with defaulted status", async () => {
    const todos = buildTodoToolHandler();

    const result = JSON.parse(
      await todos.handle(WRITE_TODOS_TOOL, { todos: [{ content: "write tests" }, { content: "implement", status: "in_progress" }] })
    );

    expect(result.ok).toBe(true);
    expect(result.todos).toEqual([
      { content: "write tests", status: "pending" },
      { content: "implement", status: "in_progress" }
    ]);
    expect(todos.list).toEqual(result.todos);
  });

  it("replaces the whole list on each call (last write wins)", async () => {
    const todos = buildTodoToolHandler();

    await todos.handle(WRITE_TODOS_TOOL, { todos: [{ content: "a" }] });
    const result = JSON.parse(
      await todos.handle(WRITE_TODOS_TOOL, { todos: [{ content: "b", status: "completed" }] })
    );

    expect(result.todos).toEqual([{ content: "b", status: "completed" }]);
    expect(todos.list).toHaveLength(1);
  });

  it("rejects an invalid status", async () => {
    const todos = buildTodoToolHandler();

    const result = JSON.parse(await todos.handle(WRITE_TODOS_TOOL, { todos: [{ content: "x", status: "bogus" }] }));

    expect(result.ok).toBe(false);
    expect(String(result.error ?? "")).toMatch(/status/i);
  });

  it("requires content on every todo", async () => {
    const todos = buildTodoToolHandler();

    const result = JSON.parse(await todos.handle(WRITE_TODOS_TOOL, { todos: [{ status: "pending" }] }));

    expect(result.ok).toBe(false);
  });

  it("requires a todos array", async () => {
    const todos = buildTodoToolHandler();

    const result = JSON.parse(await todos.handle(WRITE_TODOS_TOOL, {}));
    expect(result.ok).toBe(false);
  });
});
