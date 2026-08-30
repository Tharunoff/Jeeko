import * as SQLite from "expo-sqlite";
import type {
  CalendarEvent,
  CalendarEventType,
  DailyReview,
  DataStore,
  DeadlineType,
  DecisionLog,
  Difficulty,
  EnergyLevel,
  Goal,
  GoalStatus,
  MemoryEntry,
  MemoryKind,
  PlannedBlock,
  Project,
  ProjectStatus,
  Reminder,
  Task,
  TaskStatus,
  TimeLog,
  UserProfile
} from "@personalos/core";
import { applySchema } from "./schema";

function toIso(d?: Date): string | null {
  return d ? d.toISOString() : null;
}
function fromIso(s: string | null | undefined): Date | undefined {
  return s ? new Date(s) : undefined;
}

/**
 * expo-sqlite implementation of @personalos/core's DataStore. Deliberately "dumb": pure
 * SQL <-> domain-object mapping, zero business logic — all the decision-making risk
 * stays in @personalos/core, which is fully vitest-covered. This adapter is verified by
 * manual smoke-testing inside the running app instead of an automated harness, since
 * expo-sqlite's async API is RN-only and won't run under plain vitest/Node.
 */
export const DB_NAME = "personalos.db";

export class SqliteDataStore implements DataStore {
  private db: SQLite.SQLiteDatabase;

  private constructor(db: SQLite.SQLiteDatabase) {
    this.db = db;
  }

  static async open(name = DB_NAME): Promise<SqliteDataStore> {
    const db = await SQLite.openDatabaseAsync(name);
    await applySchema(db);
    return new SqliteDataStore(db);
  }

  /** Permanently deletes the local database file. Used by Settings' "Reset local data" —
   * the app must be reloaded/restarted afterward so AppState reopens a fresh one. */
  static async reset(name = DB_NAME): Promise<void> {
    await SQLite.deleteDatabaseAsync(name);
  }

  // ---------------------------------------------------------------- users
  async getUser(): Promise<UserProfile | undefined> {
    const row = await this.db.getFirstAsync<any>(`SELECT * FROM users LIMIT 1`);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      preferredWakeTime: row.preferred_wake_time ?? undefined,
      preferredSleepTime: row.preferred_sleep_time ?? undefined,
      timezone: row.timezone,
      productivityPreferences: {
        preferredWorkDuration: row.preferred_work_duration ?? undefined,
        preferredBreakDuration: row.preferred_break_duration ?? undefined,
        maxDeepWorkSession: row.max_deep_work_session ?? undefined
      }
    };
  }

  async saveUser(user: UserProfile): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO users (id, name, preferred_wake_time, preferred_sleep_time, timezone, preferred_work_duration, preferred_break_duration, max_deep_work_session)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, preferred_wake_time=excluded.preferred_wake_time,
         preferred_sleep_time=excluded.preferred_sleep_time, timezone=excluded.timezone,
         preferred_work_duration=excluded.preferred_work_duration, preferred_break_duration=excluded.preferred_break_duration,
         max_deep_work_session=excluded.max_deep_work_session`,
      [
        user.id,
        user.name,
        user.preferredWakeTime ?? null,
        user.preferredSleepTime ?? null,
        user.timezone,
        user.productivityPreferences.preferredWorkDuration ?? null,
        user.productivityPreferences.preferredBreakDuration ?? null,
        user.productivityPreferences.maxDeepWorkSession ?? null
      ]
    );
  }

  // ---------------------------------------------------------------- goals
  async listGoals(): Promise<Goal[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM goals`);
    return rows.map(rowToGoal);
  }
  async getGoal(id: string): Promise<Goal | undefined> {
    const row = await this.db.getFirstAsync<any>(`SELECT * FROM goals WHERE id = ?`, [id]);
    return row ? rowToGoal(row) : undefined;
  }
  async saveGoal(goal: Goal): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO goals (id, title, description, priority_weight, deadline, status, progress, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
         priority_weight=excluded.priority_weight, deadline=excluded.deadline, status=excluded.status,
         progress=excluded.progress, updated_at=excluded.updated_at`,
      [
        goal.id,
        goal.title,
        goal.description ?? null,
        goal.priorityWeight,
        toIso(goal.deadline),
        goal.status,
        goal.progress,
        toIso(goal.createdAt),
        toIso(goal.updatedAt)
      ]
    );
  }
  async deleteGoal(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM goals WHERE id = ?`, [id]);
  }

  // ---------------------------------------------------------------- projects
  async listProjects(): Promise<Project[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM projects`);
    return Promise.all(rows.map((r) => this.hydrateProject(r)));
  }
  async getProject(id: string): Promise<Project | undefined> {
    const row = await this.db.getFirstAsync<any>(`SELECT * FROM projects WHERE id = ?`, [id]);
    return row ? this.hydrateProject(row) : undefined;
  }
  async saveProject(project: Project): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO projects (id, title, description, deadline, importance, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
         deadline=excluded.deadline, importance=excluded.importance, status=excluded.status, updated_at=excluded.updated_at`,
      [
        project.id,
        project.title,
        project.description ?? null,
        toIso(project.deadline),
        project.importance,
        project.status,
        toIso(project.createdAt),
        toIso(project.updatedAt)
      ]
    );
    await this.db.runAsync(`DELETE FROM project_goals WHERE project_id = ?`, [project.id]);
    for (const goalId of project.goalIds) {
      await this.db.runAsync(`INSERT OR IGNORE INTO project_goals (project_id, goal_id) VALUES (?, ?)`, [
        project.id,
        goalId
      ]);
    }
  }
  async deleteProject(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM projects WHERE id = ?`, [id]);
    await this.db.runAsync(`DELETE FROM project_goals WHERE project_id = ?`, [id]);
  }
  private async hydrateProject(row: any): Promise<Project> {
    const goalRows = await this.db.getAllAsync<any>(`SELECT goal_id FROM project_goals WHERE project_id = ?`, [row.id]);
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      goalIds: goalRows.map((g) => g.goal_id),
      deadline: fromIso(row.deadline),
      importance: row.importance,
      status: row.status as ProjectStatus,
      createdAt: fromIso(row.created_at)!,
      updatedAt: fromIso(row.updated_at)!
    };
  }

  // ---------------------------------------------------------------- tasks
  async listTasks(): Promise<Task[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM tasks`);
    return Promise.all(rows.map((r) => this.hydrateTask(r)));
  }
  async getTask(id: string): Promise<Task | undefined> {
    const row = await this.db.getFirstAsync<any>(`SELECT * FROM tasks WHERE id = ?`, [id]);
    return row ? this.hydrateTask(row) : undefined;
  }
  async saveTask(task: Task): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO tasks (id, title, description, project_id, estimated_minutes, deadline, deadline_type,
        priority_override, importance, urgency, energy_requirement, difficulty, status, deferred_until,
        created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description,
         project_id=excluded.project_id, estimated_minutes=excluded.estimated_minutes, deadline=excluded.deadline,
         deadline_type=excluded.deadline_type, priority_override=excluded.priority_override, importance=excluded.importance,
         urgency=excluded.urgency, energy_requirement=excluded.energy_requirement, difficulty=excluded.difficulty,
         status=excluded.status, deferred_until=excluded.deferred_until, updated_at=excluded.updated_at,
         completed_at=excluded.completed_at`,
      [
        task.id,
        task.title,
        task.description ?? null,
        task.projectId ?? null,
        task.estimatedMinutes,
        toIso(task.deadline),
        task.deadlineType,
        task.priorityOverride ?? null,
        task.importance,
        task.urgency,
        task.energyRequirement,
        task.difficulty,
        task.status,
        toIso(task.deferredUntil),
        toIso(task.createdAt),
        toIso(task.updatedAt),
        toIso(task.completedAt)
      ]
    );
    await this.db.runAsync(`DELETE FROM task_goals WHERE task_id = ?`, [task.id]);
    for (const goalId of task.goalIds) {
      await this.db.runAsync(`INSERT OR IGNORE INTO task_goals (task_id, goal_id) VALUES (?, ?)`, [task.id, goalId]);
    }
    await this.db.runAsync(`DELETE FROM task_dependencies WHERE task_id = ?`, [task.id]);
    for (const depId of task.dependencies) {
      await this.db.runAsync(`INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)`, [
        task.id,
        depId
      ]);
    }
  }
  async deleteTask(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM tasks WHERE id = ?`, [id]);
    await this.db.runAsync(`DELETE FROM task_goals WHERE task_id = ?`, [id]);
    await this.db.runAsync(`DELETE FROM task_dependencies WHERE task_id = ?`, [id]);
  }
  private async hydrateTask(row: any): Promise<Task> {
    const [goalRows, depRows] = await Promise.all([
      this.db.getAllAsync<any>(`SELECT goal_id FROM task_goals WHERE task_id = ?`, [row.id]),
      this.db.getAllAsync<any>(`SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?`, [row.id])
    ]);
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      projectId: row.project_id ?? undefined,
      goalIds: goalRows.map((g) => g.goal_id),
      estimatedMinutes: row.estimated_minutes,
      deadline: fromIso(row.deadline),
      deadlineType: row.deadline_type as DeadlineType,
      priorityOverride: row.priority_override ?? undefined,
      importance: row.importance,
      urgency: row.urgency,
      energyRequirement: row.energy_requirement as EnergyLevel,
      difficulty: row.difficulty as Difficulty,
      status: row.status as TaskStatus,
      dependencies: depRows.map((d) => d.depends_on_task_id),
      deferredUntil: fromIso(row.deferred_until),
      createdAt: fromIso(row.created_at)!,
      updatedAt: fromIso(row.updated_at)!,
      completedAt: fromIso(row.completed_at)
    };
  }

  // ---------------------------------------------------------------- calendar events
  async listCalendarEvents(): Promise<CalendarEvent[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM calendar_events`);
    return rows.map(rowToEvent);
  }
  async getCalendarEvent(id: string): Promise<CalendarEvent | undefined> {
    const row = await this.db.getFirstAsync<any>(`SELECT * FROM calendar_events WHERE id = ?`, [id]);
    return row ? rowToEvent(row) : undefined;
  }
  async saveCalendarEvent(event: CalendarEvent): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO calendar_events (id, title, start_time, end_time, type, fixed)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, start_time=excluded.start_time,
         end_time=excluded.end_time, type=excluded.type, fixed=excluded.fixed`,
      [event.id, event.title, toIso(event.startTime), toIso(event.endTime), event.type, event.fixed ? 1 : 0]
    );
  }
  async deleteCalendarEvent(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM calendar_events WHERE id = ?`, [id]);
  }

  // ---------------------------------------------------------------- planned blocks
  async listPlannedBlocks(): Promise<PlannedBlock[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM planned_blocks`);
    return rows.map(rowToBlock);
  }
  async savePlannedBlocks(dateKey: string, blocks: PlannedBlock[]): Promise<void> {
    await this.clearPlannedBlocksForDate(dateKey);
    for (const b of blocks) {
      await this.db.runAsync(
        `INSERT INTO planned_blocks (id, date_key, task_id, start_time, end_time, duration_minutes, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [b.id, dateKey, b.taskId, toIso(b.startTime), toIso(b.endTime), b.durationMinutes, b.reason]
      );
    }
  }
  async clearPlannedBlocksForDate(dateKey: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM planned_blocks WHERE date_key = ?`, [dateKey]);
  }

  // ---------------------------------------------------------------- time logs
  async listTimeLogs(): Promise<TimeLog[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM time_logs`);
    return rows.map(rowToTimeLog);
  }
  async saveTimeLog(log: TimeLog): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO time_logs (id, task_id, started_at, ended_at, actual_minutes, estimated_minutes_at_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [log.id, log.taskId, toIso(log.startedAt), toIso(log.endedAt), log.actualMinutes, log.estimatedMinutesAtTime, toIso(log.createdAt)]
    );
  }

  // ---------------------------------------------------------------- memory
  async listMemory(): Promise<MemoryEntry[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM memory`);
    return rows.map(rowToMemory);
  }
  async saveMemory(entry: MemoryEntry): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO memory (id, kind, key, value, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, key=excluded.key, value=excluded.value,
         expires_at=excluded.expires_at, updated_at=excluded.updated_at`,
      [entry.id, entry.kind, entry.key, JSON.stringify(entry.value), toIso(entry.expiresAt), toIso(entry.createdAt), toIso(entry.updatedAt)]
    );
  }
  async deleteMemory(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM memory WHERE id = ?`, [id]);
  }

  // ---------------------------------------------------------------- decisions
  async listDecisions(): Promise<DecisionLog[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM decisions ORDER BY timestamp DESC`);
    return rows.map(rowToDecision);
  }
  async saveDecision(decision: DecisionLog): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO decisions (id, decision, reason, affected_task_ids, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [decision.id, decision.decision, decision.reason, JSON.stringify(decision.affectedTasks), toIso(decision.timestamp)]
    );
  }

  // ---------------------------------------------------------------- daily reviews
  async listDailyReviews(): Promise<DailyReview[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM daily_reviews ORDER BY date DESC`);
    return rows.map(rowToDailyReview);
  }
  async saveDailyReview(review: DailyReview): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO daily_reviews (id, date, completed_count, incomplete_count, estimated_total_minutes, actual_total_minutes, main_issue, tomorrow_adjustment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET completed_count=excluded.completed_count, incomplete_count=excluded.incomplete_count,
         estimated_total_minutes=excluded.estimated_total_minutes, actual_total_minutes=excluded.actual_total_minutes,
         main_issue=excluded.main_issue, tomorrow_adjustment=excluded.tomorrow_adjustment`,
      [
        review.id,
        review.date,
        review.completedCount,
        review.incompleteCount,
        review.estimatedTotalMinutes,
        review.actualTotalMinutes,
        review.mainIssue ?? null,
        review.tomorrowAdjustment ?? null,
        toIso(review.createdAt)
      ]
    );
  }

  // ---------------------------------------------------------------- preferences
  async getPreference(key: string): Promise<string | undefined> {
    const row = await this.db.getFirstAsync<any>(`SELECT value FROM preferences WHERE key = ?`, [key]);
    return row?.value ?? undefined;
  }
  async setPreference(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      [key, value, new Date().toISOString()]
    );
  }

  // ---------------------------------------------------------------- reminders
  async listReminders(): Promise<Reminder[]> {
    const rows = await this.db.getAllAsync<any>(`SELECT * FROM reminders ORDER BY trigger_at ASC`);
    return rows.map(rowToReminder);
  }
  async saveReminder(reminder: Reminder): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO reminders (id, title, trigger_at, fired, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, trigger_at=excluded.trigger_at, fired=excluded.fired`,
      [reminder.id, reminder.title, toIso(reminder.triggerAt), reminder.fired ? 1 : 0, toIso(reminder.createdAt)]
    );
  }
  async deleteReminder(id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM reminders WHERE id = ?`, [id]);
  }
}

function rowToGoal(row: any): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    priorityWeight: row.priority_weight,
    deadline: fromIso(row.deadline),
    status: row.status as GoalStatus,
    progress: row.progress,
    createdAt: fromIso(row.created_at)!,
    updatedAt: fromIso(row.updated_at)!
  };
}

function rowToEvent(row: any): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    startTime: fromIso(row.start_time)!,
    endTime: fromIso(row.end_time)!,
    type: row.type as CalendarEventType,
    fixed: !!row.fixed
  };
}

function rowToBlock(row: any): PlannedBlock {
  return {
    id: row.id,
    taskId: row.task_id,
    startTime: fromIso(row.start_time)!,
    endTime: fromIso(row.end_time)!,
    durationMinutes: row.duration_minutes,
    reason: row.reason
  };
}

function rowToTimeLog(row: any): TimeLog {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: fromIso(row.started_at),
    endedAt: fromIso(row.ended_at),
    actualMinutes: row.actual_minutes,
    estimatedMinutesAtTime: row.estimated_minutes_at_time,
    createdAt: fromIso(row.created_at)!
  };
}

function rowToMemory(row: any): MemoryEntry {
  return {
    id: row.id,
    kind: row.kind as MemoryKind,
    key: row.key,
    value: JSON.parse(row.value),
    expiresAt: fromIso(row.expires_at),
    createdAt: fromIso(row.created_at)!,
    updatedAt: fromIso(row.updated_at)!
  };
}

function rowToReminder(row: any): Reminder {
  return {
    id: row.id,
    title: row.title,
    triggerAt: fromIso(row.trigger_at)!,
    fired: !!row.fired,
    createdAt: fromIso(row.created_at)!
  };
}

function rowToDecision(row: any): DecisionLog {
  return {
    id: row.id,
    decision: row.decision,
    reason: row.reason,
    affectedTasks: JSON.parse(row.affected_task_ids),
    timestamp: fromIso(row.timestamp)!
  };
}

function rowToDailyReview(row: any): DailyReview {
  return {
    id: row.id,
    date: row.date,
    completedCount: row.completed_count,
    incompleteCount: row.incomplete_count,
    estimatedTotalMinutes: row.estimated_total_minutes,
    actualTotalMinutes: row.actual_total_minutes,
    mainIssue: row.main_issue ?? undefined,
    tomorrowAdjustment: row.tomorrow_adjustment ?? undefined,
    createdAt: fromIso(row.created_at)!
  };
}
