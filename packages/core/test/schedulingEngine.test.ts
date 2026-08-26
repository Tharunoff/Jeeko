import { describe, expect, it } from "vitest";
import { planDay } from "../src/engines/schedulingEngine";
import { makeTask, makeUser, TEST_DATE } from "./helpers";

describe("schedulingEngine.planDay", () => {
  it("required test: preserves the configured buffer — never schedules 100% of the day", () => {
    const user = makeUser();
    const hugeTasks = [
      makeTask({ id: "t1", title: "Huge task 1", estimatedMinutes: 4000, energyRequirement: "high" }),
      makeTask({ id: "t2", title: "Huge task 2", estimatedMinutes: 4000, energyRequirement: "low" })
    ];
    const result = planDay({ date: TEST_DATE, tasks: hugeTasks, events: [], user, goals: [], projects: [], timeLogs: [] });

    const totalScheduled = result.blocks.reduce((s, b) => s + b.durationMinutes, 0);
    expect(totalScheduled).toBeLessThanOrEqual(result.capacity.usableMinutes);
    expect(result.capacity.usableMinutes).toBeLessThan(result.capacity.totalFreeMinutes); // buffer actually deducted
    expect(result.unscheduledTaskIds.length).toBeGreaterThan(0); // "do less, not more"
  });

  it("never double-books: no two blocks it produces overlap", () => {
    const user = makeUser();
    const tasks = [
      makeTask({ id: "a", estimatedMinutes: 60, importance: 0.9 }),
      makeTask({ id: "b", estimatedMinutes: 60, importance: 0.8 }),
      makeTask({ id: "c", estimatedMinutes: 60, importance: 0.7 })
    ];
    const result = planDay({ date: TEST_DATE, tasks, events: [], user, goals: [], projects: [], timeLogs: [] });
    const sorted = [...result.blocks].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].startTime.getTime()).toBeGreaterThanOrEqual(sorted[i - 1].endTime.getTime());
    }
  });

  it("excludes blocked tasks from today's plan", () => {
    const user = makeUser();
    const prereq = makeTask({ id: "prereq", status: "planned", estimatedMinutes: 30 });
    const blocked = makeTask({ id: "blocked", dependencies: ["prereq"], estimatedMinutes: 30 });
    const result = planDay({
      date: TEST_DATE,
      tasks: [prereq, blocked],
      events: [],
      user,
      goals: [],
      projects: [],
      timeLogs: []
    });
    expect(result.blocks.some((b) => b.taskId === "blocked")).toBe(false);
  });

  it("does not place a high-energy task in a short low-energy window", () => {
    const user = makeUser();
    const highEnergyTask = makeTask({ id: "deep_task", estimatedMinutes: 60, energyRequirement: "high", importance: 0.9 });
    const result = planDay({ date: TEST_DATE, tasks: [highEnergyTask], events: [], user, goals: [], projects: [], timeLogs: [] });
    const block = result.blocks.find((b) => b.taskId === "deep_task");
    expect(block).toBeDefined();
    const window = result.capacity.windows.find((w) => w.start.getTime() <= block!.startTime.getTime() && w.end.getTime() >= block!.endTime.getTime());
    expect(window?.energyTag).toBe("deep");
  });

  it("required test: rescheduling one task (deferring it) recalculates the affected plan", () => {
    const user = makeUser();
    const taskA = makeTask({ id: "a", title: "A", estimatedMinutes: 60, importance: 0.9 });
    const taskB = makeTask({ id: "b", title: "B", estimatedMinutes: 60, importance: 0.4 });

    const before = planDay({ date: TEST_DATE, tasks: [taskA, taskB], events: [], user, goals: [], projects: [], timeLogs: [] });
    expect(before.blocks.some((b) => b.taskId === "a")).toBe(true);

    const deferredA = { ...taskA, deferredUntil: new Date(TEST_DATE.getTime() + 86400000) };
    const after = planDay({ date: TEST_DATE, tasks: [deferredA, taskB], events: [], user, goals: [], projects: [], timeLogs: [] });

    expect(after.blocks.some((b) => b.taskId === "a")).toBe(false);
    expect(after.blocks.some((b) => b.taskId === "b")).toBe(true);
    // B's block start time shifts earlier now that A is no longer occupying the first slot.
    const bBefore = before.blocks.find((b) => b.taskId === "b")!;
    const bAfter = after.blocks.find((b) => b.taskId === "b")!;
    expect(bAfter.startTime.getTime()).toBeLessThan(bBefore.startTime.getTime());
  });
});
