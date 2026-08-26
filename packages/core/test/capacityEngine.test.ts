import { describe, expect, it } from "vitest";
import { calculateCapacity } from "../src/engines/capacityEngine";
import { checkTaskFeasibility } from "../src/engines/feasibilityEngine";
import { makeEvent, makeTask, makeUser, TEST_DATE } from "./helpers";

describe("capacityEngine", () => {
  it("never uses the naive '24h - events' calculation", () => {
    const user = makeUser();
    const capacity = calculateCapacity({ date: TEST_DATE, user, events: [] });
    // 24h would be 1440 minutes; waking hours (07:00-23:00) is 960, and usable is
    // further reduced by meals/breaks/buffer.
    expect(capacity.wakingMinutes).toBe(960);
    expect(capacity.usableMinutes).toBeLessThan(capacity.wakingMinutes);
    expect(capacity.usableMinutes).toBeLessThan(1440);
  });

  it("required test: a 10:00-12:00 fixed event leaves a >=90min window available elsewhere with no other conflicts", () => {
    const user = makeUser();
    const event = makeEvent({
      startTime: new Date("2026-01-05T10:00:00.000Z"),
      endTime: new Date("2026-01-05T12:00:00.000Z"),
      type: "meeting"
    });
    const capacity = calculateCapacity({ date: TEST_DATE, user, events: [event] });

    expect(capacity.fixedMinutes).toBe(120);
    const bestWindow = Math.max(...capacity.windows.map((w) => w.minutes));
    expect(bestWindow).toBeGreaterThanOrEqual(90);

    const task = makeTask({ estimatedMinutes: 90 });
    const result = checkTaskFeasibility({
      task,
      date: TEST_DATE,
      currentSchedule: [],
      capacity,
      allTasks: [task],
      goals: [],
      projects: [],
      timeLogs: [],
      now: TEST_DATE
    });
    expect(result.feasible).toBe(true);
    expect(result.outcome).toBe("FEASIBLE");
  });

  it("reserves a buffer that is never scheduled away", () => {
    const user = makeUser();
    const capacity = calculateCapacity({ date: TEST_DATE, user, events: [] });
    expect(capacity.bufferMinutes).toBeGreaterThan(0);
    expect(capacity.usableMinutes).toBe(
      capacity.totalFreeMinutes - capacity.mealMinutes - capacity.breakMinutes - capacity.bufferMinutes
    );
  });

  it("treats sleep/travel events as non-negotiable, distinct from meals", () => {
    const user = makeUser();
    const travel = makeEvent({
      type: "travel",
      startTime: new Date("2026-01-05T08:00:00.000Z"),
      endTime: new Date("2026-01-05T08:30:00.000Z")
    });
    const capacity = calculateCapacity({ date: TEST_DATE, user, events: [travel] });
    expect(capacity.travelMinutes).toBe(30);
    expect(capacity.totalFreeMinutes).toBe(capacity.wakingMinutes - capacity.travelMinutes);
  });
});
