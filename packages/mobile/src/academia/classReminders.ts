import type { CalendarEvent, DataStore } from "@personalos/core";
import { fetchAcademiaData, fetchStudentPortalData, type AcademiaData } from "./academiaClient";
import { resolveSlotTimes } from "./timeGrid";
import { getCourseOverrides, isCancelled } from "./courseOverrides";

/**
 * The single daily academia snapshot — one cache, refreshed at most once per
 * calendar day (on app boot), that both the deterministic class-reminder
 * notifications AND the get_academia_status tool read from. Two reasons for
 * one shared cache instead of two separate fetches:
 *  - get_academia_status used to hit the live scraper on every single
 *    question, which is slow (Render free-tier cold starts) and, per the
 *    user, means a portal outage makes Jeeko unable to answer at all even
 *    though it already knew the answer minutes ago.
 *  - It also drives the deterministic (non-AI) class-reminder notifications,
 *    unaffected by any of the above — see notifications/scheduler.ts.
 * Writing to CACHE_KEY always overwrites the previous day's entry (one key,
 * not a growing log) — there is never old data sitting around once today's
 * snapshot lands.
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

export interface CachedAttendanceCourse {
  title: string;
  slot: string;
  attendancePercent: number;
  hoursConducted: number;
  hoursAbsent: number;
}

export interface CachedSchedule {
  date: string; // "YYYY-MM-DD", device-local
  dayOrder: number | null;
  isHoliday: boolean;
  isAttendanceAvailable: boolean;
  overallAttendancePercent: number | null;
  attendanceByCourse: CachedAttendanceCourse[];
  classes: CachedClassEntry[];
  /** Every registered course (not just today's), for resolving free-text
   * course references when cancelling — a course not meeting today still
   * needs to be matchable for a permanent cancellation. */
  allCourses: CachedCourseRef[];
}

export const CACHE_KEY = "academia_today_schedule_cache";
const SYNCED_EVENT_IDS_KEY = "academia_synced_calendar_event_ids";

export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function calendarEventId(date: string, courseCode: string, from: string): string {
  return `academia-${date}-${courseCode}-${from.replace(":", "")}`;
}

/** Turns a raw AcademiaData fetch into the cached snapshot shape — shared by
 * the boot-time refresh below and get_academia_status's own live-fallback,
 * so the two paths can never compute this differently. */
export async function buildSnapshot(store: DataStore, data: AcademiaData, today: string): Promise<CachedSchedule> {
  const overrides = await getCourseOverrides(store, today);

  const attendanceByTitle = new Map<string, number>();
  const attendanceByCourse: CachedAttendanceCourse[] = [];
  for (const c of Object.values(data.attendanceByCourse)) {
    if (typeof c.attendance_percentage === "number") {
      attendanceByTitle.set(c.course_title.trim().toLowerCase(), c.attendance_percentage);
    }
    attendanceByCourse.push({
      title: c.course_title,
      slot: c.slot,
      attendancePercent: c.attendance_percentage,
      hoursConducted: c.hours_conducted,
      hoursAbsent: c.hours_absent
    });
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

  return {
    date: today,
    dayOrder: data.dayOrder,
    isHoliday: data.isHoliday,
    isAttendanceAvailable: !data.isAttendanceMock,
    overallAttendancePercent: data.isAttendanceMock ? null : data.overallAttendance,
    attendanceByCourse: data.isAttendanceMock ? [] : attendanceByCourse,
    classes,
    allCourses
  };
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

/** Persists a snapshot (overwriting whatever was cached before — never a
 * growing log) and syncs its classes to the calendar. Exported so
 * get_academia_status's live-fallback/force-refresh path can save what it
 * fetched too, not just the boot-time refresh below. */
export async function saveSnapshot(store: DataStore, snapshot: CachedSchedule): Promise<void> {
  await store.setPreference(CACHE_KEY, JSON.stringify(snapshot));
  await syncClassesToCalendar(store, snapshot.date, snapshot.classes);
}

export type RefreshResult = { snapshot: CachedSchedule } | { error: string };

/**
 * Does a real live fetch and saves the result as today's snapshot — the one
 * place this actually happens. Used by the boot-time daily refresh below,
 * by get_academia_status's forceRefresh/no-cache-yet fallback, and by the
 * Attendance screen's manual "Refresh now" button, so all three can never
 * fetch or cache differently from each other.
 */
export async function fetchAndSaveSnapshot(store: DataStore, now: Date = new Date()): Promise<RefreshResult> {
  const email = await store.getPreference("academia_email");
  const password = await store.getPreference("academia_password");
  const spNetId = await store.getPreference("student_portal_netid");
  const spPassword = await store.getPreference("student_portal_password");

  if (!email && !spNetId) {
    return { error: "Portal credentials aren't set up yet — add them in Settings." };
  }

  const sessionRaw = await store.getPreference("academia_session");
  let session: unknown;
  try {
    session = sessionRaw ? JSON.parse(sessionRaw) : undefined;
  } catch {
    session = undefined;
  }

  // Fetch Academia (timetable & schedule) and Student Portal (live attendance & marks)
  const [academiaData, studentPortalData] = await Promise.all([
    email && password ? fetchAcademiaData(email, password, session) : Promise.resolve(null),
    spNetId && spPassword ? fetchStudentPortalData(spNetId, spPassword) : Promise.resolve(null)
  ]);

  if (!academiaData && !studentPortalData) {
    return {
      error:
        "Couldn't reach the scraper or login failed. Please check your credentials in Settings or try again shortly."
    };
  }

  if (academiaData?.sessionData) {
    store.setPreference("academia_session", JSON.stringify(academiaData.sessionData)).catch(() => {});
  }

  const today = localDateKey(now);
  let snapshot: CachedSchedule;

  if (academiaData) {
    snapshot = await buildSnapshot(store, academiaData, today);
  } else {
    snapshot = {
      date: today,
      dayOrder: null,
      isHoliday: false,
      isAttendanceAvailable: false,
      overallAttendancePercent: null,
      attendanceByCourse: [],
      classes: [],
      allCourses: []
    };
  }

  // If Student Portal returned genuine attendance data, merge it into snapshot
  if (studentPortalData?.attendance) {
    const spAtt = studentPortalData.attendance;
    snapshot.isAttendanceAvailable = true;
    snapshot.overallAttendancePercent =
      typeof spAtt.overall_attendance === "number" ? spAtt.overall_attendance : null;

    if (Array.isArray(spAtt.courses) && spAtt.courses.length > 0) {
      snapshot.attendanceByCourse = spAtt.courses.map((c) => ({
        title: c.course_title || c.course_code,
        slot: c.slot || "",
        attendancePercent: c.attendance_percentage,
        hoursConducted: c.hours_conducted,
        hoursAbsent: c.hours_absent
      }));

      if (snapshot.allCourses.length === 0) {
        snapshot.allCourses = spAtt.courses.map((c) => ({
          code: c.course_code,
          title: c.course_title
        }));
      }
    }
  }

  await saveSnapshot(store, snapshot);
  return { snapshot };
}

/**
 * Refreshes the cached snapshot at most once per calendar day, so neither
 * the notification scheduler nor get_academia_status ever have to hit the
 * network for an ordinary question. Call this once on app boot; it's a
 * cheap no-op if today's cache already exists or credentials aren't set up
 * — silent on failure (best-effort, will retry on next boot) since nothing
 * is waiting on it directly.
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

  await fetchAndSaveSnapshot(store, now);
}

/** Reads today's cached snapshot, if any — no network call. Used by the
 * notification scheduler (which runs far more often than once a day) and by
 * get_academia_status as its default, fast path. Re-applies cancellation
 * overrides to `classes` live, so a cancellation made mid-day (after the
 * cache was already built) takes effect immediately without a fresh fetch.
 * Returns null if there's no cache, or the cache isn't from today. */
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

/** Reads whatever's cached regardless of date — including stale, prior-day
 * data — so a UI can show "last synced X" instead of just "no data." Use
 * getTodaysClassScheduleCache instead when you need today's data or nothing. */
export async function getCachedSnapshotRaw(store: DataStore): Promise<CachedSchedule | null> {
  const raw = await store.getPreference(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedSchedule;
  } catch {
    return null;
  }
}
