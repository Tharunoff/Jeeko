import type { DecisionLog, EnergyLevel, Goal, PlannedBlock, Project, ReasoningFactor, Task } from "../types/index";
import { getAllDependents } from "./dependencyGraph";
import { scoreTask } from "./priorityEngine";
import { buildReasoningFactors } from "./explainability";
import { generateId } from "../util/id";
import { minutesBetween } from "../util/time";

/** A block starting within this many minutes counts as "now" even if it hasn't technically begun. */
const NOW_GRACE_MINUTES = 15;

export interface NextActionEntry {
  task: Task;
  block: PlannedBlock;
  reasoning: ReasoningFactor[];
  minutesRemaining: number;
}

export interface NextActionResult {
  now: NextActionEntry | null;
  next: NextActionEntry | null;
  /** Present only when the plan's originally-scheduled task was swapped out because it
   * didn't match the user's stated energy level right now. */
  energySwapDecision?: DecisionLog;
}

export interface GetNextActionParams {
  now: Date;
  todaysBlocks: PlannedBlock[];
  tasks: Task[];
  goals: Goal[];
  projects: Project[];
  energyState?: EnergyLevel;
}

function toEntry(block: PlannedBlock, task: Task, ctx: GetNextActionParams): NextActionEntry {
  const project = ctx.projects.find((p) => p.id === task.projectId);
  const dependents = getAllDependents(task.id, ctx.tasks);
  const priorityScore = scoreTask(task, { now: ctx.now, goals: ctx.goals, project, dependents });
  return {
    task,
    block,
    minutesRemaining: Math.max(0, minutesBetween(ctx.now, block.endTime)),
    reasoning: buildReasoningFactors({ task, priorityScore, dependents, now: ctx.now })
  };
}

/**
 * "What should I do now?" — inspects the current plan and, if the user has stated an
 * energy level that doesn't match the currently-scheduled task, swaps in the
 * best-fitting eligible task instead of blindly following the original plan (per the
 * spec: "if the user says I'm tired, don't cancel everything — reselect suitable
 * tasks"). This never mutates the persisted plan; callers decide whether to
 * persist the swap.
 */
export function getNextAction(params: GetNextActionParams): NextActionResult {
  const { now, todaysBlocks, tasks, energyState } = params;
  const sorted = [...todaysBlocks].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const graceMs = NOW_GRACE_MINUTES * 60000;

  let activeBlock =
    sorted.find((b) => b.startTime.getTime() <= now.getTime() && b.endTime.getTime() > now.getTime()) ??
    sorted.find((b) => b.startTime.getTime() > now.getTime() && b.startTime.getTime() - now.getTime() <= graceMs);

  if (!activeBlock) {
    const upcoming = sorted.find((b) => b.startTime.getTime() > now.getTime());
    return {
      now: null,
      next: upcoming ? toEntry(upcoming, tasks.find((t) => t.id === upcoming.taskId)!, params) : null
    };
  }

  let activeTask = tasks.find((t) => t.id === activeBlock!.taskId);
  let energySwapDecision: DecisionLog | undefined;

  if (activeTask && energyState && activeTask.energyRequirement !== energyState) {
    const windowMinutes = Math.max(0, minutesBetween(now, activeBlock.endTime));
    const alternative = tasks
      .filter(
        (t) =>
          t.id !== activeTask!.id &&
          t.energyRequirement === energyState &&
          ["inbox", "planned", "in_progress"].includes(t.status) &&
          t.estimatedMinutes <= windowMinutes
      )
      .map((t) => ({
        task: t,
        score: scoreTask(t, {
          now,
          goals: params.goals,
          project: params.projects.find((p) => p.id === t.projectId),
          dependents: getAllDependents(t.id, tasks)
        }).finalScore
      }))
      .sort((a, b) => b.score - a.score)[0];

    if (alternative) {
      energySwapDecision = {
        id: generateId("decision"),
        decision: `Switched now-task from "${activeTask.title}" to "${alternative.task.title}".`,
        reason: `You said your energy is ${energyState}, but "${activeTask.title}" needs ${activeTask.energyRequirement} energy. "${alternative.task.title}" fits your current window and energy level instead.`,
        affectedTasks: [activeTask.id, alternative.task.id],
        timestamp: now
      };
      const swappedBlock: PlannedBlock = {
        ...activeBlock,
        taskId: alternative.task.id,
        endTime: new Date(now.getTime() + alternative.task.estimatedMinutes * 60000)
      };
      activeBlock = swappedBlock;
      activeTask = alternative.task;
    }
  }

  const nowEntry = activeTask ? toEntry(activeBlock, activeTask, params) : null;
  const upcoming = sorted.find((b) => b.startTime.getTime() > (nowEntry?.block.startTime.getTime() ?? now.getTime()) && b.id !== activeBlock?.id);
  const nextEntry = upcoming ? toEntry(upcoming, tasks.find((t) => t.id === upcoming.taskId)!, params) : null;

  return { now: nowEntry, next: nextEntry, energySwapDecision };
}
