import type { DataStore, UserProfile } from "@personalos/core";
import { generateId, localDateKey } from "@personalos/core";

/**
 * Dev-only sample data so the UI can be exercised end-to-end before real tools/chat
 * input exist. Clearly labelled as sample data (never presented as real production
 * data) — this is a debug convenience, not a seeded "default" experience.
 */
export async function seedSampleData(store: DataStore, user: UserProfile): Promise<void> {
  const now = new Date();
  const todayKey = localDateKey(now, user.timezone);

  const goal = {
    id: generateId("goal"),
    title: "[Sample] Ace this semester",
    priorityWeight: 0.9,
    status: "active" as const,
    progress: 0.3,
    createdAt: now,
    updatedAt: now
  };
  await store.saveGoal(goal);

  const project = {
    id: generateId("project"),
    title: "[Sample] Recruitment portal",
    goalIds: [goal.id],
    importance: 0.7,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
    deadline: new Date(now.getTime() + 3 * 86400000)
  };
  await store.saveProject(project);

  await store.saveCalendarEvent({
    id: generateId("event"),
    title: "[Sample] CN Class",
    startTime: new Date(`${todayKey}T10:00:00`),
    endTime: new Date(`${todayKey}T12:00:00`),
    type: "class",
    fixed: true
  });
  await store.saveCalendarEvent({
    id: generateId("event"),
    title: "[Sample] Lunch",
    startTime: new Date(`${todayKey}T13:00:00`),
    endTime: new Date(`${todayKey}T13:30:00`),
    type: "meal",
    fixed: true
  });

  const examTask = {
    id: generateId("task"),
    title: "[Sample] CN exam preparation",
    goalIds: [goal.id],
    estimatedMinutes: 90,
    deadline: new Date(now.getTime() + 1 * 86400000),
    deadlineType: "hard" as const,
    importance: 0.9,
    urgency: 0.8,
    energyRequirement: "high" as const,
    difficulty: "hard" as const,
    status: "planned" as const,
    dependencies: [],
    createdAt: now,
    updatedAt: now
  };
  await store.saveTask(examTask);

  const schemaTask = {
    id: generateId("task"),
    title: "[Sample] Design database schema",
    projectId: project.id,
    goalIds: [goal.id],
    estimatedMinutes: 60,
    deadlineType: "soft" as const,
    importance: 0.7,
    urgency: 0.5,
    energyRequirement: "high" as const,
    difficulty: "medium" as const,
    status: "planned" as const,
    dependencies: [],
    createdAt: now,
    updatedAt: now
  };
  await store.saveTask(schemaTask);

  await store.saveTask({
    id: generateId("task"),
    title: "[Sample] Implement portal API",
    projectId: project.id,
    goalIds: [goal.id],
    estimatedMinutes: 240,
    deadline: project.deadline,
    deadlineType: "hard" as const,
    importance: 0.8,
    urgency: 0.6,
    energyRequirement: "high" as const,
    difficulty: "hard" as const,
    status: "planned" as const,
    dependencies: [schemaTask.id],
    createdAt: now,
    updatedAt: now
  });

  await store.saveTask({
    id: generateId("task"),
    title: "[Sample] Read research paper",
    goalIds: [],
    estimatedMinutes: 45,
    deadlineType: "none" as const,
    importance: 0.3,
    urgency: 0.2,
    energyRequirement: "low" as const,
    difficulty: "easy" as const,
    status: "planned" as const,
    dependencies: [],
    createdAt: now,
    updatedAt: now
  });

  await store.saveTask({
    id: generateId("task"),
    title: "[Sample] Reply to emails",
    goalIds: [],
    estimatedMinutes: 20,
    deadlineType: "none" as const,
    importance: 0.2,
    urgency: 0.3,
    energyRequirement: "low" as const,
    difficulty: "easy" as const,
    status: "planned" as const,
    dependencies: [],
    createdAt: now,
    updatedAt: now
  });
}
