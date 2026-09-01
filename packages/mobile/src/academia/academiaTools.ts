import type { DataStore } from "@personalos/core";
import type { ExternalTool } from "@personalos/core";
import { fetchAndSaveSnapshot, getTodaysClassScheduleCache, getCachedSnapshotRaw, type CachedSchedule } from "./classReminders";

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Shared shape for the tool's response, whether it came from cache or a
 * fresh fetch — computes todaysSchedule/nextClass against the current clock
 * time from whatever CachedSchedule it's given. */
function respond(snapshot: CachedSchedule, source: "cache" | "live") {
  const currentTime = nowHHMM();
  const todaysSchedule = snapshot.classes;
  const nextClass = todaysSchedule.find((s) => s.from > currentTime) ?? null;

  return {
    dayOrder: snapshot.dayOrder,
    isHoliday: snapshot.isHoliday,
    isAttendanceAvailable: snapshot.isAttendanceAvailable,
    overallAttendancePercent: snapshot.overallAttendancePercent,
    currentTime,
    todaysSchedule,
    nextClass,
    courses: snapshot.allCourses,
    attendanceByCourse: snapshot.attendanceByCourse,
    dataSource: source,
    dataAsOf: snapshot.date,
    note:
      "todaysSchedule and nextClass are computed from a fixed SRM period-time grid and ARE real clock times — safe to state directly (e.g. 'your next class is Computer Networks at 1:25pm'). If todaysSchedule is empty but courses exist, a slot code couldn't be resolved — say you're not sure of the exact time rather than guessing. If dayOrder is null and isHoliday is true, today looks like a holiday/off day (word it as a guess, not certain) — no schedule can be computed. If dayOrder is null and isHoliday is false, say you couldn't determine today's day order right now. If isAttendanceAvailable is false, the portal's attendance page failed to load this time — never say attendance is 0% or state any number; tell the user it couldn't be fetched and to try again shortly. dataSource 'cache' means this is from earlier today, not a fresh check this second — mention that only if the user specifically asked for fresh/live/updated data (they'd have set forceRefresh, so you'd already be seeing 'live' in that case)."
  };
}

/**
 * Mobile-only tool exposing the academia scraper to Jeeko — not part of
 * core's ALL_TOOLS since it needs a network call core deliberately has no
 * access to (see agentLoop.ts's ExternalTool). Injected into runAgentLoop
 * from AppState.tsx's chat().
 *
 * Cache-first by design (see classReminders.ts): the live scraper is slow
 * (Render free-tier cold starts) and, per the user, a portal outage
 * shouldn't mean Jeeko can't answer at all when it already knew the answer
 * from this morning's refresh. Only forceRefresh:true (the user explicitly
 * asking for fresh/live/updated data) skips the cache.
 */
export function createAcademiaTools(store: DataStore): ExternalTool[] {
  const getAcademiaStatus: ExternalTool = {
    name: "get_academia_status",
    description:
      "Gets the user's SRM Academia data: registered courses, today's day order, today's real class schedule with clock times, the next upcoming class, and per-course + overall attendance percentage. Use when asked about classes, timetable, attendance, or 'when is my next class'. By default this reads a local cache refreshed once this morning (fast, works even if the portal/scraper is briefly down) — pass forceRefresh:true ONLY when the user explicitly asks for fresh/live/updated/current data (e.g. 'check my latest attendance', 'refresh my schedule'), which does a real live fetch and updates the cache.",
    parameters: {
      type: "object",
      properties: {
        forceRefresh: {
          type: "boolean",
          description: "True only if the user explicitly asked for fresh/live/updated data rather than what's already known."
        }
      }
    },
    handler: async (args: { forceRefresh?: boolean }) => {
      const now = new Date();

      if (!args.forceRefresh) {
        const cached = await getTodaysClassScheduleCache(store, now);
        if (cached) return respond(cached, "cache");
        // No cache yet today (e.g. the morning boot-refresh hasn't run or
        // failed) — fall through to a live fetch so the user still gets an
        // answer instead of an error just because caching hasn't caught up.
      }

      const result = await fetchAndSaveSnapshot(store, now);
      if ("error" in result) {
        // Live fetch failed — fall back to whatever's cached, even if it's
        // from a previous day, rather than a bare error.
        const stale = await getCachedSnapshotRaw(store);
        if (stale) return respond(stale, "cache");
        return { error: result.error };
      }
      return respond(result.snapshot, "live");
    }
  };

  return [getAcademiaStatus];
}
