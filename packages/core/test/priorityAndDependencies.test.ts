import { describe, expect, it } from "vitest";
import { scoreTask } from "../src/engines/priorityEngine";
import {
  getAllDependents,
  getBlockedTaskIds,
  getIncompleteDependencies,
  isBlocked,
  topologicalOrder
} from "../src/engines/dependencyGraph";
import { makeGoal, makeTask, TEST_DATE } from "./helpers";

describe("priorityEngine", () => {
  it("required test: a closer hard deadline outranks an otherwise-similar distant deadline", () => {
    const near = makeTask({
      title: "Near deadline",
      deadline: new Date(TEST_DATE.getTime() + 1 * 86400000),
      deadlineType: "hard",
      importance: 0.5
    });
    const far = makeTask({
      title: "Far deadline",
      deadline: new Date(TEST_DATE.getTime() + 30 * 86400000),
      deadlineType: "hard",
      importance: 0.5
    });

    const nearScore = scoreTask(near, { now: TEST_DATE, goals: [], dependents: [] });
    const farScore = scoreTask(far, { now: TEST_DATE, goals: [], dependents: [] });

    expect(nearScore.deadlinePressure).toBeGreaterThan(farScore.deadlinePressure);
    expect(nearScore.finalScore).toBeGreaterThan(farScore.finalScore);
  });

  it("never lets manually-entered urgency alone dominate — deadlinePressure is computed, not copied", () => {
    const task = makeTask({ urgency: 0.9, deadline: undefined, deadlineType: "none" });
    const score = scoreTask(task, { now: TEST_DATE, goals: [], dependents: [] });
    expect(score.deadlinePressure).toBe(0);
  });

  it("respects an explicit priorityOverride", () => {
    const task = makeTask({ priorityOverride: 0.1, importance: 1, deadlineType: "hard", deadline: TEST_DATE });
    const score = scoreTask(task, { now: TEST_DATE, goals: [], dependents: [] });
    expect(score.finalScore).toBe(0.1);
  });

  it("boosts goalAlignment for tasks linked to a high-priorityWeight active goal", () => {
    const goal = makeGoal({ id: "g1", priorityWeight: 0.9, status: "active" });
    const aligned = makeTask({ goalIds: ["g1"] });
    const unaligned = makeTask({ goalIds: [] });
    const alignedScore = scoreTask(aligned, { now: TEST_DATE, goals: [goal], dependents: [] });
    const unalignedScore = scoreTask(unaligned, { now: TEST_DATE, goals: [goal], dependents: [] });
    expect(alignedScore.goalAlignment).toBeGreaterThan(unalignedScore.goalAlignment);
  });

  it("increases dependencyImpact when other tasks depend on this one", () => {
    const base = makeTask();
    const dependent = makeTask({ dependencies: [base.id] });
    const noDeps = scoreTask(base, { now: TEST_DATE, goals: [], dependents: [] });
    const withDeps = scoreTask(base, { now: TEST_DATE, goals: [], dependents: [dependent] });
    expect(withDeps.dependencyImpact).toBeGreaterThan(noDeps.dependencyImpact);
  });
});

describe("dependencyGraph", () => {
  it("required test: a blocking prerequisite is considered before its dependent", () => {
    const prereq = makeTask({ id: "schema", title: "Database schema", status: "planned" });
    const dependent = makeTask({ id: "api", title: "API implementation", dependencies: ["schema"] });

    expect(isBlocked(dependent, [prereq, dependent])).toBe(true);
    expect(isBlocked(prereq, [prereq, dependent])).toBe(false);
    expect(getBlockedTaskIds([prereq, dependent])).toEqual(new Set(["api"]));
    expect(getIncompleteDependencies(dependent, [prereq, dependent])[0].id).toBe("schema");

    const order = topologicalOrder([dependent, prereq]);
    expect(order.findIndex((t) => t.id === "schema")).toBeLessThan(order.findIndex((t) => t.id === "api"));
  });

  it("a cancelled dependency does not permanently block its dependent", () => {
    const prereq = makeTask({ id: "cancelled_dep", status: "cancelled" });
    const dependent = makeTask({ id: "child", dependencies: ["cancelled_dep"] });
    expect(isBlocked(dependent, [prereq, dependent])).toBe(false);
  });

  it("a completed dependency unblocks its dependent", () => {
    const prereq = makeTask({ id: "done_dep", status: "completed" });
    const dependent = makeTask({ id: "child2", dependencies: ["done_dep"] });
    expect(isBlocked(dependent, [prereq, dependent])).toBe(false);
  });

  it("finds transitive dependents (A -> B -> C)", () => {
    const a = makeTask({ id: "a" });
    const b = makeTask({ id: "b", dependencies: ["a"] });
    const c = makeTask({ id: "c", dependencies: ["b"] });
    const dependents = getAllDependents("a", [a, b, c]);
    expect(dependents.map((t) => t.id).sort()).toEqual(["b", "c"]);
  });

  it("never crashes on a dependency cycle", () => {
    const a = makeTask({ id: "cyc_a", dependencies: ["cyc_b"] });
    const b = makeTask({ id: "cyc_b", dependencies: ["cyc_a"] });
    expect(() => topologicalOrder([a, b])).not.toThrow();
  });
});
