import type {
  CalendarEvent,
  CapacityBreakdown,
  DecisionLog,
  Goal,
  PlannedBlock,
  Project,
  Task,
  TimeLog,
  UserProfile
} from "../types/index";
import { calculateCapacity } from "./capacityEngine";
import { CapacityConfig } from "../config/capacityConfig";
import { PriorityWeights } from "../config/priorityWeights";
import { getAllDependents, getBlockedTaskIds } from "./dependencyGraph";
import { scoreTask } from "./priorityEngine";
import { buildReasoningFactors, explanationToProse } from "./explainability";
import { applyEstimationAdjustment, computeEstimationAdjustments } from "./estimationLearning";
import { generateId } from "../util/id";
import { formatMinutes, localDateKey, minutesBetween } from "../util/time";

/** Blocks shorter than this are never created — a 3-minute sliver isn't useful work. */
const MIN_BLOCK_MINUTES = 10;

const ACTIVE_STATUSES = new Set(["inbox", "planned", "in_progress"]);

export interface PlanDayResult {
  blocks: PlannedBlock[];
  capacity: CapacityBreakdown;
  decisions: DecisionLog[];
  /** Eligible-but-unscheduled task IDs — the "these need to move" list, per the core
   * product principle: realistic progress over cramming everything in. */
  unscheduledTaskIds: string[];
}

export interface PlanDayParams {
  date: Date;
  tasks: Task[];
  events: CalendarEvent[];
  user: UserProfile;
  goals: Goal[];
  projects: Project[];
  timeLogs: TimeLog[];
  capacityConfig?: CapacityConfig;
  priorityWeights?: PriorityWeights;
}

function tieBreakSort(a: { task: Task; score: number }, b: { task: Task; score: number }): number {
  if (b.score !== a.score) return b.score - a.score;
  const aDeadline = a.task.deadline?.getTime() ?? Infinity;
  const bDeadline = b.task.deadline?.getTime() ?? Infinity;
  if (aDeadline !== bDeadline) return aDeadline - bDeadline;
  return a.task.estimatedMinutes - b.task.estimatedMinutes;
}

/**
 * Greedy priority-first bin-packing of eligible tasks into today's real free windows.
 * Never exceeds `capacity.usableMinutes` (the buffer is structural, not optional), and
 * energy requirements gate which window a task can use: a 'high' energy task can only
 * go in a 'deep' window; 'low'/'medium' tasks prefer their matching tag but can fall
 * back into a 'deep' window only once nothing better-suited is competing for it, so a
 * good deep-work block isn't wasted on admin work while real deep work waits.
 */
export function planDay(params: PlanDayParams): PlanDayResult {
  const { date, tasks, events, user, goals, projects, timeLogs, capacityConfig, priorityWeights } = params;
  const capacity = calculateCapacity({ date, user, events, config: capacityConfig });

  const blockedIds = getBlockedTaskIds(tasks);
  const dateKey = localDateKey(date, user.timezone);
  const eligible = tasks.filter(
    (t) =>
      ACTIVE_STATUSES.has(t.status) &&
      !blockedIds.has(t.id) &&
      (!t.deferredUntil || localDateKey(t.deferredUntil, user.timezone) <= dateKey)
  );

  const adjustments = computeEstimationAdjustments(timeLogs, tasks);
  const taskRemaining = new Map<string, number>();
  const originalRemaining = new Map<string, number>();
  for (const t of eligible) {
    const adjustedEstimate = applyEstimationAdjustment(t.estimatedMinutes, t, adjustments);
    const loggedSoFar = timeLogs.filter((l) => l.taskId === t.id).reduce((s, l) => s + l.actualMinutes, 0);
    const remaining = Math.max(0, adjustedEstimate - loggedSoFar);
    taskRemaining.set(t.id, remaining);
    originalRemaining.set(t.id, remaining);
  }

  const scoresByTaskId = new Map<string, number>();
  for (const t of eligible) {
    const project = projects.find((p) => p.id === t.projectId);
    const dependents = getAllDependents(t.id, tasks);
    scoresByTaskId.set(t.id, scoreTask(t, { now: date, goals, project, dependents, weights: priorityWeights }).finalScore);
  }

  const blocks: PlannedBlock[] = [];
  let globalRemaining = capacity.usableMinutes;

  const sortedWindows = [...capacity.windows].sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const window of sortedWindows) {
    let windowRemaining = window.minutes;
    while (windowRemaining >= MIN_BLOCK_MINUTES && globalRemaining >= MIN_BLOCK_MINUTES) {
      const preferredEnergies = window.energyTag === "deep" ? ["high", "medium"] : ["low", "medium"];
      let pool = eligible.filter(
        (t) => (taskRemaining.get(t.id) ?? 0) >= MIN_BLOCK_MINUTES && preferredEnergies.includes(t.energyRequirement)
      );
      if (pool.length === 0 && window.energyTag === "deep") {
        pool = eligible.filter((t) => (taskRemaining.get(t.id) ?? 0) >= MIN_BLOCK_MINUTES && t.energyRequirement === "low");
      }
      if (pool.length === 0) break;

      const ranked = pool
        .map((t) => ({ task: t, score: scoresByTaskId.get(t.id) ?? 0 }))
        .sort(tieBreakSort);
      const chosen = ranked[0].task;

      const sessionCap =
        window.energyTag === "deep" ? user.productivityPreferences.maxDeepWorkSession ?? Infinity : Infinity;
      const minutesForBlock = Math.min(
        taskRemaining.get(chosen.id) ?? 0,
        windowRemaining,
        globalRemaining,
        sessionCap
      );
      if (minutesForBlock < MIN_BLOCK_MINUTES) break;

      const startTime = new Date(window.end.getTime() - windowRemaining * 60000);
      const endTime = new Date(startTime.getTime() + minutesForBlock * 60000);
      const project = projects.find((p) => p.id === chosen.projectId);
      const dependents = getAllDependents(chosen.id, tasks);
      const priorityScore = scoreTask(chosen, { now: date, goals, project, dependents, weights: priorityWeights });
      const reason = explanationToProse(
        buildReasoningFactors({ task: chosen, priorityScore, window, dependents, now: date })
      );

      blocks.push({ id: generateId("block"), taskId: chosen.id, startTime, endTime, durationMinutes: minutesForBlock, reason });

      taskRemaining.set(chosen.id, (taskRemaining.get(chosen.id) ?? 0) - minutesForBlock);
      windowRemaining -= minutesForBlock;
      globalRemaining -= minutesForBlock;
    }
  }

  const unscheduledTaskIds = eligible
    .filter((t) => (taskRemaining.get(t.id) ?? 0) >= (originalRemaining.get(t.id) ?? 0) && (originalRemaining.get(t.id) ?? 0) > 0)
    .map((t) => t.id);

  const decisions: DecisionLog[] = [];
  if (unscheduledTaskIds.length > 0) {
    const names = unscheduledTaskIds
      .slice(0, 5)
      .map((id) => tasks.find((t) => t.id === id)?.title ?? id)
      .join(", ");
    decisions.push({
      id: generateId("decision"),
      decision: `${unscheduledTaskIds.length} task(s) did not fit in today's plan: ${names}${unscheduledTaskIds.length > 5 ? ", ..." : ""}.`,
      reason: "Higher-priority work already fills today's usable capacity. These need to move rather than being crammed in.",
      affectedTasks: unscheduledTaskIds,
      timestamp: date
    });
  }

  return { blocks, capacity, decisions, unscheduledTaskIds };
}

export interface PlanWeekResult {
  days: Record<string, PlanDayResult>;
  decisions: DecisionLog[];
}

export interface PlanWeekParams {
  weekStart: Date;
  tasks: Task[];
  eventsByDay: Record<string, CalendarEvent[]>;
  user: UserProfile;
  goals: Goal[];
  projects: Project[];
  timeLogs: TimeLog[];
  capacityConfig?: CapacityConfig;
  priorityWeights?: PriorityWeights;
}

export function planWeek(params: PlanWeekParams): PlanWeekResult {
  const { weekStart, tasks, eventsByDay, user, goals, projects, timeLogs, capacityConfig, priorityWeights } = params;
  const days: Record<string, PlanDayResult> = {};
  const decisions: DecisionLog[] = [];

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
    const key = localDateKey(date, user.timezone);
    const result = planDay({
      date,
      tasks,
      events: eventsByDay[key] ?? [],
      user,
      goals,
      projects,
      timeLogs,
      capacityConfig,
      priorityWeights
    });
    days[key] = result;
    decisions.push(...result.decisions);
  }

  return { days, decisions };
}
