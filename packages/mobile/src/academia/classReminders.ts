import type { CalendarEvent, DataStore } from "@personalos/core";
import { fetchAcademiaData, fetchStudentPortalData, type AcademiaData, type StudentPortalData } from "./academiaClient";
import { startDirectLogin, submitDirectLogin, type StudentPortalResult } from "./studentPortalDirect";
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
  slot: string;
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

  const allCourses: CachedCourseRef[] = data.courses.map((c) => ({ code: c.course_code, title: c.course_title, slot: c.slot }));

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

const WEEK_SYNC_DAYS = 7;

/** SRM's day order only reliably comes from the portal for TODAY — it isn't
 * a fixed weekday mapping, since holidays shift the 5-day cycle unpredictably.
 * For the rest of the week we don't have a live source, so this estimates it
 * by cycling 1→2→3→4→5→1... once per non-Sunday day forward from today. This
 * is a best-effort guess, not a guarantee — it can drift around a holiday —
 * but it's what makes the Week view show class time at all for any day but
 * today, instead of silently showing none. */
function estimateDayOrder(baseDayOrder: number, offsetDays: number, date: Date): number | null {
  if (date.getDay() === 0) return null; // Sunday — assume no classes
  if (offsetDays === 0) return baseDayOrder;
  return ((baseDayOrder - 1 + offsetDays) % 5) + 1;
}

/** Deletes calendar events created by a previous sync (tracked by id, since
 * they're on possibly-earlier dates), then creates one fixed "class" event
 * per class across the next WEEK_SYNC_DAYS days (today's are exact, from
 * classes; future days are estimated via estimateDayOrder + allCourses'
 * slot codes), and records the new id list for next time. This is what
 * makes classes actually count against free time in
 * calculate_capacity/get_today_schedule/get_week_schedule — those already
 * sum up fixed CalendarEvents, we're just feeding them real ones. */
async function syncClassesToCalendar(store: DataStore, snapshot: CachedSchedule): Promise<void> {
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

  const [ty, tm, td] = snapshot.date.split("-").map(Number);
  const todayDate = new Date(ty, tm - 1, td);
  const overrides = await getCourseOverrides(store, snapshot.date);
  const newIds: string[] = [];

  const makeEvent = async (dateKey: string, date: Date, code: string, title: string, from: string, to: string) => {
    if (isCancelled(overrides, dateKey, code)) return;
    const [fh, fm] = from.split(":").map(Number);
    const [th, tm2] = to.split(":").map(Number);
    const startTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), fh, fm, 0, 0);
    const endTime = new Date(date.getFullYear(), date.getMonth(), date.getDate(), th, tm2, 0, 0);
    const id = calendarEventId(dateKey, code, from);
    const event: CalendarEvent = { id, title, startTime, endTime, type: "class", fixed: true };
    await store.saveCalendarEvent(event);
    newIds.push(id);
  };

  // Day 0: today's exact, already-resolved classes.
  for (const cls of snapshot.classes) {
    await makeEvent(snapshot.date, todayDate, cls.code, cls.title, cls.from, cls.to);
  }

  // Days 1..N: estimated day order + slot resolution against allCourses.
  if (snapshot.dayOrder !== null) {
    for (let offset = 1; offset < WEEK_SYNC_DAYS; offset++) {
      const date = new Date(todayDate.getTime() + offset * 86400000);
      const dayOrder = estimateDayOrder(snapshot.dayOrder, offset, date);
      if (dayOrder === null) continue;
      const dateKey = localDateKey(date);
      for (const c of snapshot.allCourses) {
        if (!c.slot) continue;
        const ranges = resolveSlotTimes(dayOrder, c.slot);
        for (const r of ranges) {
          await makeEvent(dateKey, date, c.code, c.title, r.from, r.to);
        }
      }
    }
  }

  await store.setPreference(SYNCED_EVENT_IDS_KEY, JSON.stringify(newIds));
}

/** Persists a snapshot (overwriting whatever was cached before — never a
 * growing log) and syncs its classes (today + the estimated rest of the
 * week) to the calendar. Exported so get_academia_status's live-fallback/
 * force-refresh path can save what it fetched too, not just the boot-time
 * refresh below. */
export async function saveSnapshot(store: DataStore, snapshot: CachedSchedule): Promise<void> {
  await store.setPreference(CACHE_KEY, JSON.stringify(snapshot));
  await syncClassesToCalendar(store, snapshot);
}

export type RefreshResult = { snapshot: CachedSchedule } | { error: string };

/** Merges an Academia fetch (timetable/schedule) and a Student Portal fetch
 * (live attendance/marks) into one snapshot — shared by the fully-automated
 * refresh below and the Attendance screen's manual-captcha refresh, so the
 * two paths can never build the cache differently from each other. */
export async function buildSnapshotFromSources(
  store: DataStore,
  academiaData: AcademiaData | null,
  studentPortalData: StudentPortalData | null,
  today: string
): Promise<CachedSchedule> {
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
          title: c.course_title,
          slot: c.slot || ""
        }));
      }
    }
  }

  return snapshot;
}

/**
 * Does a real live fetch and saves the result as today's snapshot. Used by
 * the boot-time daily refresh below and by get_academia_status's
 * forceRefresh/no-cache-yet fallback — both run with no one watching the
 * screen, so Student Portal attendance here relies on automated (Gemini
 * vision) CAPTCHA solving, which the heavily-distorted CAPTCHAs on this
 * portal have proven unreliable for. The Attendance screen's manual
 * "Refresh now" button uses startManualRefresh/submitManualRefresh below
 * instead, which has the user read the CAPTCHA themselves.
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
  const snapshot = await buildSnapshotFromSources(store, academiaData, studentPortalData, today);

  await saveSnapshot(store, snapshot);
  return { snapshot };
}

export interface ManualRefreshSession {
  /** data: URI, ready for <Image source={{ uri }} /> */
  captchaImageUri: string;
  netid: string;
  password: string;
  academiaDataPromise: Promise<AcademiaData | null>;
}

export type ManualRefreshStartResult = { session: ManualRefreshSession } | { error: string };

/**
 * Starts the Attendance screen's manual-captcha refresh: kicks off the
 * Academia (timetable) fetch in the background while fetching the real,
 * un-solved Student Portal CAPTCHA image for the user to read and type in
 * themselves — these CAPTCHAs are distorted enough that automated OCR
 * (including Gemini vision) has proven unreliable.
 *
 * The Student Portal half runs ON-DEVICE (see academia/studentPortalDirect),
 * not through our scraper service: every server-side attempt was silently
 * rejected regardless of how the request was built — even a real headless
 * browser — leaving the datacenter origin IP as the last untested variable.
 */
export async function startManualRefresh(store: DataStore): Promise<ManualRefreshStartResult> {
  const email = await store.getPreference("academia_email");
  const password = await store.getPreference("academia_password");
  const spNetId = await store.getPreference("student_portal_netid");
  const spPassword = await store.getPreference("student_portal_password");

  if (!spNetId || !spPassword) {
    return { error: "Add your SRM Student Portal NetID and password in Settings to refresh attendance." };
  }

  const sessionRaw = await store.getPreference("academia_session");
  let academiaSession: unknown;
  try {
    academiaSession = sessionRaw ? JSON.parse(sessionRaw) : undefined;
  } catch {
    academiaSession = undefined;
  }

  const academiaDataPromise = email && password ? fetchAcademiaData(email, password, academiaSession) : Promise.resolve(null);

  const captchaResult = await startDirectLogin();
  if (!captchaResult.success) {
    return { error: captchaResult.message };
  }

  return {
    session: {
      captchaImageUri: captchaResult.challenge.captchaImageUri,
      netid: spNetId,
      password: spPassword,
      academiaDataPromise
    }
  };
}

export type ManualRefreshSubmitResult =
  | { snapshot: CachedSchedule }
  | { error: string; wrongCaptcha?: boolean; locked?: boolean; expired?: boolean };

/** Completes a manual refresh started via startManualRefresh() using the
 * captcha text the user typed in, merges it with the (by-now-likely-done)
 * Academia fetch, and saves the result exactly like fetchAndSaveSnapshot
 * does. On a wrong-captcha/expired result, the caller should call
 * startManualRefresh() again for a fresh image rather than retrying with
 * the same session. */
export async function submitManualRefresh(
  store: DataStore,
  session: ManualRefreshSession,
  captchaText: string,
  now: Date = new Date()
): Promise<ManualRefreshSubmitResult> {
  const [submitResult, academiaData] = await Promise.all([
    submitDirectLogin(session.netid, session.password, captchaText),
    session.academiaDataPromise
  ]);

  if (!submitResult.success) {
    return {
      error: submitResult.message,
      wrongCaptcha: submitResult.wrongCaptcha,
      locked: submitResult.locked
    };
  }

  if (academiaData?.sessionData) {
    store.setPreference("academia_session", JSON.stringify(academiaData.sessionData)).catch(() => {});
  }

  const today = localDateKey(now);
  const snapshot = await buildSnapshotFromSources(store, academiaData, toStudentPortalData(submitResult.data), today);

  await saveSnapshot(store, snapshot);
  return { snapshot };
}

/** Adapts the on-device scraper's result to the shape
 * buildSnapshotFromSources already consumes (which mirrors the scraper
 * service's JSON), so both refresh paths keep sharing one merge. */
function toStudentPortalData(result: StudentPortalResult): StudentPortalData {
  return {
    status: "success",
    student_info: { reg_no: result.studentInfo.regNo, name: result.studentInfo.name },
    attendance: {
      courses: result.attendance.courses.map((c) => ({
        course_code: c.courseCode,
        course_title: c.courseTitle,
        category: c.category,
        faculty_name: c.facultyName,
        slot: c.slot,
        hours_conducted: c.hoursConducted,
        hours_absent: c.hoursAbsent,
        attendance_percentage: c.attendancePercentage
      })),
      overall_attendance: result.attendance.overallAttendance,
      total_hours_conducted: result.attendance.totalHoursConducted,
      total_hours_absent: result.attendance.totalHoursAbsent
    },
    marks: {
      courses: result.marks.courses.map((c) => ({
        course_code: c.courseCode,
        course_title: c.courseTitle,
        components: c.components.map((comp) => ({
          test_name: comp.testName,
          marks_obtained: comp.marksObtained,
          max_marks: comp.maxMarks,
          raw_text: comp.rawText
        }))
      }))
    }
  };
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
