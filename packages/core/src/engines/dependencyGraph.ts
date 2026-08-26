import type { Task } from "../types/index";

/** Dependency statuses that count as "still blocking". A cancelled prerequisite
 * shouldn't leave its dependent stuck forever, so 'cancelled' is deliberately excluded. */
const BLOCKING_STATUSES = new Set(["inbox", "planned", "in_progress", "blocked"]);

export function getTaskById(tasks: Task[], id: string): Task | undefined {
  return tasks.find((t) => t.id === id);
}

/** Tasks that list `taskId` as a dependency (direct dependents only). */
export function getDirectDependents(taskId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.dependencies.includes(taskId));
}

/** All downstream tasks (direct + transitive) that depend on `taskId`, cycle-safe. */
export function getAllDependents(taskId: string, tasks: Task[]): Task[] {
  const result = new Map<string, Task>();
  const visited = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of getDirectDependents(current, tasks)) {
      if (!result.has(dep.id)) {
        result.set(dep.id, dep);
        queue.push(dep.id);
      }
    }
  }
  return [...result.values()];
}

/** Incomplete dependencies for a task (the ones actually blocking it right now). */
export function getIncompleteDependencies(task: Task, tasks: Task[]): Task[] {
  return task.dependencies
    .map((id) => getTaskById(tasks, id))
    .filter((t): t is Task => !!t && BLOCKING_STATUSES.has(t.status));
}

export function isBlocked(task: Task, tasks: Task[]): boolean {
  return getIncompleteDependencies(task, tasks).length > 0;
}

/** IDs of every task currently blocked by an incomplete dependency. */
export function getBlockedTaskIds(tasks: Task[]): Set<string> {
  const blocked = new Set<string>();
  for (const t of tasks) {
    if (isBlocked(t, tasks)) blocked.add(t.id);
  }
  return blocked;
}

/** Defensive cycle detection so bad data can never crash scheduling — returns each cycle found as an ID list. */
export function detectCycles(tasks: Task[]): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const startIdx = stack.indexOf(id);
      cycles.push(stack.slice(startIdx >= 0 ? startIdx : 0).concat(id));
      return;
    }
    visiting.add(id);
    stack.push(id);
    const task = getTaskById(tasks, id);
    for (const depId of task?.dependencies ?? []) {
      visit(depId);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  }

  for (const t of tasks) visit(t.id);
  return cycles;
}

/** Topological order (dependencies before dependents). Tasks involved in a cycle are appended
 * in original order at the end rather than throwing — scheduling must never crash on bad data. */
export function topologicalOrder(tasks: Task[]): Task[] {
  const cyclic = new Set(detectCycles(tasks).flat());
  const acyclic = tasks.filter((t) => !cyclic.has(t.id));
  const result: Task[] = [];
  const visited = new Set<string>();

  function visit(task: Task) {
    if (visited.has(task.id)) return;
    visited.add(task.id);
    for (const depId of task.dependencies) {
      const dep = getTaskById(acyclic, depId);
      if (dep) visit(dep);
    }
    result.push(task);
  }

  for (const t of acyclic) visit(t);
  return [...result, ...tasks.filter((t) => cyclic.has(t.id))];
}
