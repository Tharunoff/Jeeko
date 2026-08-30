import type { DataStore } from "@personalos/core";
import { fetchAcademiaData } from "./academiaClient";
import { resolveSlotTimes } from "./timeGrid";

/**
 * Deterministic (non-AI) class-reminder pipeline. This is explicitly NOT
 * routed through the agent loop — it's a plain data fetch + local
 * notification schedule, per the user's request ("no need to connect ai for
 * that"). It shares timeGrid.ts's slot resolution with the get_academia_status
 * tool, but runs independently on app boot.
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

export interface CachedSchedule {
  date: string; // "YYYY-MM-DD", device-local
  dayOrder: number | null;
  isHoliday: boolean;
  classes: CachedClassEntry[];
}

const CACHE_KEY = "academia_today_schedule_cache";

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

  const attendanceByTitle = new Map<string, number>();
  for (const c of Object.values(data.attendanceByCourse)) {
    if (typeof c.attendance_percentage === "number") {
      attendanceByTitle.set(c.course_title.trim().toLowerCase(), c.attendance_percentage);
    }
  }

  const classes: CachedClassEntry[] = [];
  if (typeof data.dayOrder === "number") {
    for (const c of data.courses) {
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

  const cache: CachedSchedule = { date: today, dayOrder: data.dayOrder, isHoliday: data.isHoliday, classes };
  await store.setPreference(CACHE_KEY, JSON.stringify(cache));
}

/** Reads today's cached class schedule, if any — no network call. Used by
 * the notification scheduler, which runs far more often than once a day. */
export async function getTodaysClassScheduleCache(store: DataStore, now: Date = new Date()): Promise<CachedSchedule | null> {
  const raw = await store.getPreference(CACHE_KEY);
  if (!raw) return null;
  try {
    const cached: CachedSchedule = JSON.parse(raw);
    return cached.date === localDateKey(now) ? cached : null;
  } catch {
    return null;
  }
}
