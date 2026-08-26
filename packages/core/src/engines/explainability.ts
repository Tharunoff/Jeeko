import type { PriorityScore, ReasoningFactor, Task, TimeWindow } from "../types/index";
import { formatMinutes } from "../util/time";

/**
 * Single shared source of truth for "why". Every `reason`/`explanation` field the
 * app produces — PlannedBlock.reason, FeasibilityResult.explanation, DecisionLog.reason,
 * and the LLM's prose replies — is built from this function's output, so the UI and
 * the chat assistant can never give contradictory explanations for the same decision.
 * The LLM is only ever allowed to restyle this factor list into prose, never invent
 * new factors.
 */
export function buildReasoningFactors(input: {
  task: Task;
  priorityScore: PriorityScore;
  window?: TimeWindow;
  dependents?: Task[];
  now?: Date;
}): ReasoningFactor[] {
  const { task, priorityScore, window, dependents, now } = input;
  const factors: ReasoningFactor[] = [];

  if (task.deadline && task.deadlineType && task.deadlineType !== "none") {
    const reference = now ?? new Date();
    const daysUntil = Math.ceil((task.deadline.getTime() - reference.getTime()) / 86400000);
    const when =
      daysUntil < 0
        ? `overdue by ${Math.abs(daysUntil)} day(s)`
        : daysUntil === 0
          ? "due today"
          : daysUntil === 1
            ? "due tomorrow"
            : `due in ${daysUntil} days`;
    factors.push({
      label: `${task.deadlineType === "hard" ? "Hard deadline" : task.deadlineType === "soft" ? "Deadline" : "Target date"}`,
      detail: `${when}.`,
      weight: priorityScore.deadlinePressure
    });
  }

  if (priorityScore.importance >= 0.6) {
    factors.push({
      label: "High importance",
      detail: "This task is marked as high-importance work.",
      weight: priorityScore.importance
    });
  }

  if (priorityScore.goalAlignment > 0) {
    factors.push({
      label: "Goal alignment",
      detail: "This directly contributes to one of your active goals.",
      weight: priorityScore.goalAlignment
    });
  }

  if (dependents && dependents.length > 0) {
    factors.push({
      label: "Blocks other work",
      detail: `${dependents.length} other task(s) are waiting on this one.`,
      weight: priorityScore.dependencyImpact
    });
  }

  if (priorityScore.consequenceOfDelay >= 0.5) {
    factors.push({
      label: "Little slack left",
      detail: "Delaying this further would put its deadline at real risk.",
      weight: priorityScore.consequenceOfDelay
    });
  }

  if (window) {
    factors.push({
      label: "Fits your schedule",
      detail: `You have a ${formatMinutes(window.minutes)} ${window.energyTag === "deep" ? "uninterrupted" : "open"} window here.`
    });
  }

  if (factors.length === 0) {
    factors.push({
      label: "Currently highest-value",
      detail: "No other task currently scores higher given deadlines, goals, and dependencies.",
      weight: priorityScore.finalScore
    });
  }

  return factors;
}

/** Turns a factor list into a short numbered explanation, the same shape the spec's
 * "Why?" examples use. Pure formatting — never adds information not present in `factors`. */
export function explanationToProse(factors: ReasoningFactor[]): string {
  return factors.map((f, i) => `${i + 1}. ${f.label}: ${f.detail}`).join("\n");
}
