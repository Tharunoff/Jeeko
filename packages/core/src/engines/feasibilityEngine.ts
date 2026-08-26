import type {
  CapacityBreakdown,
  FeasibilityOutcome,
  FeasibilityResult,
  Goal,
  PlannedBlock,
  Project,
  Task,
  TimeLog,
  TimeWindow
} from "../types/index";
import { getIncompleteDependencies, getAllDependents } from "./dependencyGraph";
import { scoreTask } from "./priorityEngine";
import { findDemotionCandidate } from "./conflictResolver";
import { applyEstimationAdjustment, computeEstimationAdjustments } from "./estimationLearning";
import { buildReasoningFactors, explanationToProse } from "./explainability";
import { generateId } from "../util/id";
import { formatMinutes, minutesBetween } from "../util/time";
import { PriorityWeights } from "../config/priorityWeights";

function pickWindow(minutes: number, energy: Task["energyRequirement"], windows: TimeWindow[]): TimeWindow | undefined {
  const wanted: Array<"deep" | "low"> = energy === "low" ? ["low", "deep"] : ["deep", "low"];
  for (const tag of wanted) {
    const fit = windows
      .filter((w) => w.energyTag === tag && w.minutes >= minutes)
      .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    if (fit) return fit;
  }
  return windows.filter((w) => w.minutes >= minutes).sort((a, b) => b.minutes - a.minutes)[0];
}

function blockFor(task: Task, window: TimeWindow, minutes: number, reason: string): PlannedBlock {
  const startTime = window.start;
  const endTime = new Date(startTime.getTime() + minutes * 60000);
  return { id: generateId("block"), taskId: task.id, startTime, endTime, durationMinutes: minutes, reason };
}

export interface FeasibilityContext {
  task: Task;
  date: Date;
  /** Already-planned blocks for this date, excluding any blocks belonging to `task` itself. */
  currentSchedule: PlannedBlock[];
  capacity: CapacityBreakdown;
  allTasks: Task[];
  goals: Goal[];
  projects: Project[];
  timeLogs: TimeLog[];
  now: Date;
  weights?: PriorityWeights;
}

/**
 * Implements the spec's 11-step "can I do this today?" algorithm exactly:
 *  1. identify task/project        -> `project` lookup below
 *  2. estimate remaining effort    -> estimation-adjusted minutes minus minutes already logged
 *  3. check deadline                -> `task.deadline`/`deadlineType`
 *  4. check current date            -> `capacity` is assumed pre-computed for `date`
 *  5. remaining usable capacity     -> `capacity.usableMinutes`
 *  6. higher-priority work          -> sum of currentSchedule minutes for tasks scoring above this one
 *  7. check dependencies            -> incomplete dependencies short-circuit to NOT_FEASIBLE
 *  8. check existing schedule       -> recommendedPlan only ever uses `capacity.windows` (already
 *                                       excludes fixed events), so it can never double-book a commitment
 *  9. reserve buffer                -> already netted into `capacity.usableMinutes`, not subtracted twice
 * 10. simulate completion           -> the branch logic below
 * 11. explanation                   -> built via `explainability`, never a bare yes/no
 */
export function checkTaskFeasibility(ctx: FeasibilityContext): FeasibilityResult {
  const { task, currentSchedule, capacity, allTasks, goals, projects, timeLogs, now, weights } = ctx;

  // Step 1
  const project = projects.find((p) => p.id === task.projectId);

  // Step 2
  const adjustments = computeEstimationAdjustments(timeLogs, allTasks);
  const adjustedEstimate = applyEstimationAdjustment(task.estimatedMinutes, task, adjustments);
  const loggedSoFar = timeLogs.filter((l) => l.taskId === task.id).reduce((s, l) => s + l.actualMinutes, 0);
  const remaining = Math.max(0, adjustedEstimate - loggedSoFar);

  // Step 3 (deadline info folds into scoring below; nothing extra to compute here)

  // Step 7 — dependencies checked before we even look at capacity: a blocked task is never feasible today.
  const incompleteDeps = getIncompleteDependencies(task, allTasks);
  if (incompleteDeps.length > 0) {
    const names = incompleteDeps.map((d) => `"${d.title}"`).join(", ");
    return {
      feasible: false,
      outcome: "NOT_FEASIBLE",
      availableMinutes: capacity.usableMinutes,
      requiredMinutes: remaining,
      shortfallMinutes: remaining,
      conflictingTasks: incompleteDeps.map((d) => d.id),
      recommendedPlan: [],
      confidence: 0.9,
      explanation: `Not feasible: ${names} must be completed first — "${task.title}" depends on ${incompleteDeps.length > 1 ? "them" : "it"}.`
    };
  }

  // Step 6 — score every task, split currently-scheduled minutes into higher- vs lower/equal-priority.
  const dependents = getAllDependents(task.id, allTasks);
  const thisScore = scoreTask(task, { now, goals, project, dependents, weights }).finalScore;
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const priorityScores = new Map<string, number>();
  for (const t of allTasks) {
    priorityScores.set(
      t.id,
      scoreTask(t, { now, goals, project: projects.find((p) => p.id === t.projectId), dependents: getAllDependents(t.id, allTasks), weights }).finalScore
    );
  }

  const higherPriorityBlocks = currentSchedule.filter((b) => (priorityScores.get(b.taskId) ?? 0) > thisScore);
  const lowerOrEqualBlocks = currentSchedule.filter((b) => (priorityScores.get(b.taskId) ?? 0) <= thisScore);
  const higherPriorityMinutes = higherPriorityBlocks.reduce((s, b) => s + b.durationMinutes, 0);
  const committedMinutes = currentSchedule.reduce((s, b) => s + b.durationMinutes, 0);

  // Step 5 + 9 — usableMinutes already has buffer netted out by the capacity engine.
  const trueFreeMinutes = Math.max(0, capacity.usableMinutes - committedMinutes);
  // "Available capacity" the way the spec's own worked example reports it: usable minus only
  // the commitments that outrank this task (lower-priority work is treated as displaceable).
  const availableMinutes = Math.max(0, capacity.usableMinutes - higherPriorityMinutes);

  // Step 10 — simulate.
  let outcome: FeasibilityOutcome;
  let recommendedPlan: PlannedBlock[] = [];
  let shortfallMinutes = 0;

  if (availableMinutes <= 0) {
    outcome = "NOT_FEASIBLE";
    shortfallMinutes = remaining;
  } else if (trueFreeMinutes >= remaining) {
    outcome = "FEASIBLE";
    const window = pickWindow(remaining, task.energyRequirement, capacity.windows);
    if (window) {
      recommendedPlan = [
        blockFor(
          task,
          window,
          remaining,
          explanationToProse(buildReasoningFactors({ task, priorityScore: scoreTask(task, { now, goals, project, dependents, weights }), window, dependents, now }))
        )
      ];
    }
  } else if (availableMinutes >= remaining) {
    // Fits only if enough lower-priority scheduled time is freed up.
    const neededFromDemotion = remaining - trueFreeMinutes;
    let freed = 0;
    const demoted: string[] = [];
    const remainingCandidates = [...lowerOrEqualBlocks];
    while (freed < neededFromDemotion && remainingCandidates.length > 0) {
      const candidate = findDemotionCandidate(remainingCandidates, priorityScores, task.id);
      if (!candidate) break;
      freed += candidate.durationMinutes;
      demoted.push(candidate.taskId);
      const idx = remainingCandidates.findIndex((b) => b.id === candidate.id);
      remainingCandidates.splice(idx, 1);
    }
    outcome = "FEASIBLE_IF_MOVED";
    shortfallMinutes = Math.max(0, neededFromDemotion - freed);
    const window = pickWindow(Math.min(remaining, trueFreeMinutes + freed), task.energyRequirement, capacity.windows);
    const demotedTitles = demoted.map((id) => tasksById.get(id)?.title ?? id).join(", ");
    if (window) {
      recommendedPlan = [
        blockFor(
          task,
          window,
          Math.min(remaining, trueFreeMinutes + freed),
          `Feasible if lower-priority work moves: ${demotedTitles || "a lower-priority task"} would need to be rescheduled to free up ${formatMinutes(neededFromDemotion)}.`
        )
      ];
    }
  } else {
    outcome = "PARTIAL";
    shortfallMinutes = remaining - availableMinutes;
    if (trueFreeMinutes > 0) {
      const doableToday = Math.min(trueFreeMinutes, remaining);
      const window = pickWindow(doableToday, task.energyRequirement, capacity.windows);
      if (window) {
        recommendedPlan = [
          blockFor(
            task,
            window,
            doableToday,
            `Partial today: you can responsibly fit ${formatMinutes(doableToday)} of "${task.title}" — move the remaining ${formatMinutes(remaining - doableToday)} to tomorrow.`
          )
        ];
      }
    }
  }

  const feasible = outcome === "FEASIBLE";

  const adjustment = adjustments.get(
    task.difficulty ? `difficulty:${task.difficulty}` : ""
  );
  const confidence = adjustment && adjustment.confidence >= 0.3 ? Math.min(1, 0.5 + 0.5 * adjustment.confidence) : 0.5;

  const explanation = buildExplanation({
    outcome,
    task,
    remaining,
    availableMinutes,
    trueFreeMinutes,
    higherPriorityMinutes,
    higherPriorityBlocks,
    tasksById,
    recommendedPlan
  });

  return {
    feasible,
    outcome,
    availableMinutes,
    requiredMinutes: remaining,
    shortfallMinutes,
    conflictingTasks: higherPriorityBlocks.map((b) => b.taskId),
    recommendedPlan,
    confidence,
    explanation
  };
}

function buildExplanation(params: {
  outcome: FeasibilityOutcome;
  task: Task;
  remaining: number;
  availableMinutes: number;
  trueFreeMinutes: number;
  higherPriorityMinutes: number;
  higherPriorityBlocks: PlannedBlock[];
  tasksById: Map<string, Task>;
  recommendedPlan: PlannedBlock[];
}): string {
  const { outcome, task, remaining, availableMinutes, higherPriorityMinutes, recommendedPlan } = params;
  const lines: string[] = [
    `Task: ${task.title}`,
    `Estimated work: ${formatMinutes(remaining)}`,
    `Higher-priority commitments: ${formatMinutes(higherPriorityMinutes)}`,
    `Remaining capacity: ${formatMinutes(availableMinutes)}`
  ];

  switch (outcome) {
    case "FEASIBLE":
      lines.push("Result: YES — this fits in today's usable capacity without moving anything else.");
      break;
    case "FEASIBLE_IF_MOVED":
      lines.push(
        `Result: ONLY IF LOWER-PRIORITY WORK MOVES — ${recommendedPlan[0]?.reason ?? "a lower-priority task needs to move first."}`
      );
      break;
    case "PARTIAL":
      lines.push(
        `Result: NO, not fully today. ${recommendedPlan[0]?.reason ?? `You cannot responsibly finish all of "${task.title}" today.`}`
      );
      break;
    case "NOT_FEASIBLE":
      lines.push(`Result: NO — there isn't enough remaining capacity today, even after accounting for what's displaceable.`);
      break;
  }
  return lines.join("\n");
}
