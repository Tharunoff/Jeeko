// Core domain types for PersonalOS. These mirror the product spec's schemas.
// Two deliberate additions beyond the spec, both required for persistence/UI to work:
//   - PlannedBlock.id (needs a stable key for notification cancellation + DB rows)
//   - Task.deadlineType (spec distinguishes hard/soft/target/none deadlines in prose
//     but never adds the field to the Task interface)

export type ID = string;

export interface UserProfile {
  id: ID;
  name: string;
  preferredWakeTime?: string; // "HH:mm", local to `timezone`
  preferredSleepTime?: string; // "HH:mm", local to `timezone`
  timezone: string; // IANA zone name, e.g. "Asia/Kolkata"
  productivityPreferences: {
    preferredWorkDuration?: number; // minutes
    preferredBreakDuration?: number; // minutes
    maxDeepWorkSession?: number; // minutes
  };
}

export type GoalStatus = "active" | "paused" | "completed" | "cancelled";

export interface Goal {
  id: ID;
  title: string;
  description?: string;
  priorityWeight: number; // 0..1, how much this goal should pull priority toward it
  deadline?: Date;
  status: GoalStatus;
  progress: number; // 0..1
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectStatus = "active" | "paused" | "completed" | "cancelled";

export interface Project {
  id: ID;
  title: string;
  description?: string;
  goalIds: ID[];
  deadline?: Date;
  importance: number; // 0..1
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type EnergyLevel = "low" | "medium" | "high";
export type Difficulty = "easy" | "medium" | "hard";
export type TaskStatus =
  | "inbox"
  | "planned"
  | "in_progress"
  | "blocked"
  | "completed"
  | "cancelled";

/** Hard = cannot move. Soft = can potentially move. Target = user's preferred date, not a real constraint. None = no deadline pressure. */
export type DeadlineType = "hard" | "soft" | "target" | "none";

export interface Task {
  id: ID;
  title: string;
  description?: string;
  projectId?: ID;
  goalIds: ID[];
  estimatedMinutes: number;
  deadline?: Date;
  deadlineType: DeadlineType;
  priorityOverride?: number; // 0..1, if set this wins over the computed finalScore
  importance: number; // 0..1
  urgency: number; // 0..1, manually-entered signal; the engine still recomputes dynamic priority
  energyRequirement: EnergyLevel;
  difficulty: Difficulty;
  status: TaskStatus;
  dependencies: ID[]; // IDs of tasks this task depends on
  /** Internal addition: when set, the scheduler excludes this task from any day before
   * this date. This is what "move this to tomorrow" / "I can't do this today" actually
   * changes — the spec's Task schema has no field for manual deferral, and without one
   * a user-requested defer would have no persisted effect. */
  deferredUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export type CalendarEventType =
  | "class"
  | "meeting"
  | "travel"
  | "meal"
  | "sleep"
  | "appointment"
  | "other";

export interface CalendarEvent {
  id: ID;
  title: string;
  startTime: Date;
  endTime: Date;
  type: CalendarEventType;
  fixed: boolean;
}

export interface PlannedBlock {
  id: ID; // internal addition — needed to persist/cancel/reschedule a specific block
  taskId: ID;
  startTime: Date;
  endTime: Date;
  durationMinutes: number;
  reason: string;
}

export interface PriorityScore {
  urgency: number;
  importance: number;
  goalAlignment: number;
  dependencyImpact: number;
  deadlinePressure: number;
  consequenceOfDelay: number;
  finalScore: number;
}

export type FeasibilityOutcome =
  | "FEASIBLE"
  | "PARTIAL"
  | "NOT_FEASIBLE"
  | "FEASIBLE_IF_MOVED";

export interface FeasibilityResult {
  feasible: boolean;
  outcome: FeasibilityOutcome;
  availableMinutes: number;
  requiredMinutes: number;
  shortfallMinutes: number;
  conflictingTasks: ID[];
  recommendedPlan: PlannedBlock[];
  confidence: number; // 0..1
  explanation: string;
}

export interface DecisionLog {
  id: ID;
  decision: string;
  reason: string;
  affectedTasks: ID[];
  timestamp: Date;
}

export interface TimeLog {
  id: ID;
  taskId: ID;
  startedAt?: Date;
  endedAt?: Date;
  actualMinutes: number;
  estimatedMinutesAtTime: number; // snapshot of the estimate when this log was recorded
  createdAt: Date;
}

export type MemoryKind =
  | "preference"
  | "goal_context"
  | "project_context"
  | "decision_context"
  | "fact";

export interface MemoryEntry {
  id: ID;
  kind: MemoryKind;
  key: string;
  value: unknown; // JSON-serializable
  expiresAt?: Date; // undefined = permanent
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyReview {
  id: ID;
  date: string; // "YYYY-MM-DD" in the user's local timezone
  completedCount: number;
  incompleteCount: number;
  estimatedTotalMinutes: number;
  actualTotalMinutes: number;
  mainIssue?: string;
  tomorrowAdjustment?: string;
  createdAt: Date;
}

export interface TimeWindow {
  start: Date;
  end: Date;
  minutes: number;
  energyTag: "deep" | "low";
}

export interface CapacityBreakdown {
  date: string; // "YYYY-MM-DD" local
  wakingMinutes: number;
  fixedMinutes: number; // class/meeting/appointment/sleep/other fixed events
  travelMinutes: number;
  mealMinutes: number;
  breakMinutes: number;
  bufferMinutes: number;
  totalFreeMinutes: number; // waking - fixed - travel
  usableMinutes: number; // totalFreeMinutes - meals - breaks - buffer
  deepWorkMinutes: number;
  lowEnergyMinutes: number;
  windows: TimeWindow[];
}

export interface ReasoningFactor {
  label: string;
  detail: string;
  weight?: number;
}

export interface OverloadWarning {
  date: string; // "YYYY-MM-DD"
  usableMinutes: number;
  committedMinutes: number;
  overloadMinutes: number;
  message: string;
}

// --- LLM layer ---

export type MessageRole = "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  text?: string;
  audio?: { base64: string; mimeType: string };
  toolCallId?: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
}

export interface AssistantContext {
  now: Date;
  user: UserProfile;
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: unknown;
}

export interface LLMResponse {
  text?: string;
  toolCalls?: ToolCallRequest[];
}

export interface LLMProvider {
  generateResponse(
    messages: Message[],
    context: AssistantContext,
    tools: ToolDeclaration[]
  ): Promise<LLMResponse>;
}

// --- Future Apollo integration boundary (disabled in V1) ---

export interface AgentCommand {
  type: string;
  payload: unknown;
}

export interface AgentResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface ExternalAgentBridge {
  execute(command: AgentCommand): Promise<AgentResult>;
}
