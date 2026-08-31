import type { DataStore } from "@personalos/core";
import type { ExternalTool } from "@personalos/core";
import { fetchAcademiaData } from "./academiaClient";
import { resolveSlotTimes } from "./timeGrid";

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Mobile-only tool exposing the academia scraper to Jeeko — not part of
 * core's ALL_TOOLS since it needs a network call core deliberately has no
 * access to (see agentLoop.ts's ExternalTool). Injected into runAgentLoop
 * from AppState.tsx's chat().
 */
export function createAcademiaTools(store: DataStore): ExternalTool[] {
  const getAcademiaStatus: ExternalTool = {
    name: "get_academia_status",
    description:
      "Gets the user's live SRM Academia data: registered courses, today's day order, and per-course + overall attendance percentage. Also computes today's actual class schedule (clock times) and the next upcoming class using the fixed SRM period-time grid. Use when asked about classes, timetable, attendance, or 'when is my next class'.",
    parameters: { type: "object", properties: {} },
    handler: async () => {
      const email = await store.getPreference("academia_email");
      const password = await store.getPreference("academia_password");
      if (!email || !password) {
        return { error: "Academia portal credentials aren't set up yet. Ask the user to add them in Settings → Academia Portal." };
      }

      const cachedRaw = await store.getPreference("academia_session");
      let cachedSession: unknown;
      try {
        cachedSession = cachedRaw ? JSON.parse(cachedRaw) : undefined;
      } catch {
        cachedSession = undefined;
      }

      const data = await fetchAcademiaData(email, password, cachedSession);
      if (!data) {
        return {
          error:
            "Couldn't reach the academia scraper or login failed. The server may be cold-starting (free tier, up to a minute after being idle) — worth trying again shortly. If it keeps failing, the portal credentials in Settings may be wrong."
        };
      }

      if (data.sessionData) {
        store.setPreference("academia_session", JSON.stringify(data.sessionData)).catch(() => {});
      }

      // Compute today's actual clock-time schedule from the fixed SRM
      // period grid (packages/mobile/src/academia/timeGrid.ts) — only
      // possible when we have a real numeric day order.
      let todaysSchedule: Array<{
        code: string;
        title: string;
        faculty: string;
        room: string;
        type: string;
        from: string;
        to: string;
      }> = [];
      if (typeof data.dayOrder === "number") {
        for (const c of data.courses) {
          const ranges = resolveSlotTimes(data.dayOrder, c.slot);
          for (const r of ranges) {
            todaysSchedule.push({
              code: c.course_code,
              title: c.course_title,
              faculty: c.faculty_name,
              room: c.room_no,
              type: c.course_type,
              from: r.from,
              to: r.to
            });
          }
        }
        todaysSchedule.sort((a, b) => a.from.localeCompare(b.from));
      }
      const currentTime = nowHHMM();
      const nextClass = todaysSchedule.find((s) => s.from > currentTime) ?? null;

      return {
        dayOrder: data.dayOrder,
        isHoliday: data.isHoliday,
        isAttendanceAvailable: !data.isAttendanceMock,
        overallAttendancePercent: data.overallAttendance,
        currentTime,
        todaysSchedule,
        nextClass,
        courses: data.courses.map((c) => ({
          code: c.course_code,
          title: c.course_title,
          slot: c.slot,
          faculty: c.faculty_name,
          room: c.room_no,
          type: c.course_type
        })),
        attendanceByCourse: Object.values(data.attendanceByCourse).map((c) => ({
          title: c.course_title,
          slot: c.slot,
          attendancePercent: c.attendance_percentage,
          hoursConducted: c.hours_conducted,
          hoursAbsent: c.hours_absent
        })),
        note:
          "todaysSchedule and nextClass are computed from a fixed SRM period-time grid and ARE real clock times — safe to state directly (e.g. 'your next class is Computer Networks at 1:25pm'). If todaysSchedule is empty but courses exist, a slot code couldn't be resolved — say you're not sure of the exact time rather than guessing. If dayOrder is null and isHoliday is true, today looks like a holiday/off day (word it as a guess, not certain) — no schedule can be computed. If dayOrder is null and isHoliday is false, say you couldn't determine today's day order right now. If isAttendanceAvailable is false, the portal's real attendance page failed to load this time — overallAttendancePercent/attendanceByCourse are empty/null on purpose, NEVER say attendance is 0% or state any attendance number; tell the user attendance couldn't be fetched right now and to try again shortly."
      };
    }
  };

  return [getAcademiaStatus];
}
