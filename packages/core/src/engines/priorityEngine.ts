import type { Goal, PriorityScore, Project, Task } from "../types/index";
import { DEFAULT_PRIORITY_WEIGHTS, PriorityWeights } from "../config/priorityWeights";

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Multiplier applied to deadline pressure by deadline type — a hard deadline presses
 * at full strength; a soft one presses less because it can genuinely move; a "target"
 * is the user's own preference, not a real constraint, so it presses least. */
const DEADLINE_TYPE_MULTIPLIER: Record<string, number> = {
  hard: 1.0,
  soft: 0.7,
  target: 0.5,
  none: 0
};

/** How much estimated effort (in minutes) counts as "large" for the effort tie-breaker.
 * Beyond this, extra size stops further reducing the effort component. */
const LARGE_TASK_MINUTES = 480; // 8 hours

export function computeDeadlinePressure(task: Pick<Task, "deadline" | "deadlineType">, now: Date): number {
  if (!task.deadline || task.deadlineType === "none" || !task.deadlineType) return 0;
  const daysUntil = (task.deadline.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  const base = daysUntil <= 0 ? 1 : clamp01(1 / (1 + daysUntil));
  return clamp01(base * (DEADLINE_TYPE_MULTIPLIER[task.deadlineType] ?? 0));
}

export function computeConsequenceOfDelay(
  task: Pick<Task, "deadline" | "deadlineType" | "estimatedMinutes">,
  now: Date
): number {
  if (!task.deadline || task.deadlineType === "none" || !task.deadlineType) return 0;
  const minutesUntilDeadline = (task.deadline.getTime() - now.getTime()) / 60000;
  const slackMinutes = minutesUntilDeadline - task.estimatedMinutes;
  if (slackMinutes <= 0) return 1; // no slack left (or already overdue) — delaying further is maximally costly
  // Slack of 3x the task's own length or more is treated as "plenty of room"; less than that ramps up linearly.
  return clamp01(1 - slackMinutes / (task.estimatedMinutes * 3 || 1));
}

export function computeGoalAlignment(goalIds: string[], goals: Goal[]): number {
  const linked = goals.filter((g) => goalIds.includes(g.id) && g.status === "active");
  if (linked.length === 0) return 0;
  return clamp01(Math.max(...linked.map((g) => g.priorityWeight)));
}

export function computeDependencyImpact(dependents: Task[], now: Date): number {
  if (dependents.length === 0) return 0;
  const base = clamp01(dependents.length / 3);
  const hasUrgentDependent = dependents.some(
    (d) => d.deadlineType === "hard" && d.deadline && (d.deadline.getTime() - now.getTime()) / 86400000 <= 3
  );
  return clamp01(base + (hasUrgentDependent ? 0.2 : 0));
}

export interface ScoreTaskContext {
  now: Date;
  goals: Goal[];
  project?: Project;
  dependents: Task[]; // tasks that depend on this one (blocked/waiting on it)
  weights?: PriorityWeights;
}

/**
 * Dynamic priority scoring. Deliberately does NOT just echo `task.priorityOverride`/
 * `task.urgency` back out — per the spec, manually entered priority is a signal, not
 * the source of truth, unless `priorityOverride` is explicitly set (an explicit escape
 * hatch the user controls).
 */
export function scoreTask(task: Task, ctx: ScoreTaskContext): PriorityScore {
  const weights = ctx.weights ?? DEFAULT_PRIORITY_WEIGHTS;

  const deadlinePressure = computeDeadlinePressure(task, ctx.now);
  const importance = ctx.project
    ? clamp01((task.importance + ctx.project.importance) / 2)
    : clamp01(task.importance);
  const goalAlignment = computeGoalAlignment(
    [...task.goalIds, ...(ctx.project?.goalIds ?? [])],
    ctx.goals
  );
  const dependencyImpact = computeDependencyImpact(ctx.dependents, ctx.now);
  const consequenceOfDelay = computeConsequenceOfDelay(task, ctx.now);
  // Informational blend of the manual signal and computed deadline pressure — shown for
  // transparency but not separately weighted into finalScore (that would double-count
  // deadlinePressure), per "do not rely entirely on manually entered priority."
  const urgency = clamp01(0.5 * task.urgency + 0.5 * deadlinePressure);

  // Small tie-breaker: smaller tasks score marginally higher so they don't get crowded
  // out by one large task, without ever being able to outweigh deadline/importance
  // (see priorityWeights.ts for why effortPenalty's weight is kept low).
  const effortComponent = clamp01(1 - task.estimatedMinutes / LARGE_TASK_MINUTES);

  const weightedSum =
    weights.deadlinePressure * deadlinePressure +
    weights.importance * importance +
    weights.goalAlignment * goalAlignment +
    weights.dependencyImpact * dependencyImpact +
    weights.consequenceOfDelay * consequenceOfDelay +
    weights.effortPenalty * effortComponent;

  const finalScore = task.priorityOverride !== undefined ? clamp01(task.priorityOverride) : clamp01(weightedSum);

  return {
    urgency,
    importance,
    goalAlignment,
    dependencyImpact,
    deadlinePressure,
    consequenceOfDelay,
    finalScore
  };
}
