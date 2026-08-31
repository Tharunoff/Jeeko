import type { CalendarEvent, DataStore } from "@personalos/core";
import { fetchAcademiaData } from "./academiaClient";
import { resolveSlotTimes } from "./timeGrid";
import { getCourseOverrides, isCancelled } from "./courseOverrides";

/**
 * Deterministic (non-AI) class-reminder pipeline. This is explicitly NOT
 * routed through the agent loop — it's a plain data fetch + local
 * notification schedule, per the user's request ("no need to connect ai for
 * that"). It shares timeGrid.ts's slot resolution with the get_academia_status
 * tool, but runs independently on app boot.
 *
 * It also syncs today's classes into the core DataStore as real
 * CalendarEvent rows (type "class", fixed) so the existing capacity/
 * scheduling engines automatically subtract them from free time — no
 * changes needed in core for that, it's just feeding it real data.
 */

export interface CachedClassEntry {
  code: string;
  title: string;
  room: string;
  faculty: string;
  from: string; // "HH:MM" 24h
  to: string;
  attendancePercent: number | null;
}

export interface CachedCourseRef {
  code: string;
  title: string;
}

export interface CachedSchedule {
  date: string; // "YYYY-MM-DD", device-local
  dayOrder: number | null;
  isHoliday: boolean;
  classes: CachedClassEntry[];
  /** Every registered course (not just today's), for resolving free-text
   * course references when cancelling — a course not meeting today still
   * needs to be matchable for a permanent cancellation. */
  allCourses: CachedCourseRef[];
}

const CACHE_KEY = "academia_today_schedule_cache";
const SYNCED_EVENT_IDS_KEY = "academia_synced_calendar_event_ids";

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function calendarEventId(date: string, courseCode: string, from: string): string {
  return `academia-${date}-${courseCode}-${from.replace(":", "")}`;
}

/** Deletes calendar events created by a previous sync (tracked by id, since
 * they're on possibly-earlier dates), then creates one fixed "class" event
 * per today's (non-cancelled) class, and records the new id list for next
 * time. This is what makes classes actually count against free time in
 * calculate_capacity/get_today_schedule — those already sum up fixed
 * CalendarEvents, we're just feeding them real ones. */
async function syncClassesToCalendar(store: DataStore, today: string, classes: CachedClassEntry[]): Promise<void> {
  const prevIdsRaw = await store.getPreference(SYNCED_EVENT_IDS_KEY);
  let prevIds: string[] = [];
  try {
    prevIds = prevIdsRaw ? JSON.parse(prevIdsRaw) : [];
  } catch {
    prevIds = [];
  }
  for (const id of prevIds) {
    await store.deleteCalendarEvent(id).catch(() => {});
  }

  const newIds: string[] = [];
  for (const cls of classes) {
    const [fh, fm] = cls.from.split(":").map(Number);
    const [th, tm] = cls.to.split(":").map(Number);
    const [y, mo, d] = today.split("-").map(Number);
    const startTime = new Date(y, mo - 1, d, fh, fm, 0, 0);
    const endTime = new Date(y, mo - 1, d, th, tm, 0, 0);
    const id = calendarEventId(today, cls.code, cls.from);
    const event: CalendarEvent = { id, title: cls.title, startTime, endTime, type: "class", fixed: true };
    await store.saveCalendarEvent(event);
    newIds.push(id);
  }
  await store.setPreference(SYNCED_EVENT_IDS_KEY, JSON.stringify(newIds));
}

/**
 * Fetches live academia data and computes today's class schedule (with each
 * course's current attendance %), caching it locally — at most once per
 * calendar day, so the notification scheduler (which re-runs after every app
 * mutation) never has to hit the network. Call this once on app boot; it's a
 * cheap no-op if today's cache already exists or credentials aren't set up.
 */
export async function ensureTodaysClassScheduleCache(store: DataStore, now: Date = new Date()): Promise<void> {
  const today = localDateKey(now);

  const cachedRaw = await store.getPreference(CACHE_KEY);
  if (cachedRaw) {
    try {
      const cached: CachedSchedule = JSON.parse(cachedRaw);
      if (cached.date === today) return; // already fresh for today
    } catch {
      // corrupt cache — fall through and refetch
    }
  }

  const email = await store.getPreference("academia_email");
  const password = await store.getPreference("academia_password");
  if (!email || !password) return; // academia portal not configured yet

  const sessionRaw = await store.getPreference("academia_session");
  let session: unknown;
  try {
    session = sessionRaw ? JSON.parse(sessionRaw) : undefined;
  } catch {
    session = undefined;
  }

  const data = await fetchAcademiaData(email, password, session);
  if (!data) return; // best-effort — will retry on next boot

  if (data.sessionData) {
    store.setPreference("academia_session", JSON.stringify(data.sessionData)).catch(() => {});
  }

  const overrides = await getCourseOverrides(store, today);

  const attendanceByTitle = new Map<string, number>();
  for (const c of Object.values(data.attendanceByCourse)) {
    if (typeof c.attendance_percentage === "number") {
      attendanceByTitle.set(c.course_title.trim().toLowerCase(), c.attendance_percentage);
    }
  }

  const classes: CachedClassEntry[] = [];
  if (typeof data.dayOrder === "number") {
    for (const c of data.courses) {
      if (isCancelled(overrides, today, c.course_code)) continue;
      const ranges = resolveSlotTimes(data.dayOrder, c.slot);
      for (const r of ranges) {
        classes.push({
          code: c.course_code,
          title: c.course_title,
          room: c.room_no,
          faculty: c.faculty_name,
          from: r.from,
          to: r.to,
          attendancePercent: attendanceByTitle.get(c.course_title.trim().toLowerCase()) ?? null
        });
      }
    }
    classes.sort((a, b) => a.from.localeCompare(b.from));
  }

  const allCourses: CachedCourseRef[] = data.courses.map((c) => ({ code: c.course_code, title: c.course_title }));

  const cache: CachedSchedule = { date: today, dayOrder: data.dayOrder, isHoliday: data.isHoliday, classes, allCourses };
  await store.setPreference(CACHE_KEY, JSON.stringify(cache));
  await syncClassesToCalendar(store, today, classes);
}

/** Reads today's cached class schedule, if any — no network call. Used by
 * the notification scheduler, which runs far more often than once a day.
 * Re-applies cancellation overrides live, so a cancellation made mid-day
 * (after the cache was already built) takes effect immediately without
 * needing a fresh network fetch. */
export async function getTodaysClassScheduleCache(store: DataStore, now: Date = new Date()): Promise<CachedSchedule | null> {
  const raw = await store.getPreference(CACHE_KEY);
  if (!raw) return null;
  const today = localDateKey(now);
  try {
    const cached: CachedSchedule = JSON.parse(raw);
    if (cached.date !== today) return null;
    const overrides = await getCourseOverrides(store, today);
    return { ...cached, classes: cached.classes.filter((c) => !isCancelled(overrides, today, c.code)) };
  } catch {
    return null;
  }
}
