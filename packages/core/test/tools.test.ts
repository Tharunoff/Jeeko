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

  it("delete_goal removes a goal; delete_project removes a project", async () => {
    const { goal } = (await executeTool("create_goal", { title: "Get fit" }, { store, now: TEST_DATE })) as any;
    const { project } = (await executeTool(
      "create_project",
      { title: "Couch to 5k", goalIds: [goal.id] },
      { store, now: TEST_DATE }
    )) as any;

    expect(await store.listGoals()).toHaveLength(1);
    expect(await store.listProjects()).toHaveLength(1);

    await executeTool("delete_project", { id: project.id }, { store, now: TEST_DATE });
    expect(await store.listProjects()).toHaveLength(0);

    await executeTool("delete_goal", { id: goal.id }, { store, now: TEST_DATE });
    expect(await store.listGoals()).toHaveLength(0);
  });

  it("delete_goal/delete_project throw a clear error for an unknown id rather than silently no-op'ing", async () => {
    await expect(executeTool("delete_goal", { id: "nope" }, { store, now: TEST_DATE })).rejects.toThrow(/No goal/);
    await expect(executeTool("delete_project", { id: "nope" }, { store, now: TEST_DATE })).rejects.toThrow(/No project/);
  });

  // create_reminder used to take a full ISO date-time string that the LLM had to
  // compute itself — a real production bug (a "tomorrow at 9am" reminder landing
  // at 2:30pm with no error) traced back to exactly that. It now takes hour/
  // minute/day (or a relative inMinutes) and does all the date math here,
  // deterministically — these tests are what should catch a regression back to
  // that failure mode.
  describe("create_reminder resolves time deterministically (no LLM date arithmetic)", () => {
    it("inMinutes sets an exact delta from now", async () => {
      const { reminder } = (await executeTool(
        "create_reminder",
        { title: "Check oven", inMinutes: 10 },
        { store, now: TEST_DATE }
      )) as any;
      expect(reminder.triggerAt.getTime()).toBe(TEST_DATE.getTime() + 10 * 60000);
    });

    it("hour/minute with day:'tomorrow' lands exactly one day ahead at that clock time", async () => {
      const { reminder } = (await executeTool(
        "create_reminder",
        { title: "CN experiment 6", hour: 9, minute: 0, day: "tomorrow" },
        { store, now: TEST_DATE }
      )) as any;
      const expected = new Date(TEST_DATE);
      expected.setDate(expected.getDate() + 1);
      expected.setHours(9, 0, 0, 0);
      expect(reminder.triggerAt.getTime()).toBe(expected.getTime());
    });

    it("hour/minute with no day rolls to tomorrow if that clock time already passed today", async () => {
      const now = new Date(TEST_DATE);
      now.setHours(14, 0, 0, 0); // 2pm local
      const { reminder } = (await executeTool(
        "create_reminder",
        { title: "Morning reminder", hour: 9, minute: 0 },
        { store, now }
      )) as any;
      expect(reminder.triggerAt.getTime()).toBeGreaterThan(now.getTime());
      expect(reminder.triggerAt.getDate()).toBe(now.getDate() + 1);
      expect(reminder.triggerAt.getHours()).toBe(9);
    });

    it("hour/minute with no day stays today if that clock time hasn't passed yet", async () => {
      const now = new Date(TEST_DATE);
      now.setHours(8, 0, 0, 0); // 8am local
      const { reminder } = (await executeTool(
        "create_reminder",
        { title: "Later today", hour: 9, minute: 0 },
        { store, now }
      )) as any;
      expect(reminder.triggerAt.getDate()).toBe(now.getDate());
      expect(reminder.triggerAt.getHours()).toBe(9);
    });

    it("rejects a call that gives neither inMinutes nor hour+minute", async () => {
      await expect(
        executeTool("create_reminder", { title: "Ambiguous" }, { store, now: TEST_DATE })
      ).rejects.toThrow();
    });

    it("rejects a call that gives both inMinutes and hour+minute", async () => {
      await expect(
        executeTool(
          "create_reminder",
          { title: "Conflicting", inMinutes: 5, hour: 9, minute: 0 },
          { store, now: TEST_DATE }
        )
      ).rejects.toThrow();
    });
  });
});
