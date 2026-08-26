import type { Difficulty, Task, TimeLog } from "../types/index";

export interface EstimationAdjustment {
  category: string;
  sampleSize: number;
  meanRatio: number; // actual / estimated, averaged
  confidence: number; // 0..1
}

/** Minimum logged samples before a category's ratio is trusted at all. Below this,
 * one or two outliers could swing the estimate wildly, so we hold off adjusting. */
const MIN_SAMPLE_SIZE = 3;
/** Sample count at which confidence maxes out. */
const CONFIDENCE_SATURATION_SAMPLES = 10;
/** Below this confidence, the learned adjustment is ignored entirely rather than applied weakly. */
const MIN_CONFIDENCE_TO_APPLY = 0.3;

const CATEGORY_KEYWORDS: Array<{ category: string; pattern: RegExp }> = [
  { category: "coding", pattern: /\b(code|coding|bug|debug|implement|api|refactor|feature)\b/i },
  { category: "writing", pattern: /\b(write|writing|essay|report|draft|paper)\b/i },
  { category: "reading", pattern: /\b(read|reading|review paper|literature)\b/i },
  { category: "admin", pattern: /\b(email|admin|paperwork|form|schedule|organi[sz]e)\b/i },
  { category: "exam", pattern: /\b(exam|test|quiz|study)\b/i }
];

/**
 * Buckets a task into a category for estimation-learning purposes. The spec's Task
 * type has no explicit "category" field, so this falls back to `difficulty` (always
 * present) refined by keyword matches over title/description when one is found.
 */
export function categoryOf(task: Pick<Task, "title" | "description" | "difficulty">): string {
  const text = `${task.title} ${task.description ?? ""}`;
  for (const { category, pattern } of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return `difficulty:${task.difficulty as Difficulty}`;
}

/**
 * Computes actual/estimated ratios per category from real recorded time logs — never
 * invented assumptions. `tasks` is used to look up each log's category via its task.
 */
export function computeEstimationAdjustments(
  timeLogs: TimeLog[],
  tasks: Task[]
): Map<string, EstimationAdjustment> {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const ratiosByCategory = new Map<string, number[]>();

  for (const log of timeLogs) {
    const task = tasksById.get(log.taskId);
    if (!task || log.estimatedMinutesAtTime <= 0) continue;
    const category = categoryOf(task);
    const ratio = log.actualMinutes / log.estimatedMinutesAtTime;
    if (!ratiosByCategory.has(category)) ratiosByCategory.set(category, []);
    ratiosByCategory.get(category)!.push(ratio);
  }

  const adjustments = new Map<string, EstimationAdjustment>();
  for (const [category, ratios] of ratiosByCategory) {
    const sampleSize = ratios.length;
    const meanRatio = ratios.reduce((a, b) => a + b, 0) / sampleSize;
    const confidence = sampleSize < MIN_SAMPLE_SIZE ? 0 : Math.min(1, sampleSize / CONFIDENCE_SATURATION_SAMPLES);
    adjustments.set(category, { category, sampleSize, meanRatio, confidence });
  }
  return adjustments;
}

/** Adjusts a raw estimate using the learned ratio for its category, only once there's
 * enough confidence in that ratio — otherwise the original estimate passes through unchanged. */
export function applyEstimationAdjustment(
  estimatedMinutes: number,
  task: Pick<Task, "title" | "description" | "difficulty">,
  adjustments: Map<string, EstimationAdjustment>
): number {
  const adjustment = adjustments.get(categoryOf(task));
  if (!adjustment || adjustment.confidence < MIN_CONFIDENCE_TO_APPLY) return estimatedMinutes;
  return Math.round(estimatedMinutes * adjustment.meanRatio);
}
