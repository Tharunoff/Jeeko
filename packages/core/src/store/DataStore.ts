import type {
  CalendarEvent,
  DailyReview,
  DecisionLog,
  Goal,
  MemoryEntry,
  PlannedBlock,
  Project,
  Task,
  TimeLog,
  UserProfile
} from "../types/index";

/**
 * Repository interface. Every engine and tool handler depends on this, never on a
 * concrete database — mobile implements it via expo-sqlite, tests use InMemoryStore.
 * A shared contract test suite (dataStoreContractTests.ts) is run against both so
 * they can't silently diverge in behavior.
 */
export interface DataStore {
  getUser(): Promise<UserProfile | undefined>;
  saveUser(user: UserProfile): Promise<void>;

  listGoals(): Promise<Goal[]>;
  getGoal(id: string): Promise<Goal | undefined>;
  saveGoal(goal: Goal): Promise<void>;
  deleteGoal(id: string): Promise<void>;

  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | undefined>;
  saveProject(project: Project): Promise<void>;
  deleteProject(id: string): Promise<void>;

  listTasks(): Promise<Task[]>;
  getTask(id: string): Promise<Task | undefined>;
  saveTask(task: Task): Promise<void>;
  deleteTask(id: string): Promise<void>;

  listCalendarEvents(): Promise<CalendarEvent[]>;
  getCalendarEvent(id: string): Promise<CalendarEvent | undefined>;
  saveCalendarEvent(event: CalendarEvent): Promise<void>;
  deleteCalendarEvent(id: string): Promise<void>;

  listPlannedBlocks(): Promise<PlannedBlock[]>;
  savePlannedBlocks(dateKey: string, blocks: PlannedBlock[]): Promise<void>;
  clearPlannedBlocksForDate(dateKey: string): Promise<void>;

  listTimeLogs(): Promise<TimeLog[]>;
  saveTimeLog(log: TimeLog): Promise<void>;

  listMemory(): Promise<MemoryEntry[]>;
  saveMemory(entry: MemoryEntry): Promise<void>;
  deleteMemory(id: string): Promise<void>;

  listDecisions(): Promise<DecisionLog[]>;
  saveDecision(decision: DecisionLog): Promise<void>;

  listDailyReviews(): Promise<DailyReview[]>;
  saveDailyReview(review: DailyReview): Promise<void>;

  getPreference(key: string): Promise<string | undefined>;
  setPreference(key: string, value: string): Promise<void>;
}
