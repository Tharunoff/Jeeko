import type { CalendarEvent, DecisionLog, PlannedBlock, Task } from "../types/index";
import { generateId } from "../util/id";
import { formatMinutes, intervalsOverlap } from "../util/time";

/** Every pair of PlannedBlocks whose time ranges overlap. Should always be empty for a
 * schedule the engine produced — this is the safety-net check the spec requires
 * ("never schedule overlapping tasks"). */
export function detectOverlaps(blocks: PlannedBlock[]): Array<[PlannedBlock, PlannedBlock]> {
  const pairs: Array<[PlannedBlock, PlannedBlock]> = [];
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (intervalsOverlap(
        { start: blocks[i].startTime, end: blocks[i].endTime },
        { start: blocks[j].startTime, end: blocks[j].endTime }
      )) {
        pairs.push([blocks[i], blocks[j]]);
      }
    }
  }
  return pairs;
}

/** Blocks that overlap a fixed calendar event — should also always be empty
 * ("never ignore fixed commitments"). */
export function detectEventConflicts(blocks: PlannedBlock[], events: CalendarEvent[]): PlannedBlock[] {
  const fixedEvents = events.filter((e) => e.fixed);
  return blocks.filter((b) =>
    fixedEvents.some((e) =>
      intervalsOverlap({ start: b.startTime, end: b.endTime }, { start: e.startTime, end: e.endTime })
    )
  );
}

/** The lowest-priority currently-planned block, excluding any block for `excludeTaskId`
 * (the task we're trying to make room for). Returns undefined if there's nothing to demote. */
export function findDemotionCandidate(
  blocks: PlannedBlock[],
  priorityScores: Map<string, number>,
  excludeTaskId?: string
): PlannedBlock | undefined {
  const candidates = blocks.filter((b) => b.taskId !== excludeTaskId);
  if (candidates.length === 0) return undefined;
  return candidates.reduce((lowest, b) => {
    const bScore = priorityScores.get(b.taskId) ?? 0;
    const lowestScore = priorityScores.get(lowest.taskId) ?? 0;
    return bScore < lowestScore ? b : lowest;
  }, candidates[0]);
}

/**
 * Called when adding `newTask` would push the day over usable capacity. Finds the
 * lowest-priority already-planned block, removes it (freeing its minutes), and returns
 * a DecisionLog explaining the trade-off — the schedule is never silently over capacity,
 * and nothing is silently deleted (the demoted task just reverts to "planned" for the
 * next day's plan to pick up).
 */
export function resolveOverflow(params: {
  newTask: Task;
  currentBlocks: PlannedBlock[];
  usableMinutes: number;
  requiredMinutes: number;
  priorityScores: Map<string, number>;
  tasksById: Map<string, Task>;
}): { updatedBlocks: PlannedBlock[]; demotedTask?: Task; decision: DecisionLog } {
  const { newTask, currentBlocks, usableMinutes, requiredMinutes, priorityScores, tasksById } = params;
  const committedMinutes = currentBlocks.reduce((s, b) => s + b.durationMinutes, 0);
  const overloadMinutes = Math.max(0, committedMinutes + requiredMinutes - usableMinutes);

  if (overloadMinutes <= 0) {
    return {
      updatedBlocks: currentBlocks,
      decision: {
        id: generateId("decision"),
        decision: `Added "${newTask.title}" without displacing anything.`,
        reason: "There was enough remaining usable capacity today.",
        affectedTasks: [newTask.id],
        timestamp: new Date()
      }
    };
  }

  const candidate = findDemotionCandidate(currentBlocks, priorityScores, newTask.id);
  if (!candidate) {
    return {
      updatedBlocks: currentBlocks,
      decision: {
        id: generateId("decision"),
        decision: `Could not fit "${newTask.title}" today.`,
        reason: `This creates a ${formatMinutes(overloadMinutes)} overload and there is nothing lower-priority to move.`,
        affectedTasks: [newTask.id],
        timestamp: new Date()
      }
    };
  }

  const demotedTask = tasksById.get(candidate.taskId);
  const updatedBlocks = currentBlocks.filter((b) => b.id !== candidate.id);

  return {
    updatedBlocks,
    demotedTask,
    decision: {
      id: generateId("decision"),
      decision: `Moved "${demotedTask?.title ?? candidate.taskId}" to make room for "${newTask.title}".`,
      reason: `Adding "${newTask.title}" creates a ${formatMinutes(overloadMinutes)} overload today. "${demotedTask?.title ?? candidate.taskId}" is currently the lowest-priority planned item, so it moved to free up time.`,
      affectedTasks: [newTask.id, candidate.taskId],
      timestamp: new Date()
    }
  };
}
