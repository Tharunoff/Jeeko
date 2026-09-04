import { executeTool, formatMinutes, type DataStore, type Task } from "@personalos/core";

async function findTaskByName(store: DataStore, name: string): Promise<Task | null> {
  const tasks = await store.listTasks();
  const needle = name.trim().toLowerCase();
  const active = tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled");
  const match =
    active.find((t) => t.title.toLowerCase() === needle) ??
    active.find((t) => t.title.toLowerCase().includes(needle)) ??
    null;
  return match;
}

function parseMinutes(amount: string, unit: string): number {
  const n = parseFloat(amount);
  return /hour|hr/i.test(unit) ? Math.round(n * 60) : Math.round(n);
}

type Handler = (m: RegExpMatchArray, store: DataStore) => Promise<string>;

const now = () => new Date();

async function freeTimeSummary(_m: RegExpMatchArray, store: DataStore): Promise<string> {
  const capacity = (await executeTool("calculate_free_time", {}, { store, now: now() })) as any;
  const windows = capacity.windows
    .map((w: any) => `${new Date(w.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}–${new Date(w.end).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${w.energyTag})`)
    .join("\n");
  return `You have ${formatMinutes(capacity.usableMinutes)} of usable time today.\n${windows}`;
}

async function nextActionSummary(_m: RegExpMatchArray, store: DataStore): Promise<string> {
  const schedule = (await executeTool("get_today_schedule", {}, { store, now: now() })) as any;
  const result = (await executeTool("get_next_action", {}, { store, now: now() })) as any;
  if (!result.now) return "Nothing is currently scheduled — you have open time right now.";
  const lines = [`Do this now: ${result.now.task.title} — ${formatMinutes(result.now.minutesRemaining)} left in this block.`];
  if (result.next) lines.push(`After that: ${result.next.task.title}.`);
  return lines.join("\n");
}

async function recordActual(m: RegExpMatchArray, store: DataStore): Promise<string> {
  const [, amount, unit, name] = m;
  const minutes = parseMinutes(amount, unit);
  const task = await findTaskByName(store, name);
  if (!task) return `I couldn't find a task matching "${name}".`;
  await executeTool("record_actual_duration", { taskId: task.id, actualMinutes: minutes }, { store, now: now() });
  return `Logged ${formatMinutes(minutes)} on "${task.title}".`;
}

async function rescheduleToTomorrow(m: RegExpMatchArray, store: DataStore): Promise<string> {
  const name = m[1];
  const task = await findTaskByName(store, name);
  if (!task) return `I couldn't find a task matching "${name}".`;
  const tomorrow = new Date(now().getTime() + 86400000).toISOString();
  await executeTool("reschedule_task", { taskId: task.id, deferUntil: tomorrow }, { store, now: now() });
  return `Moved "${task.title}" to tomorrow.`;
}

async function feasibilityCheck(m: RegExpMatchArray, store: DataStore): Promise<string> {
  const name = m[1];
  const task = await findTaskByName(store, name);
  if (!task) return `I couldn't find a task matching "${name}".`;
  const result = (await executeTool("check_feasibility", { taskId: task.id }, { store, now: now() })) as any;
  return result.explanation;
}

async function completeTask(m: RegExpMatchArray, store: DataStore): Promise<string> {
  const name = m[1];
  const task = await findTaskByName(store, name);
  if (!task) return `I couldn't find a task matching "${name}".`;
  await executeTool("complete_task", { id: task.id }, { store, now: now() });
  return `Marked "${task.title}" as completed.`;
}

async function todayScheduleSummary(_m: RegExpMatchArray, store: DataStore): Promise<string> {
  const schedule = (await executeTool("get_today_schedule", {}, { store, now: now() })) as any;
  const blocks = schedule.blocks ?? [];
  if (blocks.length === 0) return "You have no tasks scheduled for today — you have open time.";
  const tasks = await store.listTasks();
  const lines = blocks.map((b: any) => {
    const t = tasks.find((task) => task.id === b.taskId);
    return `${new Date(b.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}: ${t?.title ?? b.taskId} (${formatMinutes(b.durationMinutes)})`;
  });
  return `Today's schedule:\n${lines.join("\n")}`;
}

const OFFLINE_PATTERNS: Array<{ pattern: RegExp; handler: Handler }> = [
  { pattern: /today'?s? schedule|schedule (?:for )?today|what(?:'s| is) my schedule/i, handler: todayScheduleSummary },
  { pattern: /how much free time|free time (do i have|today)/i, handler: freeTimeSummary },
  { pattern: /what should i do now|what'?s next|what should i focus on/i, handler: nextActionSummary },
  { pattern: /i (?:spent|worked) (\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?) on (.+)/i, handler: recordActual },
  { pattern: /move (.+) to tomorrow/i, handler: rescheduleToTomorrow },
  { pattern: /i can'?t do (.+) today/i, handler: rescheduleToTomorrow },
  { pattern: /can i (?:fit|finish|do) (.+?)(?: today)?\??$/i, handler: feasibilityCheck },
  { pattern: /mark (.+) (?:as )?(?:done|complete|finished)/i, handler: completeTask }
];

/** Handles a handful of common phrasings entirely offline via deterministic tool
 * calls — no LLM involved. Returns null when nothing matches, so the caller can show
 * an honest "this needs internet" message instead of guessing. */
export async function tryOfflineIntent(text: string, store: DataStore): Promise<string | null> {
  for (const { pattern, handler } of OFFLINE_PATTERNS) {
    const match = text.match(pattern);
    if (match) return handler(match, store);
  }
  return null;
}
