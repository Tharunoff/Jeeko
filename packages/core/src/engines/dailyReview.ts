import type { DailyReview, PlannedBlock, Task, TimeLog } from "../types/index";
import { categoryOf, computeEstimationAdjustments } from "./estimationLearning";
import { localDateKey } from "../util/time";

/** Category whose estimates are furthest off (by % error) is called out by name, so
 * "tomorrow's adjustment" is specific rather than generic. Only surfaced once there's
 * enough history to trust it (same confidence floor as estimationLearning). */
const NOTABLE_ERROR_THRESHOLD = 0.2; // 20% off estimate counts as worth mentioning

export function buildDailyReview(params: {
  date: Date;
  timezone: string;
  todaysBlocks: PlannedBlock[];
  tasks: Task[];
  timeLogs: TimeLog[];
}): Omit<DailyReview, "id" | "createdAt"> {
  const { date, timezone, todaysBlocks, tasks, timeLogs } = params;
  const dateKey = localDateKey(date, timezone);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  const plannedTaskIds = new Set(todaysBlocks.map((b) => b.taskId));
  let completedCount = 0;
  let incompleteCount = 0;
  for (const taskId of plannedTaskIds) {
    const task = tasksById.get(taskId);
    if (task?.status === "completed") completedCount += 1;
    else incompleteCount += 1;
  }

  const estimatedTotalMinutes = todaysBlocks.reduce((s, b) => s + b.durationMinutes, 0);
  const actualTotalMinutes = timeLogs
    .filter((l) => localDateKey(l.createdAt, timezone) === dateKey)
    .reduce((s, l) => s + l.actualMinutes, 0);

  const adjustments = computeEstimationAdjustments(timeLogs, tasks);
  let worst: { category: string; meanRatio: number } | undefined;
  for (const adj of adjustments.values()) {
    if (adj.confidence < 0.3) continue;
    const error = Math.abs(adj.meanRatio - 1);
    if (error >= NOTABLE_ERROR_THRESHOLD && (!worst || error > Math.abs(worst.meanRatio - 1))) {
      worst = { category: adj.category, meanRatio: adj.meanRatio };
    }
  }

  const mainIssue = worst
    ? `${worst.category} tasks were consistently ${worst.meanRatio > 1 ? "underestimated" : "overestimated"} (~${Math.round(Math.abs(worst.meanRatio - 1) * 100)}%).`
    : undefined;
  const tomorrowAdjustment = worst
    ? `Estimates for ${worst.category} tasks will be scaled by the recorded ${worst.meanRatio.toFixed(2)}x history going forward.`
    : "No major estimation issues detected — using estimates as-is.";

  return {
    date: dateKey,
    completedCount,
    incompleteCount,
    estimatedTotalMinutes,
    actualTotalMinutes,
    mainIssue,
    tomorrowAdjustment
  };
}

// re-exported for convenience where callers already import from dailyReview
export { categoryOf };
