import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { executeTool, formatMinutes, type DataStore, type PlannedBlock, type Task } from "@personalos/core";

/** Configure how notifications appear when the app is in the foreground */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false
  })
});

/** Request permission — call once on app start */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/** Cancel all previously scheduled PA notifications */
export async function cancelAllPANotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Reschedule intelligent notifications based on the current plan.
 * Called after every plan recalculation or data mutation.
 */
export async function scheduleNotifications(params: {
  store: DataStore;
  now: Date;
}): Promise<void> {
  if (Platform.OS === "web") return;

  const { store, now } = params;
  await cancelAllPANotifications();

  try {
    // Get today's schedule
    const schedule = (await executeTool("get_today_schedule", {}, { store, now })) as any;
    const blocks: PlannedBlock[] = schedule.blocks ?? [];
    const tasks: Task[] = await store.listTasks();

    const upcoming = blocks
      .filter((b) => new Date(b.startTime).getTime() > now.getTime())
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // 1. Next-block reminders (5 min before each upcoming block)
    for (const block of upcoming.slice(0, 5)) {
      const task = tasks.find((t) => t.id === block.taskId);
      if (!task) continue;

      const blockStart = new Date(block.startTime);
      const triggerMs = blockStart.getTime() - 5 * 60000 - now.getTime();
      if (triggerMs < 10000) continue; // too close or past

      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Up next: ${task.title}`,
          body: `${formatMinutes(block.durationMinutes)} block starting in 5 minutes. ${block.reason}`,
          data: { type: "block_reminder", taskId: task.id, blockId: block.id }
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.floor(triggerMs / 1000) }
      });
    }

    // 2. Hard deadline warnings (tasks with hard deadlines within 24h)
    const oneDayMs = 24 * 60 * 60 * 1000;
    const urgentDeadlineTasks = tasks.filter(
      (t) =>
        t.deadline &&
        t.deadlineType === "hard" &&
        t.status !== "completed" &&
        t.status !== "cancelled" &&
        new Date(t.deadline).getTime() - now.getTime() < oneDayMs &&
        new Date(t.deadline).getTime() > now.getTime()
    );

    for (const task of urgentDeadlineTasks) {
      const deadline = new Date(task.deadline!);
      const hoursLeft = Math.round((deadline.getTime() - now.getTime()) / 3600000);

      // Schedule for 1 minute from now (immediate attention)
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `Deadline approaching: ${task.title}`,
          body: `Due in ~${hoursLeft}h. Estimated ${formatMinutes(task.estimatedMinutes)} of work remaining.`,
          data: { type: "deadline_warning", taskId: task.id }
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 60 }
      });
    }

    // 3. Overload warning (if day is overcommitted)
    const capacity = schedule.capacity;
    if (capacity) {
      const committed = blocks.reduce((s: number, b: PlannedBlock) => s + b.durationMinutes, 0);
      const unscheduledWork = (schedule.unscheduledTaskIds ?? []).reduce((s: number, id: string) => {
        const t = tasks.find((task) => task.id === id);
        return s + (t?.estimatedMinutes ?? 0);
      }, 0);

      if (committed + unscheduledWork > capacity.usableMinutes) {
        const overload = committed + unscheduledWork - capacity.usableMinutes;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Today is overloaded",
            body: `You have ${formatMinutes(overload)} more work than usable time. Some tasks need to move.`,
            data: { type: "overload_warning" }
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 120 }
        });
      }
    }

    // 4. Daily review prompt (schedule for sleep time - 30min)
    const user = await store.getUser();
    if (user?.preferredSleepTime) {
      const [h, m] = user.preferredSleepTime.split(":").map(Number);
      const reviewTime = new Date(now);
      reviewTime.setHours(h, m - 30, 0, 0);
      const reviewMs = reviewTime.getTime() - now.getTime();

      if (reviewMs > 60000) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Daily Review",
            body: "Time to review your day — check what got done, log actual time, and prep tomorrow.",
            data: { type: "daily_review" }
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.floor(reviewMs / 1000) }
        });
      }
    }
  } catch (e) {
    // Notification scheduling is best-effort — don't crash the app
    console.warn("Failed to schedule notifications:", e);
  }
}
