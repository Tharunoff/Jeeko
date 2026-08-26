import type { DecisionLog, Goal, OverloadWarning, Task, TimeLog } from "../types/index";
import type { PlanWeekResult } from "./schedulingEngine";
import { formatMinutes, localDateKey } from "../util/time";

/**
 * Per-day overload detection for the week view. A day is flagged only when tasks with
 * a *hard* deadline on that day couldn't be scheduled — soft/target deadlines slipping
 * a day is normal triage, not an overload worth alarming the user about.
 */
export function detectOvercommitment(weekResult: PlanWeekResult, tasks: Task[], timezone: string): OverloadWarning[] {
  const warnings: OverloadWarning[] = [];
  const dayEntries = Object.entries(weekResult.days);
  const slackByDay = dayEntries.map(([key, r]) => ({
    key,
    slack: r.capacity.usableMinutes - r.blocks.reduce((s, b) => s + b.durationMinutes, 0)
  }));

  for (const [key, result] of dayEntries) {
    const dueUnscheduled = result.unscheduledTaskIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter(
        (t): t is Task =>
          !!t && !!t.deadline && t.deadlineType === "hard" && localDateKey(t.deadline, timezone) <= key
      );
    if (dueUnscheduled.length === 0) continue;

    const overloadMinutes = dueUnscheduled.reduce((s, t) => s + t.estimatedMinutes, 0);
    const bestSlackDay = slackByDay.filter((d) => d.key !== key).sort((a, b) => b.slack - a.slack)[0];
    const taskNames = dueUnscheduled.map((t) => t.title).join(", ");
    const suggestion =
      bestSlackDay && bestSlackDay.slack > 0
        ? `Consider moving ${taskNames} to ${bestSlackDay.key}, which has ${formatMinutes(bestSlackDay.slack)} of slack.`
        : `${taskNames} may need to be dropped or its deadline renegotiated — no other day has slack this week.`;

    warnings.push({
      date: key,
      usableMinutes: result.capacity.usableMinutes,
      committedMinutes: result.blocks.reduce((s, b) => s + b.durationMinutes, 0),
      overloadMinutes,
      message: `${key} is overloaded by ~${formatMinutes(overloadMinutes)}. ${suggestion}`
    });
  }

  return warnings;
}

export interface WeeklyOvercommitment {
  weeklyCapacityMinutes: number;
  committedMinutes: number;
  overloadMinutes: number;
  warning?: string;
}

/** Whole-week demand vs. capacity — the spec's "WARNING: current capacity 18h, committed 24h" check. */
export function detectWeeklyOvercommitment(weekResult: PlanWeekResult, tasks: Task[]): WeeklyOvercommitment {
  let capacityTotal = 0;
  let scheduledTotal = 0;
  const unscheduledIds = new Set<string>();
  for (const day of Object.values(weekResult.days)) {
    capacityTotal += day.capacity.usableMinutes;
    scheduledTotal += day.blocks.reduce((s, b) => s + b.durationMinutes, 0);
    for (const id of day.unscheduledTaskIds) unscheduledIds.add(id);
  }
  const unscheduledMinutes = [...unscheduledIds].reduce(
    (s, id) => s + (tasks.find((t) => t.id === id)?.estimatedMinutes ?? 0),
    0
  );
  const committedMinutes = scheduledTotal + unscheduledMinutes;
  const overloadMinutes = Math.max(0, committedMinutes - capacityTotal);

  return {
    weeklyCapacityMinutes: capacityTotal,
    committedMinutes,
    overloadMinutes,
    warning:
      overloadMinutes > 0
        ? `Current weekly capacity is ${formatMinutes(capacityTotal)}, but committed work totals ${formatMinutes(committedMinutes)} — that's ${formatMinutes(overloadMinutes)} more than realistically fits.`
        : undefined
  };
}

export interface ProcrastinationFlag {
  taskId: string;
  title: string;
  postponedCount: number;
}

const MIN_POSTPONEMENTS_TO_FLAG = 3;

/** Flags tasks repeatedly bumped by scheduling/conflict decisions — a scheduling/sizing
 * observation, never a psychological diagnosis. */
export function detectProcrastination(decisions: DecisionLog[], tasks: Task[]): ProcrastinationFlag[] {
  const counts = new Map<string, number>();
  for (const d of decisions) {
    const isPostponement = /moved|did not fit|not feasible/i.test(d.decision);
    if (!isPostponement) continue;
    const taskId = d.affectedTasks[d.affectedTasks.length - 1];
    if (!taskId) continue;
    counts.set(taskId, (counts.get(taskId) ?? 0) + 1);
  }
  const flags: ProcrastinationFlag[] = [];
  for (const [taskId, count] of counts) {
    if (count >= MIN_POSTPONEMENTS_TO_FLAG) {
      flags.push({ taskId, title: tasks.find((t) => t.id === taskId)?.title ?? taskId, postponedCount: count });
    }
  }
  return flags.sort((a, b) => b.postponedCount - a.postponedCount);
}

export interface GoalDriftResult {
  alignedMinutes: number;
  unalignedMinutes: number;
  alignedFraction: number;
  drifting: boolean;
  message?: string;
}

/** Time actually going to goal-aligned tasks over a trailing window is below the given
 * threshold below is treated as drift. Purely factual — no judgment about *why*. */
const DRIFT_THRESHOLD_FRACTION = 0.4;

export function detectGoalDrift(params: {
  timeLogs: TimeLog[];
  tasks: Task[];
  goals: Goal[];
  now: Date;
  trailingDays?: number;
}): GoalDriftResult {
  const trailingDays = params.trailingDays ?? 7;
  const cutoff = new Date(params.now.getTime() - trailingDays * 24 * 60 * 60 * 1000);
  const activeGoalIds = new Set(params.goals.filter((g) => g.status === "active").map((g) => g.id));
  const tasksById = new Map(params.tasks.map((t) => [t.id, t]));

  let aligned = 0;
  let unaligned = 0;
  for (const log of params.timeLogs) {
    if (log.createdAt.getTime() < cutoff.getTime()) continue;
    const task = tasksById.get(log.taskId);
    const isAligned = !!task && task.goalIds.some((id) => activeGoalIds.has(id));
    if (isAligned) aligned += log.actualMinutes;
    else unaligned += log.actualMinutes;
  }

  const total = aligned + unaligned;
  const alignedFraction = total > 0 ? aligned / total : 1;
  const drifting = total > 0 && alignedFraction < DRIFT_THRESHOLD_FRACTION;

  return {
    alignedMinutes: aligned,
    unalignedMinutes: unaligned,
    alignedFraction,
    drifting,
    message: drifting
      ? `Only ${Math.round(alignedFraction * 100)}% of your logged time over the last ${trailingDays} days went toward your active goals — most of your capacity is going elsewhere.`
      : undefined
  };
}
