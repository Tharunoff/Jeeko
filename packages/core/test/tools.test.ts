import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryStore } from "../src/store/InMemoryStore";
import { executeTool } from "../src/llm/tools";
import { makeUser, TEST_DATE } from "./helpers";

describe("tools (integration through InMemoryStore)", () => {
  let store: InMemoryStore;

  beforeEach(async () => {
    store = new InMemoryStore();
    await store.saveUser(makeUser());
  });

  it("create_task -> get_today_schedule -> check_feasibility -> complete_task -> record via actual duration", async () => {
    const { task } = (await executeTool(
      "create_task",
      { title: "Write report", estimatedMinutes: 90, importance: 0.8 },
      { store, now: TEST_DATE }
    )) as any;
    expect(task.status).toBe("inbox");

    await executeTool("update_task", { id: task.id, status: "planned" }, { store, now: TEST_DATE });

    const schedule = (await executeTool("get_today_schedule", {}, { store, now: TEST_DATE })) as any;
    expect(schedule.blocks.some((b: any) => b.taskId === task.id)).toBe(true);

    const feasibility = (await executeTool("check_feasibility", { taskId: task.id }, { store, now: TEST_DATE })) as any;
    expect(feasibility.feasible).toBe(true);

    const completed = (await executeTool(
      "complete_task",
      { id: task.id, actualMinutes: 120 },
      { store, now: TEST_DATE }
    )) as any;
    expect(completed.task.status).toBe("completed");

    const logs = await store.listTimeLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].actualMinutes).toBe(120);
  });

  it("save_memory then search_memory finds it", async () => {
    await executeTool(
      "save_memory",
      { kind: "preference", key: "study_style", value: "short focused sessions" },
      { store, now: TEST_DATE }
    );
    const result = (await executeTool("search_memory", { query: "focused" }, { store, now: TEST_DATE })) as any;
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].key).toBe("study_style");
  });

  it("reschedule_task defers a task out of today's plan", async () => {
    const { task } = (await executeTool(
      "create_task",
      { title: "Deferrable", estimatedMinutes: 30 },
      { store, now: TEST_DATE }
    )) as any;
    await executeTool("update_task", { id: task.id, status: "planned" }, { store, now: TEST_DATE });

    const before = (await executeTool("get_today_schedule", {}, { store, now: TEST_DATE })) as any;
    expect(before.blocks.some((b: any) => b.taskId === task.id)).toBe(true);

    await executeTool(
      "reschedule_task",
      { taskId: task.id, deferUntil: new Date(TEST_DATE.getTime() + 86400000).toISOString() },
      { store, now: TEST_DATE }
    );

    const after = (await executeTool("get_today_schedule", {}, { store, now: TEST_DATE })) as any;
    expect(after.blocks.some((b: any) => b.taskId === task.id)).toBe(false);
  });

  it("throws a clear error for an unknown tool rather than silently doing nothing", async () => {
    await expect(executeTool("not_a_real_tool", {}, { store, now: TEST_DATE })).rejects.toThrow(/Unknown tool/);
  });
});
