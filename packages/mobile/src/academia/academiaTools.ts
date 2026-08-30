import type { DataStore } from "@personalos/core";
import type { ExternalTool } from "@personalos/core";
import { fetchAcademiaData } from "./academiaClient";

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
      "Gets the user's live SRM Academia data: registered courses, today's day order, and per-course + overall attendance percentage. Use when asked about classes, timetable, or attendance. Note: course slot codes (e.g. 'A1') are NOT mapped to clock times here — never state a specific time for a class from this tool's result alone.",
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

      return {
        dayOrder: data.dayOrder,
        isHoliday: data.isHoliday,
        overallAttendancePercent: data.overallAttendance,
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
          "Slot codes are not mapped to actual clock times in this app yet — tell the user which slot/day-order a class is in, but do not invent a specific time for it. If dayOrder is null and isHoliday is true, the portal shows no day order and looks like a holiday/off day — tell the user that (as a likely guess, not certain) rather than saying classes are on. If dayOrder is null and isHoliday is false, the portal just didn't report a day order right now — say you couldn't determine today's day order, don't guess one."
      };
    }
  };

  return [getAcademiaStatus];
}
