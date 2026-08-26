import type { CalendarEvent, Goal, Project, Task, UserProfile } from "../src/types/index";

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter}`;
}

export function makeUser(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user_1",
    name: "Test User",
    timezone: "UTC",
    preferredWakeTime: "07:00",
    preferredSleepTime: "23:00",
    productivityPreferences: {},
    ...overrides
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: nextId("task"),
    title: "Test task",
    goalIds: [],
    estimatedMinutes: 60,
    deadlineType: "none",
    importance: 0.5,
    urgency: 0.5,
    energyRequirement: "medium",
    difficulty: "medium",
    status: "planned",
    dependencies: [],
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: nextId("goal"),
    title: "Test goal",
    priorityWeight: 0.5,
    status: "active",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: nextId("project"),
    title: "Test project",
    goalIds: [],
    importance: 0.5,
    status: "active",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

export function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: nextId("event"),
    title: "Test event",
    startTime: new Date("2026-01-05T10:00:00.000Z"),
    endTime: new Date("2026-01-05T12:00:00.000Z"),
    type: "meeting",
    fixed: true,
    ...overrides
  };
}

/** A fixed reference "today" (a Monday) used across tests so dates are deterministic. */
export const TEST_DATE = new Date("2026-01-05T00:00:00.000Z");
