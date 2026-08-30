import { z } from "zod";
import type {
  CalendarEvent,
  CalendarEventType,
  Difficulty,
  EnergyLevel,
  FeasibilityResult,
  Goal,
  GoalStatus,
  MemoryEntry,
  MemoryKind,
  Project,
  ProjectStatus,
  Reminder,
  Task,
  TaskStatus,
  TimeLog,
  ToolDeclaration
} from "../types/index";
import type { DataStore } from "../store/DataStore";
import { generateId } from "../util/id";
import { localDateKey } from "../util/time";
import { calculateCapacity } from "../engines/capacityEngine";
import { planDay, planWeek } from "../engines/schedulingEngine";
import { checkTaskFeasibility } from "../engines/feasibilityEngine";
import { scoreTask } from "../engines/priorityEngine";
import { getAllDependents } from "../engines/dependencyGraph";
import { buildReasoningFactors } from "../engines/explainability";
import { getNextAction } from "../engines/nextAction";
import { detectOvercommitment, detectWeeklyOvercommitment } from "../engines/insightsEngine";

export interface ToolContext {
  store: DataStore;
  now: Date;
}

export interface ToolDefinition<Args = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: z.ZodType<Args>;
  handler: (args: Args, ctx: ToolContext) => Promise<unknown>;
}

async function requireUser(ctx: ToolContext) {
  const user = await ctx.store.getUser();
  if (!user) throw new Error("No user profile set up yet.");
  return user;
}

async function requireTask(ctx: ToolContext, id: string): Promise<Task> {
  const task = await ctx.store.getTask(id);
  if (!task) throw new Error(`No task with id "${id}".`);
  return task;
}

function isoDate(v?: string): Date | undefined {
  return v ? new Date(v) : undefined;
}

const energyEnum = z.enum(["low", "medium", "high"]);
const difficultyEnum = z.enum(["easy", "medium", "hard"]);
const deadlineTypeEnum = z.enum(["hard", "soft", "target", "none"]);
const taskStatusEnum = z.enum(["inbox", "planned", "in_progress", "blocked", "completed", "cancelled"]);
const goalStatusEnum = z.enum(["active", "paused", "completed", "cancelled"]);
const eventTypeEnum = z.enum(["class", "meeting", "travel", "meal", "sleep", "appointment", "other"]);

// ---------------------------------------------------------------------------
// create_task
// ---------------------------------------------------------------------------
const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  projectId: z.string().optional(),
  goalIds: z.array(z.string()).optional(),
  estimatedMinutes: z.number().positive(),
  deadline: z.string().optional(),
  deadlineType: deadlineTypeEnum.optional(),
  importance: z.number().min(0).max(1).optional(),
  urgency: z.number().min(0).max(1).optional(),
  energyRequirement: energyEnum.optional(),
  difficulty: difficultyEnum.optional(),
  dependencies: z.array(z.string()).optional()
});
type CreateTaskArgs = z.infer<typeof createTaskSchema>;

const createTask: ToolDefinition<CreateTaskArgs> = {
  name: "create_task",
  description: "Creates a new task. Never fabricate task data the user didn't provide or imply.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      projectId: { type: "string" },
      goalIds: { type: "array", items: { type: "string" } },
      estimatedMinutes: { type: "number" },
      deadline: { type: "string", format: "date-time" },
      deadlineType: { type: "string", enum: ["hard", "soft", "target", "none"] },
      importance: { type: "number" },
      urgency: { type: "number" },
      energyRequirement: { type: "string", enum: ["low", "medium", "high"] },
      difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
      dependencies: { type: "array", items: { type: "string" } }
    },
    required: ["title", "estimatedMinutes"]
  },
  schema: createTaskSchema,
  handler: async (args, ctx) => {
    const now = ctx.now;
    const deadline = isoDate(args.deadline);
    const task: Task = {
      id: generateId("task"),
      title: args.title,
      description: args.description,
      projectId: args.projectId,
      goalIds: args.goalIds ?? [],
      estimatedMinutes: args.estimatedMinutes,
      deadline,
      deadlineType: args.deadlineType ?? (deadline ? "soft" : "none"),
      importance: args.importance ?? 0.5,
      urgency: args.urgency ?? 0.5,
      energyRequirement: (args.energyRequirement ?? "medium") as EnergyLevel,
      difficulty: (args.difficulty ?? "medium") as Difficulty,
      status: "inbox",
      dependencies: args.dependencies ?? [],
      createdAt: now,
      updatedAt: now
    };
    await ctx.store.saveTask(task);
    return { task };
  }
};

// ---------------------------------------------------------------------------
// update_task
// ---------------------------------------------------------------------------
const updateTaskSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  projectId: z.string().optional(),
  goalIds: z.array(z.string()).optional(),
  estimatedMinutes: z.number().positive().optional(),
  deadline: z.string().nullable().optional(),
  deadlineType: deadlineTypeEnum.optional(),
  priorityOverride: z.number().min(0).max(1).nullable().optional(),
  importance: z.number().min(0).max(1).optional(),
  urgency: z.number().min(0).max(1).optional(),
  energyRequirement: energyEnum.optional(),
  difficulty: difficultyEnum.optional(),
  status: taskStatusEnum.optional(),
  dependencies: z.array(z.string()).optional(),
  deferredUntil: z.string().nullable().optional()
});
type UpdateTaskArgs = z.infer<typeof updateTaskSchema>;

const updateTask: ToolDefinition<UpdateTaskArgs> = {
  name: "update_task",
  description: "Updates fields on an existing task. Only changes fields explicitly provided.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      projectId: { type: "string" },
      goalIds: { type: "array", items: { type: "string" } },
      estimatedMinutes: { type: "number" },
      deadline: { type: "string", format: "date-time" },
      deadlineType: { type: "string", enum: ["hard", "soft", "target", "none"] },
      priorityOverride: { type: "number" },
      importance: { type: "number" },
      urgency: { type: "number" },
      energyRequirement: { type: "string", enum: ["low", "medium", "high"] },
      difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
      status: { type: "string", enum: ["inbox", "planned", "in_progress", "blocked", "completed", "cancelled"] },
      dependencies: { type: "array", items: { type: "string" } },
      deferredUntil: { type: "string", format: "date-time" }
    },
    required: ["id"]
  },
  schema: updateTaskSchema,
  handler: async (args, ctx) => {
    const task = await requireTask(ctx, args.id);
    const updated: Task = {
      ...task,
      ...(args.title !== undefined && { title: args.title }),
      ...(args.description !== undefined && { description: args.description }),
      ...(args.projectId !== undefined && { projectId: args.projectId }),
      ...(args.goalIds !== undefined && { goalIds: args.goalIds }),
      ...(args.estimatedMinutes !== undefined && { estimatedMinutes: args.estimatedMinutes }),
      ...(args.deadline !== undefined && { deadline: args.deadline ? new Date(args.deadline) : undefined }),
      ...(args.deadlineType !== undefined && { deadlineType: args.deadlineType }),
      ...(args.priorityOverride !== undefined && { priorityOverride: args.priorityOverride ?? undefined }),
      ...(args.importance !== undefined && { importance: args.importance }),
      ...(args.urgency !== undefined && { urgency: args.urgency }),
      ...(args.energyRequirement !== undefined && { energyRequirement: args.energyRequirement as EnergyLevel }),
      ...(args.difficulty !== undefined && { difficulty: args.difficulty as Difficulty }),
      ...(args.status !== undefined && { status: args.status as TaskStatus }),
      ...(args.dependencies !== undefined && { dependencies: args.dependencies }),
      ...(args.deferredUntil !== undefined && { deferredUntil: args.deferredUntil ? new Date(args.deferredUntil) : undefined }),
      updatedAt: ctx.now
    };
    await ctx.store.saveTask(updated);
    return { task: updated };
  }
};

// ---------------------------------------------------------------------------
// complete_task
// ---------------------------------------------------------------------------
const completeTaskSchema = z.object({
  id: z.string(),
  actualMinutes: z.number().positive().optional()
});
type CompleteTaskArgs = z.infer<typeof completeTaskSchema>;

const completeTask: ToolDefinition<CompleteTaskArgs> = {
  name: "complete_task",
  description: "Marks a task completed. Optionally records the actual time spent (feeds estimation learning).",
  parameters: {
    type: "object",
    properties: { id: { type: "string" }, actualMinutes: { type: "number" } },
    required: ["id"]
  },
  schema: completeTaskSchema,
  handler: async (args, ctx) => {
    const task = await requireTask(ctx, args.id);
    const updated: Task = { ...task, status: "completed", completedAt: ctx.now, updatedAt: ctx.now };
    await ctx.store.saveTask(updated);
    if (args.actualMinutes !== undefined) {
      const log: TimeLog = {
        id: generateId("timelog"),
        taskId: task.id,
        actualMinutes: args.actualMinutes,
        estimatedMinutesAtTime: task.estimatedMinutes,
        createdAt: ctx.now
      };
      await ctx.store.saveTimeLog(log);
    }
    return { task: updated };
  }
};

// ---------------------------------------------------------------------------
// delete_task
// ---------------------------------------------------------------------------
const deleteTaskSchema = z.object({ id: z.string() });
const deleteTask: ToolDefinition<z.infer<typeof deleteTaskSchema>> = {
  name: "delete_task",
  description: "Permanently deletes a task. Only call this when the user explicitly asks to delete/remove a task.",
  parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  schema: deleteTaskSchema,
  handler: async (args, ctx) => {
    await requireTask(ctx, args.id);
    await ctx.store.deleteTask(args.id);
    return { deleted: args.id };
  }
};

// ---------------------------------------------------------------------------
// create_goal / update_goal
// ---------------------------------------------------------------------------
const createGoalSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priorityWeight: z.number().min(0).max(1).optional(),
  deadline: z.string().optional()
});
const createGoal: ToolDefinition<z.infer<typeof createGoalSchema>> = {
  name: "create_goal",
  description: "Creates a new long-term goal.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      priorityWeight: { type: "number" },
      deadline: { type: "string", format: "date-time" }
    },
    required: ["title"]
  },
  schema: createGoalSchema,
  handler: async (args, ctx) => {
    const goal: Goal = {
      id: generateId("goal"),
      title: args.title,
      description: args.description,
      priorityWeight: args.priorityWeight ?? 0.5,
      deadline: isoDate(args.deadline),
      status: "active",
      progress: 0,
      createdAt: ctx.now,
      updatedAt: ctx.now
    };
    await ctx.store.saveGoal(goal);
    return { goal };
  }
};

const updateGoalSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  priorityWeight: z.number().min(0).max(1).optional(),
  deadline: z.string().nullable().optional(),
  status: goalStatusEnum.optional(),
  progress: z.number().min(0).max(1).optional()
});
const updateGoal: ToolDefinition<z.infer<typeof updateGoalSchema>> = {
  name: "update_goal",
  description: "Updates fields on an existing goal.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      priorityWeight: { type: "number" },
      deadline: { type: "string", format: "date-time" },
      status: { type: "string", enum: ["active", "paused", "completed", "cancelled"] },
      progress: { type: "number" }
    },
    required: ["id"]
  },
  schema: updateGoalSchema,
  handler: async (args, ctx) => {
    const goal = await ctx.store.getGoal(args.id);
    if (!goal) throw new Error(`No goal with id "${args.id}".`);
    const updated: Goal = {
      ...goal,
      ...(args.title !== undefined && { title: args.title }),
      ...(args.description !== undefined && { description: args.description }),
      ...(args.priorityWeight !== undefined && { priorityWeight: args.priorityWeight }),
      ...(args.deadline !== undefined && { deadline: args.deadline ? new Date(args.deadline) : undefined }),
      ...(args.status !== undefined && { status: args.status as GoalStatus }),
      ...(args.progress !== undefined && { progress: args.progress }),
      updatedAt: ctx.now
    };
    await ctx.store.saveGoal(updated);
    return { goal: updated };
  }
};

// ---------------------------------------------------------------------------
// create_project / update_project
// ---------------------------------------------------------------------------
const createProjectSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  goalIds: z.array(z.string()).optional(),
  deadline: z.string().optional(),
  importance: z.number().min(0).max(1).optional()
});
const createProject: ToolDefinition<z.infer<typeof createProjectSchema>> = {
  name: "create_project",
  description: "Creates a new project, optionally linked to one or more goals.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      description: { type: "string" },
      goalIds: { type: "array", items: { type: "string" } },
      deadline: { type: "string", format: "date-time" },
      importance: { type: "number" }
    },
    required: ["title"]
  },
  schema: createProjectSchema,
  handler: async (args, ctx) => {
    const project: Project = {
      id: generateId("project"),
      title: args.title,
      description: args.description,
      goalIds: args.goalIds ?? [],
      deadline: isoDate(args.deadline),
      importance: args.importance ?? 0.5,
      status: "active",
      createdAt: ctx.now,
      updatedAt: ctx.now
    };
    await ctx.store.saveProject(project);
    return { project };
  }
};

const updateProjectSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  goalIds: z.array(z.string()).optional(),
  deadline: z.string().nullable().optional(),
  importance: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "paused", "completed", "cancelled"]).optional()
});
const updateProject: ToolDefinition<z.infer<typeof updateProjectSchema>> = {
  name: "update_project",
  description: "Updates fields on an existing project.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      goalIds: { type: "array", items: { type: "string" } },
      deadline: { type: "string", format: "date-time" },
      importance: { type: "number" },
      status: { type: "string", enum: ["active", "paused", "completed", "cancelled"] }
    },
    required: ["id"]
  },
  schema: updateProjectSchema,
  handler: async (args, ctx) => {
    const project = await ctx.store.getProject(args.id);
    if (!project) throw new Error(`No project with id "${args.id}".`);
    const updated: Project = {
      ...project,
      ...(args.title !== undefined && { title: args.title }),
      ...(args.description !== undefined && { description: args.description }),
      ...(args.goalIds !== undefined && { goalIds: args.goalIds }),
      ...(args.deadline !== undefined && { deadline: args.deadline ? new Date(args.deadline) : undefined }),
      ...(args.importance !== undefined && { importance: args.importance }),
      ...(args.status !== undefined && { status: args.status as ProjectStatus }),
      updatedAt: ctx.now
    };
    await ctx.store.saveProject(updated);
    return { project: updated };
  }
};

// ---------------------------------------------------------------------------
// create_calendar_event (fixed commitments — not in the spec's 21-tool list by name,
// but there is no other way for "I have class tomorrow 10-12" to become state, so it's
// added under the same tool-architecture pattern.)
// ---------------------------------------------------------------------------
const createCalendarEventSchema = z.object({
  title: z.string().min(1),
  startTime: z.string(),
  endTime: z.string(),
  type: eventTypeEnum,
  fixed: z.boolean().optional()
});
const createCalendarEvent: ToolDefinition<z.infer<typeof createCalendarEventSchema>> = {
  name: "create_calendar_event",
  description: "Creates a fixed commitment (class, meeting, travel, meal, sleep, appointment) on the calendar.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
      type: { type: "string", enum: ["class", "meeting", "travel", "meal", "sleep", "appointment", "other"] },
      fixed: { type: "boolean" }
    },
    required: ["title", "startTime", "endTime", "type"]
  },
  schema: createCalendarEventSchema,
  handler: async (args, ctx) => {
    const event: CalendarEvent = {
      id: generateId("event"),
      title: args.title,
      startTime: new Date(args.startTime),
      endTime: new Date(args.endTime),
      type: args.type as CalendarEventType,
      fixed: args.fixed ?? true
    };
    await ctx.store.saveCalendarEvent(event);
    return { event };
  }
};

// ---------------------------------------------------------------------------
// Helpers shared by the scheduling/capacity/feasibility tools
// ---------------------------------------------------------------------------
async function loadPlanningContext(ctx: ToolContext) {
  const [user, tasks, events, goals, projects, timeLogs] = await Promise.all([
    requireUser(ctx),
    ctx.store.listTasks(),
    ctx.store.listCalendarEvents(),
    ctx.store.listGoals(),
    ctx.store.listProjects(),
    ctx.store.listTimeLogs()
  ]);
  return { user, tasks, events, goals, projects, timeLogs };
}

function eventsForDay(events: CalendarEvent[], date: Date, timezone: string): CalendarEvent[] {
  const key = localDateKey(date, timezone);
  return events.filter((e) => localDateKey(e.startTime, timezone) === key || localDateKey(e.endTime, timezone) === key);
}

// ---------------------------------------------------------------------------
// get_today_schedule / plan_day
// ---------------------------------------------------------------------------
const dateArgSchema = z.object({ date: z.string().optional() });

async function runPlanDay(ctx: ToolContext, dateArg?: string) {
  const { user, tasks, events, goals, projects, timeLogs } = await loadPlanningContext(ctx);
  const date = isoDate(dateArg) ?? ctx.now;
  const dayEvents = eventsForDay(events, date, user.timezone);
  const result = planDay({ date, tasks, events: dayEvents, user, goals, projects, timeLogs });
  const dateKey = localDateKey(date, user.timezone);
  await ctx.store.savePlannedBlocks(dateKey, result.blocks);
  for (const d of result.decisions) await ctx.store.saveDecision(d);
  return { dateKey, ...result };
}

const getTodaySchedule: ToolDefinition<z.infer<typeof dateArgSchema>> = {
  name: "get_today_schedule",
  description: "Computes (and persists) today's schedule: which tasks are planned into which real free windows, and why.",
  parameters: { type: "object", properties: { date: { type: "string", format: "date-time" } } },
  schema: dateArgSchema,
  handler: async (args, ctx) => runPlanDay(ctx, args.date)
};

const planDayTool: ToolDefinition<z.infer<typeof dateArgSchema>> = {
  name: "plan_day",
  description: "Recomputes and persists the plan for a given day (defaults to today).",
  parameters: { type: "object", properties: { date: { type: "string", format: "date-time" } } },
  schema: dateArgSchema,
  handler: async (args, ctx) => runPlanDay(ctx, args.date)
};

// ---------------------------------------------------------------------------
// get_week_schedule / plan_week
// ---------------------------------------------------------------------------
async function runPlanWeek(ctx: ToolContext, weekStartArg?: string) {
  const { user, tasks, events, goals, projects, timeLogs } = await loadPlanningContext(ctx);
  const weekStart = isoDate(weekStartArg) ?? ctx.now;
  const eventsByDay: Record<string, CalendarEvent[]> = {};
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getTime() + i * 86400000);
    eventsByDay[localDateKey(d, user.timezone)] = eventsForDay(events, d, user.timezone);
  }
  const result = planWeek({ weekStart, tasks, eventsByDay, user, goals, projects, timeLogs });
  for (const [dateKey, dayResult] of Object.entries(result.days)) {
    await ctx.store.savePlannedBlocks(dateKey, dayResult.blocks);
  }
  for (const d of result.decisions) await ctx.store.saveDecision(d);
  const overloadWarnings = detectOvercommitment(result, tasks, user.timezone);
  const weeklyOvercommitment = detectWeeklyOvercommitment(result, tasks);
  return { ...result, overloadWarnings, weeklyOvercommitment };
}

const weekArgSchema = z.object({ weekStart: z.string().optional() });

const getWeekSchedule: ToolDefinition<z.infer<typeof weekArgSchema>> = {
  name: "get_week_schedule",
  description: "Computes (and persists) the week's schedule starting from the given date (defaults to today), plus overload warnings.",
  parameters: { type: "object", properties: { weekStart: { type: "string", format: "date-time" } } },
  schema: weekArgSchema,
  handler: async (args, ctx) => runPlanWeek(ctx, args.weekStart)
};

const planWeekTool: ToolDefinition<z.infer<typeof weekArgSchema>> = {
  name: "plan_week",
  description: "Recomputes and persists the plan for a full week starting from the given date (defaults to today).",
  parameters: { type: "object", properties: { weekStart: { type: "string", format: "date-time" } } },
  schema: weekArgSchema,
  handler: async (args, ctx) => runPlanWeek(ctx, args.weekStart)
};

// ---------------------------------------------------------------------------
// calculate_free_time / calculate_capacity
// ---------------------------------------------------------------------------
async function runCalculateCapacity(ctx: ToolContext, dateArg?: string) {
  const { user, events } = await loadPlanningContext(ctx);
  const date = isoDate(dateArg) ?? ctx.now;
  const dayEvents = eventsForDay(events, date, user.timezone);
  return calculateCapacity({ date, user, events: dayEvents });
}

const calculateFreeTime: ToolDefinition<z.infer<typeof dateArgSchema>> = {
  name: "calculate_free_time",
  description: "Returns real usable free time for a day (not naive '24h minus events') plus the literal free windows.",
  parameters: { type: "object", properties: { date: { type: "string", format: "date-time" } } },
  schema: dateArgSchema,
  handler: async (args, ctx) => runCalculateCapacity(ctx, args.date)
};

const calculateCapacityTool: ToolDefinition<z.infer<typeof dateArgSchema>> = {
  name: "calculate_capacity",
  description: "Returns the full capacity breakdown for a day (waking/fixed/travel/meal/break/buffer/usable/deep-work/low-energy minutes).",
  parameters: { type: "object", properties: { date: { type: "string", format: "date-time" } } },
  schema: dateArgSchema,
  handler: async (args, ctx) => runCalculateCapacity(ctx, args.date)
};

// ---------------------------------------------------------------------------
// check_feasibility
// ---------------------------------------------------------------------------
const checkFeasibilitySchema = z.object({ taskId: z.string(), date: z.string().optional() });
const checkFeasibility: ToolDefinition<z.infer<typeof checkFeasibilitySchema>> = {
  name: "check_feasibility",
  description: "Calculates (never guesses) whether a task can realistically be completed on a given day, and what to do if not.",
  parameters: {
    type: "object",
    properties: { taskId: { type: "string" }, date: { type: "string", format: "date-time" } },
    required: ["taskId"]
  },
  schema: checkFeasibilitySchema,
  handler: async (args, ctx): Promise<FeasibilityResult> => {
    const { user, tasks, events, goals, projects, timeLogs } = await loadPlanningContext(ctx);
    const task = await requireTask(ctx, args.taskId);
    const date = isoDate(args.date) ?? ctx.now;
    const dayEvents = eventsForDay(events, date, user.timezone);
    const othersPlan = planDay({
      date,
      tasks: tasks.filter((t) => t.id !== task.id),
      events: dayEvents,
      user,
      goals,
      projects,
      timeLogs
    });
    return checkTaskFeasibility({
      task,
      date,
      currentSchedule: othersPlan.blocks,
      capacity: othersPlan.capacity,
      allTasks: tasks,
      goals,
      projects,
      timeLogs,
      now: ctx.now
    });
  }
};

// ---------------------------------------------------------------------------
// reschedule_task
// ---------------------------------------------------------------------------
const rescheduleTaskSchema = z.object({ taskId: z.string(), deferUntil: z.string() });
const rescheduleTask: ToolDefinition<z.infer<typeof rescheduleTaskSchema>> = {
  name: "reschedule_task",
  description: "Defers a task so it's excluded from any day's plan before the given date (e.g. 'move this to tomorrow').",
  parameters: {
    type: "object",
    properties: { taskId: { type: "string" }, deferUntil: { type: "string", format: "date-time" } },
    required: ["taskId", "deferUntil"]
  },
  schema: rescheduleTaskSchema,
  handler: async (args, ctx) => {
    const task = await requireTask(ctx, args.taskId);
    const updated: Task = { ...task, deferredUntil: new Date(args.deferUntil), updatedAt: ctx.now };
    await ctx.store.saveTask(updated);
    await ctx.store.saveDecision({
      id: generateId("decision"),
      decision: `Moved "${task.title}" to ${args.deferUntil.slice(0, 10)}.`,
      reason: "Requested by the user.",
      affectedTasks: [task.id],
      timestamp: ctx.now
    });
    return { task: updated };
  }
};

// ---------------------------------------------------------------------------
// get_current_priority
// ---------------------------------------------------------------------------
const getCurrentPrioritySchema = z.object({ taskId: z.string() });
const getCurrentPriority: ToolDefinition<z.infer<typeof getCurrentPrioritySchema>> = {
  name: "get_current_priority",
  description: "Returns a task's dynamically computed priority score and the reasoning factors behind it.",
  parameters: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  schema: getCurrentPrioritySchema,
  handler: async (args, ctx) => {
    const { tasks, goals, projects } = await loadPlanningContext(ctx);
    const task = await requireTask(ctx, args.taskId);
    const project = projects.find((p) => p.id === task.projectId);
    const dependents = getAllDependents(task.id, tasks);
    const priorityScore = scoreTask(task, { now: ctx.now, goals, project, dependents });
    const reasoning = buildReasoningFactors({ task, priorityScore, dependents, now: ctx.now });
    return { priorityScore, reasoning };
  }
};

// ---------------------------------------------------------------------------
// get_next_action
// ---------------------------------------------------------------------------
const getNextActionSchema = z.object({ energyState: energyEnum.optional() });
const getNextActionTool: ToolDefinition<z.infer<typeof getNextActionSchema>> = {
  name: "get_next_action",
  description: "Returns exactly what to do right now and next, with reasons, based on the current plan, deadlines, and (optionally) stated energy level.",
  parameters: { type: "object", properties: { energyState: { type: "string", enum: ["low", "medium", "high"] } } },
  schema: getNextActionSchema,
  handler: async (args, ctx) => {
    const planResult = await runPlanDay(ctx);
    const { tasks, goals, projects } = await loadPlanningContext(ctx);
    const result = getNextAction({
      now: ctx.now,
      todaysBlocks: planResult.blocks,
      tasks,
      goals,
      projects,
      energyState: args.energyState as EnergyLevel | undefined
    });
    if (result.energySwapDecision) await ctx.store.saveDecision(result.energySwapDecision);
    return result;
  }
};

// ---------------------------------------------------------------------------
// record_actual_duration
// ---------------------------------------------------------------------------
const recordActualDurationSchema = z.object({
  taskId: z.string(),
  actualMinutes: z.number().positive(),
  estimatedMinutesAtTime: z.number().positive().optional()
});
const recordActualDuration: ToolDefinition<z.infer<typeof recordActualDurationSchema>> = {
  name: "record_actual_duration",
  description: "Records how long a task actually took (e.g. 'I spent two hours on DSA'). Feeds the estimation-learning system.",
  parameters: {
    type: "object",
    properties: {
      taskId: { type: "string" },
      actualMinutes: { type: "number" },
      estimatedMinutesAtTime: { type: "number" }
    },
    required: ["taskId", "actualMinutes"]
  },
  schema: recordActualDurationSchema,
  handler: async (args, ctx) => {
    const task = await requireTask(ctx, args.taskId);
    const log: TimeLog = {
      id: generateId("timelog"),
      taskId: task.id,
      actualMinutes: args.actualMinutes,
      estimatedMinutesAtTime: args.estimatedMinutesAtTime ?? task.estimatedMinutes,
      createdAt: ctx.now
    };
    await ctx.store.saveTimeLog(log);
    return { log };
  }
};

// ---------------------------------------------------------------------------
// search_memory / save_memory
// ---------------------------------------------------------------------------
const memoryKindEnum = z.enum(["preference", "goal_context", "project_context", "decision_context", "fact"]);

const searchMemorySchema = z.object({ query: z.string(), kind: memoryKindEnum.optional() });
const searchMemory: ToolDefinition<z.infer<typeof searchMemorySchema>> = {
  name: "search_memory",
  description: "Keyword-searches structured memory (preferences, goal/project context, past decisions, facts).",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      kind: { type: "string", enum: ["preference", "goal_context", "project_context", "decision_context", "fact"] }
    },
    required: ["query"]
  },
  schema: searchMemorySchema,
  handler: async (args, ctx) => {
    const all = await ctx.store.listMemory();
    const now = ctx.now.getTime();
    const notExpired = all.filter((m) => !m.expiresAt || m.expiresAt.getTime() > now);
    const q = args.query.toLowerCase();
    const matches = notExpired.filter((m) => {
      if (args.kind && m.kind !== args.kind) return false;
      const haystack = `${m.key} ${JSON.stringify(m.value)}`.toLowerCase();
      return haystack.includes(q);
    });
    return { matches };
  }
};

const saveMemorySchema = z.object({
  kind: memoryKindEnum,
  key: z.string(),
  value: z.unknown(),
  expiresAt: z.string().optional()
});
const saveMemory: ToolDefinition<z.infer<typeof saveMemorySchema>> = {
  name: "save_memory",
  description: "Saves or updates one structured memory entry. Use sparingly — durable facts/preferences/decisions only, not every message.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["preference", "goal_context", "project_context", "decision_context", "fact"] },
      key: { type: "string" },
      value: {},
      expiresAt: { type: "string", format: "date-time" }
    },
    required: ["kind", "key", "value"]
  },
  schema: saveMemorySchema,
  handler: async (args, ctx) => {
    const existing = (await ctx.store.listMemory()).find((m) => m.kind === args.kind && m.key === args.key);
    const entry: MemoryEntry = {
      id: existing?.id ?? generateId("memory"),
      kind: args.kind as MemoryKind,
      key: args.key,
      value: args.value,
      expiresAt: isoDate(args.expiresAt),
      createdAt: existing?.createdAt ?? ctx.now,
      updatedAt: ctx.now
    };
    await ctx.store.saveMemory(entry);
    return { memory: entry };
  }
};

// ---------------------------------------------------------------------------
// create_reminder / list_reminders / cancel_reminder
// ---------------------------------------------------------------------------
// A standalone alarm/reminder — "remind me to drink water at 5pm", "set an
// alarm for 7am" — deliberately independent of the task engine: it's not a
// task with capacity/priority, just a point in time to notify at. This tool
// only persists the reminder; the mobile app turns each un-fired one into a
// real local notification (see notifications/scheduler.ts) whenever the store
// changes, the same way plan-derived notifications already get scheduled.
const createReminderSchema = z.object({
  title: z.string().min(1),
  triggerAt: z.string()
});
const createReminder: ToolDefinition<z.infer<typeof createReminderSchema>> = {
  name: "create_reminder",
  description:
    "Sets a standalone alarm/reminder for a specific point in time (not a task — no capacity or priority involved). Use for things like \"remind me to X at 5pm\" or \"set an alarm for 7am tomorrow\". triggerAt must be an absolute ISO 8601 date-time — resolve relative phrases like \"in 10 minutes\" or \"tomorrow at 7am\" against the current time given in context yourself before calling this.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      triggerAt: { type: "string", format: "date-time" }
    },
    required: ["title", "triggerAt"]
  },
  schema: createReminderSchema,
  handler: async (args, ctx) => {
    const triggerAt = new Date(args.triggerAt);
    if (Number.isNaN(triggerAt.getTime())) throw new Error(`"${args.triggerAt}" isn't a valid date-time.`);
    const reminder: Reminder = {
      id: generateId("reminder"),
      title: args.title,
      triggerAt,
      fired: false,
      createdAt: ctx.now
    };
    await ctx.store.saveReminder(reminder);
    return { reminder };
  }
};

const listRemindersSchema = z.object({});
const listReminders: ToolDefinition<z.infer<typeof listRemindersSchema>> = {
  name: "list_reminders",
  description: "Lists all reminders/alarms that haven't fired yet.",
  parameters: { type: "object", properties: {} },
  schema: listRemindersSchema,
  handler: async (_args, ctx) => {
    const all = await ctx.store.listReminders();
    return { reminders: all.filter((r) => !r.fired) };
  }
};

const cancelReminderSchema = z.object({ id: z.string() });
const cancelReminder: ToolDefinition<z.infer<typeof cancelReminderSchema>> = {
  name: "cancel_reminder",
  description: "Cancels/deletes a reminder or alarm by id.",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"]
  },
  schema: cancelReminderSchema,
  handler: async (args, ctx) => {
    await ctx.store.deleteReminder(args.id);
    return { deleted: args.id };
  }
};

// ---------------------------------------------------------------------------

export const ALL_TOOLS: ToolDefinition<any>[] = [
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  createGoal,
  updateGoal,
  createProject,
  updateProject,
  createCalendarEvent,
  getTodaySchedule,
  getWeekSchedule,
  calculateFreeTime,
  calculateCapacityTool,
  checkFeasibility,
  planDayTool,
  planWeekTool,
  rescheduleTask,
  getCurrentPriority,
  getNextActionTool,
  recordActualDuration,
  searchMemory,
  saveMemory,
  createReminder,
  listReminders,
  cancelReminder
];

export function toolDeclarations(): ToolDeclaration[] {
  return ALL_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

export async function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<unknown> {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool "${name}".`);
  const args = tool.schema.parse(rawArgs);
  return tool.handler(args, ctx);
}
