import type { DataStore } from "@personalos/core";

/**
 * Local-only cancellation state for academia courses — the portal has no
 * concept of "cancelled today" or "dropped this subject," so this app
 * tracks it itself and filters it out of the schedule cache, calendar
 * sync, and notifications wherever they're built.
 */
export interface CourseOverrides {
  /** Course codes cancelled just for one date ("YYYY-MM-DD"). */
  cancelledToday: Array<{ date: string; courseCode: string }>;
  /** Course codes cancelled indefinitely (dropped the subject). */
  cancelledPermanently: string[];
}

const KEY = "academia_course_overrides";

export async function getCourseOverrides(store: DataStore, today: string): Promise<CourseOverrides> {
  const raw = await store.getPreference(KEY);
  let parsed: CourseOverrides = { cancelledToday: [], cancelledPermanently: [] };
  if (raw) {
    try {
      const p = JSON.parse(raw);
      parsed = {
        cancelledToday: Array.isArray(p.cancelledToday) ? p.cancelledToday : [],
        cancelledPermanently: Array.isArray(p.cancelledPermanently) ? p.cancelledPermanently : []
      };
    } catch {
      // corrupt — start fresh
    }
  }
  // Prune stale "today" entries from previous days so this list doesn't
  // grow forever and doesn't accidentally suppress a class on a later day.
  const pruned = parsed.cancelledToday.filter((c) => c.date === today);
  if (pruned.length !== parsed.cancelledToday.length) {
    parsed = { ...parsed, cancelledToday: pruned };
    await store.setPreference(KEY, JSON.stringify(parsed)).catch(() => {});
  }
  return parsed;
}

async function save(store: DataStore, overrides: CourseOverrides): Promise<void> {
  await store.setPreference(KEY, JSON.stringify(overrides));
}

export async function cancelClassToday(store: DataStore, today: string, courseCode: string): Promise<void> {
  const overrides = await getCourseOverrides(store, today);
  if (!overrides.cancelledToday.some((c) => c.date === today && c.courseCode === courseCode)) {
    overrides.cancelledToday.push({ date: today, courseCode });
  }
  await save(store, overrides);
}

export async function cancelCoursePermanently(store: DataStore, today: string, courseCode: string): Promise<void> {
  const overrides = await getCourseOverrides(store, today);
  if (!overrides.cancelledPermanently.includes(courseCode)) {
    overrides.cancelledPermanently.push(courseCode);
  }
  await save(store, overrides);
}

export function isCancelled(overrides: CourseOverrides, today: string, courseCode: string): boolean {
  if (overrides.cancelledPermanently.includes(courseCode)) return true;
  return overrides.cancelledToday.some((c) => c.date === today && c.courseCode === courseCode);
}

/** Resolves free-text ("DBMS", "discrete maths", "21MAB302T") against a
 * list of known courses. Prefers an exact code match, then exact title
 * match, then a substring match on the title (case-insensitive throughout).
 * Returns null if nothing matches. */
export function resolveCourse<T extends { course_code: string; course_title: string }>(
  query: string,
  courses: T[]
): T | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byCode = courses.find((c) => c.course_code.toLowerCase() === q);
  if (byCode) return byCode;
  const byExactTitle = courses.find((c) => c.course_title.toLowerCase() === q);
  if (byExactTitle) return byExactTitle;
  const bySubstring = courses.find(
    (c) => c.course_title.toLowerCase().includes(q) || q.includes(c.course_title.toLowerCase())
  );
  return bySubstring ?? null;
}
