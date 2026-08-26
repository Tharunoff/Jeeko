import { describe, expect, it } from "vitest";
import { detectOverlaps, detectEventConflicts } from "../src/engines/conflictResolver";
import { checkTaskFeasibility } from "../src/engines/feasibilityEngine";
import type { CapacityBreakdown, PlannedBlock } from "../src/types/index";
import { makeEvent, makeTask, TEST_DATE } from "./helpers";

function makeBlock(overrides: Partial<PlannedBlock> = {}): PlannedBlock {
  return {
    id: "block_" + Math.random(),
    taskId: "task_x",
    startTime: new Date("2026-01-05T14:00:00.000Z"),
    endTime: new Date("2026-01-05T15:00:00.000Z"),
    durationMinutes: 60,
    reason: "test",
    ...overrides
  };
}

function flatCapacity(usableMinutes: number): CapacityBreakdown {
  const start = new Date("2026-01-05T09:00:00.000Z");
  const end = new Date(start.getTime() + usableMinutes * 60000);
  return {
    date: "2026-01-05",
    wakingMinutes: usableMinutes,
    fixedMinutes: 0,
    travelMinutes: 0,
    mealMinutes: 0,
    breakMinutes: 0,
    bufferMinutes: 0,
    totalFreeMinutes: usableMinutes,
    usableMinutes,
    deepWorkMinutes: usableMinutes,
    lowEnergyMinutes: 0,
    windows: [{ start, end, minutes: usableMinutes, energyTag: "deep" }]
  };
}

describe("conflictResolver", () => {
  it("required test: Task A 14:00-15:00 and Task B 14:30-15:30 are detected as overlapping", () => {
    const a = makeBlock({ id: "a", startTime: new Date("2026-01-05T14:00:00.000Z"), endTime: new Date("2026-01-05T15:00:00.000Z") });
    const b = makeBlock({ id: "b", startTime: new Date("2026-01-05T14:30:00.000Z"), endTime: new Date("2026-01-05T15:30:00.000Z") });
    const overlaps = detectOverlaps([a, b]);
    expect(overlaps.length).toBe(1);
  });

  it("does not flag non-overlapping blocks", () => {
    const a = makeBlock({ id: "a", startTime: new Date("2026-01-05T14:00:00.000Z"), endTime: new Date("2026-01-05T15:00:00.000Z") });
    const b = makeBlock({ id: "b", startTime: new Date("2026-01-05T15:00:00.000Z"), endTime: new Date("2026-01-05T16:00:00.000Z") });
    expect(detectOverlaps([a, b]).length).toBe(0);
  });

  it("flags a planned block that overlaps a fixed calendar event", () => {
    const event = makeEvent({ fixed: true, startTime: new Date("2026-01-05T14:30:00.000Z"), endTime: new Date("2026-01-05T15:00:00.000Z") });
    const block = makeBlock();
    expect(detectEventConflicts([block], [event])).toEqual([block]);
  });
});

describe("feasibilityEngine", () => {
  it("required test: available 120min, task 90min -> feasible", () => {
    const task = makeTask({ estimatedMinutes: 90 });
    const result = checkTaskFeasibility({
      task,
      date: TEST_DATE,
      currentSchedule: [],
      capacity: flatCapacity(120),
      allTasks: [task],
      goals: [],
      projects: [],
      timeLogs: [],
      now: TEST_DATE
    });
    expect(result.feasible).toBe(true);
    expect(result.outcome).toBe("FEASIBLE");
    expect(result.shortfallMinutes).toBe(0);
  });

  it("required test: available 120min, task 180min -> not feasible", () => {
    const task = makeTask({ estimatedMinutes: 180 });
    const result = checkTaskFeasibility({
      task,
      date: TEST_DATE,
      currentSchedule: [],
      capacity: flatCapacity(120),
      allTasks: [task],
      goals: [],
      projects: [],
      timeLogs: [],
      now: TEST_DATE
    });
    expect(result.feasible).toBe(false);
    expect(result.shortfallMinutes).toBeGreaterThan(0);
  });

  it("never claims feasibility without factoring in an incomplete dependency", () => {
    const dep = makeTask({ id: "dep_1", title: "Prerequisite", status: "planned" });
    const task = makeTask({ estimatedMinutes: 30, dependencies: [dep.id] });
    const result = checkTaskFeasibility({
      task,
      date: TEST_DATE,
      currentSchedule: [],
      capacity: flatCapacity(500),
      allTasks: [dep, task],
      goals: [],
      projects: [],
      timeLogs: [],
      now: TEST_DATE
    });
    expect(result.feasible).toBe(false);
    expect(result.outcome).toBe("NOT_FEASIBLE");
    expect(result.explanation).toContain("Prerequisite");
  });

  it("gives an explicit YES/NO explanation, never a bare boolean-only answer", () => {
    const task = makeTask({ estimatedMinutes: 90 });
    const result = checkTaskFeasibility({
      task,
      date: TEST_DATE,
      currentSchedule: [],
      capacity: flatCapacity(120),
      allTasks: [task],
      goals: [],
      projects: [],
      timeLogs: [],
      now: TEST_DATE
    });
    expect(result.explanation.length).toBeGreaterThan(20);
    expect(result.explanation).toMatch(/Result:/);
  });
});
