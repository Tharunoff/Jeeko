import type { SQLiteDatabase } from "expo-sqlite";

/** Fresh-install schema. No migration framework yet — V1 is a single schema version,
 * applied with CREATE TABLE IF NOT EXISTS so re-running on an existing DB is a no-op. */
export async function applySchema(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      preferred_wake_time TEXT,
      preferred_sleep_time TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      preferred_work_duration INTEGER,
      preferred_break_duration INTEGER,
      max_deep_work_session INTEGER
    );

    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      priority_weight REAL NOT NULL DEFAULT 0.5,
      deadline TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      progress REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      deadline TEXT,
      importance REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_goals (
      project_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      PRIMARY KEY (project_id, goal_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      project_id TEXT,
      estimated_minutes INTEGER NOT NULL,
      deadline TEXT,
      deadline_type TEXT NOT NULL DEFAULT 'none',
      priority_override REAL,
      importance REAL NOT NULL DEFAULT 0.5,
      urgency REAL NOT NULL DEFAULT 0.5,
      energy_requirement TEXT NOT NULL DEFAULT 'medium',
      difficulty TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'inbox',
      deferred_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);

    CREATE TABLE IF NOT EXISTS task_goals (
      task_id TEXT NOT NULL,
      goal_id TEXT NOT NULL,
      PRIMARY KEY (task_id, goal_id)
    );

    CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      PRIMARY KEY (task_id, depends_on_task_id)
    );
    CREATE INDEX IF NOT EXISTS idx_taskdeps_depends_on ON task_dependencies(depends_on_task_id);

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      type TEXT NOT NULL,
      fixed INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_events_start ON calendar_events(start_time);

    CREATE TABLE IF NOT EXISTS planned_blocks (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      task_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      reason TEXT NOT NULL,
      notification_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_date ON planned_blocks(date_key);

    CREATE TABLE IF NOT EXISTS time_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      actual_minutes INTEGER NOT NULL,
      estimated_minutes_at_time INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_timelogs_task ON time_logs(task_id);

    CREATE TABLE IF NOT EXISTS memory (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      affected_task_ids TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON decisions(timestamp);

    CREATE TABLE IF NOT EXISTS daily_reviews (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      completed_count INTEGER NOT NULL,
      incomplete_count INTEGER NOT NULL,
      estimated_total_minutes INTEGER NOT NULL,
      actual_total_minutes INTEGER NOT NULL,
      main_issue TEXT,
      tomorrow_adjustment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      text TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      tool_args TEXT,
      tool_result TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);
  `);
}
