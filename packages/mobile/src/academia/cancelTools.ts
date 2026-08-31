import type { DataStore } from "@personalos/core";
import type { ExternalTool } from "@personalos/core";
import { getTodaysClassScheduleCache, calendarEventId, localDateKey } from "./classReminders";
import { cancelClassToday, cancelCoursePermanently, resolveCourse } from "./courseOverrides";

/**
 * Mobile-only tools for cancelling classes — local-only state (the portal
 * has no "cancelled today" concept), applied to the schedule cache,
 * synced calendar events, and class-reminder notifications. See
 * courseOverrides.ts and classReminders.ts.
 */
export function createCancelTools(store: DataStore): ExternalTool[] {
  const cancelToday: ExternalTool = {
    name: "cancel_class_today",
    description:
      "Cancels one of today's classes for today only (e.g. 'my DBMS class is cancelled today'). Frees up that time in the schedule/free-time calculation and stops its class reminder. Does not affect other days.",
    parameters: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or code as the user said it, e.g. 'DBMS' or 'Discrete Mathematics'" }
      },
      required: ["course"]
    },
    handler: async (args: { course: string }) => {
      const now = new Date();
      const today = localDateKey(now);
      const cache = await getTodaysClassScheduleCache(store, now);
      if (!cache || cache.classes.length === 0) {
        return { error: "No class schedule is available for today right now — nothing to cancel." };
      }
      const match = resolveCourse(
        args.course,
        cache.classes.map((c) => ({ course_code: c.code, course_title: c.title }))
      );
      if (!match) {
        return { error: `Couldn't find a class matching "${args.course}" in today's schedule. Ask the user for the exact course name.` };
      }
      const entries = cache.classes.filter((c) => c.code === match.course_code);
      for (const e of entries) {
        await store.deleteCalendarEvent(calendarEventId(today, e.code, e.from)).catch(() => {});
      }
      await cancelClassToday(store, today, match.course_code);
      return { success: true, message: `${match.course_title} is cancelled for today. That time is now free.` };
    }
  };

  const cancelPermanent: ExternalTool = {
    name: "cancel_course_permanently",
    description:
      "Drops a course entirely, going forward — e.g. the user says a subject is fully cancelled/discontinued. It will no longer appear in the schedule, free-time calculation, or class reminders on any future day. Only use this for a permanent change, not a single cancelled class — use cancel_class_today for that.",
    parameters: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course name or code as the user said it" }
      },
      required: ["course"]
    },
    handler: async (args: { course: string }) => {
      const now = new Date();
      const today = localDateKey(now);
      const cache = await getTodaysClassScheduleCache(store, now);
      const pool = cache ? [...cache.classes.map((c) => ({ course_code: c.code, course_title: c.title })), ...cache.allCourses.map((c) => ({ course_code: c.code, course_title: c.title }))] : [];
      const match = resolveCourse(args.course, pool);
      if (!match) {
        return { error: `Couldn't find a course matching "${args.course}". Ask the user for the exact course name.` };
      }
      if (cache) {
        const entries = cache.classes.filter((c) => c.code === match.course_code);
        for (const e of entries) {
          await store.deleteCalendarEvent(calendarEventId(today, e.code, e.from)).catch(() => {});
        }
      }
      await cancelCoursePermanently(store, today, match.course_code);
      return { success: true, message: `${match.course_title} is permanently cancelled — it won't show up in the schedule or reminders anymore.` };
    }
  };

  return [cancelToday, cancelPermanent];
}
