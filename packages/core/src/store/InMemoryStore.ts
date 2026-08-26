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
import type { DataStore } from "./DataStore";

/** Plain-object implementation of DataStore for vitest and any other non-RN context.
 * No persistence beyond process memory — that's the point. */
export class InMemoryStore implements DataStore {
  private user: UserProfile | undefined;
  private goals = new Map<string, Goal>();
  private projects = new Map<string, Project>();
  private tasks = new Map<string, Task>();
  private events = new Map<string, CalendarEvent>();
  private blocks: PlannedBlock[] = [];
  private blockDateKeys = new Map<string, string>(); // blockId -> dateKey, for clearing by date
  private timeLogs: TimeLog[] = [];
  private memory = new Map<string, MemoryEntry>();
  private decisions: DecisionLog[] = [];
  private dailyReviews: DailyReview[] = [];
  private preferences = new Map<string, string>();
  private timezone = "UTC";

  async getUser(): Promise<UserProfile | undefined> {
    return this.user;
  }
  async saveUser(user: UserProfile): Promise<void> {
    this.user = user;
    this.timezone = user.timezone || "UTC";
  }

  async listGoals(): Promise<Goal[]> {
    return [...this.goals.values()];
  }
  async getGoal(id: string): Promise<Goal | undefined> {
    return this.goals.get(id);
  }
  async saveGoal(goal: Goal): Promise<void> {
    this.goals.set(goal.id, goal);
  }
  async deleteGoal(id: string): Promise<void> {
    this.goals.delete(id);
  }

  async listProjects(): Promise<Project[]> {
    return [...this.projects.values()];
  }
  async getProject(id: string): Promise<Project | undefined> {
    return this.projects.get(id);
  }
  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, project);
  }
  async deleteProject(id: string): Promise<void> {
    this.projects.delete(id);
  }

  async listTasks(): Promise<Task[]> {
    return [...this.tasks.values()];
  }
  async getTask(id: string): Promise<Task | undefined> {
    return this.tasks.get(id);
  }
  async saveTask(task: Task): Promise<void> {
    this.tasks.set(task.id, task);
  }
  async deleteTask(id: string): Promise<void> {
    this.tasks.delete(id);
  }

  async listCalendarEvents(): Promise<CalendarEvent[]> {
    return [...this.events.values()];
  }
  async getCalendarEvent(id: string): Promise<CalendarEvent | undefined> {
    return this.events.get(id);
  }
  async saveCalendarEvent(event: CalendarEvent): Promise<void> {
    this.events.set(event.id, event);
  }
  async deleteCalendarEvent(id: string): Promise<void> {
    this.events.delete(id);
  }

  async listPlannedBlocks(): Promise<PlannedBlock[]> {
    return [...this.blocks];
  }
  async savePlannedBlocks(dateKey: string, blocks: PlannedBlock[]): Promise<void> {
    await this.clearPlannedBlocksForDate(dateKey);
    for (const b of blocks) {
      this.blocks.push(b);
      this.blockDateKeys.set(b.id, dateKey);
    }
  }
  async clearPlannedBlocksForDate(dateKey: string): Promise<void> {
    this.blocks = this.blocks.filter((b) => this.blockDateKeys.get(b.id) !== dateKey);
    for (const [blockId, key] of [...this.blockDateKeys]) {
      if (key === dateKey) this.blockDateKeys.delete(blockId);
    }
  }

  async listTimeLogs(): Promise<TimeLog[]> {
    return [...this.timeLogs];
  }
  async saveTimeLog(log: TimeLog): Promise<void> {
    this.timeLogs.push(log);
  }

  async listMemory(): Promise<MemoryEntry[]> {
    return [...this.memory.values()];
  }
  async saveMemory(entry: MemoryEntry): Promise<void> {
    this.memory.set(entry.id, entry);
  }
  async deleteMemory(id: string): Promise<void> {
    this.memory.delete(id);
  }

  async listDecisions(): Promise<DecisionLog[]> {
    return [...this.decisions];
  }
  async saveDecision(decision: DecisionLog): Promise<void> {
    this.decisions.push(decision);
  }

  async listDailyReviews(): Promise<DailyReview[]> {
    return [...this.dailyReviews];
  }
  async saveDailyReview(review: DailyReview): Promise<void> {
    const idx = this.dailyReviews.findIndex((r) => r.date === review.date);
    if (idx >= 0) this.dailyReviews[idx] = review;
    else this.dailyReviews.push(review);
  }

  async getPreference(key: string): Promise<string | undefined> {
    return this.preferences.get(key);
  }
  async setPreference(key: string, value: string): Promise<void> {
    this.preferences.set(key, value);
  }
}
