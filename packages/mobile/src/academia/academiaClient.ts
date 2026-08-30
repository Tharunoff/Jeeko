/**
 * Client for the deployed academia-scraper service (services/academia-scraper
 * in this repo, running at SCRAPER_BASE). Scrapes the user's own SRM Academia
 * portal using credentials they entered in Settings — sent directly to this
 * one deployed endpoint, never anywhere else.
 */
const SCRAPER_BASE = "https://jeeko.onrender.com";
// Render's free tier sleeps after ~15 min idle; the first request after that
// can take 30-60s to cold-start. Long timeout so that reads as "slow" rather
// than "failed."
const FETCH_TIMEOUT_MS = 70000;

export interface AcademiaCourse {
  course_code: string;
  course_title: string;
  credit: number;
  category: string;
  course_type: string;
  faculty_name: string;
  slot: string;
  room_no: string;
}

export interface AcademiaAttendanceCourse {
  course_title: string;
  category: string;
  faculty_name: string;
  slot: string;
  room_no: string;
  hours_conducted: number;
  hours_absent: number;
  attendance_percentage: number;
}

export interface AcademiaData {
  dayOrder: number | null;
  overallAttendance: number | null;
  attendanceByCourse: Record<string, AcademiaAttendanceCourse>;
  courses: AcademiaCourse[];
  sessionData: unknown;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Scrapes fresh attendance + timetable data. Reuses `cachedSessionData` if
 * given (much faster — skips a full login) and the scraper falls back to a
 * fresh login server-side if that session turns out to be expired. Returns
 * null on any failure — callers should tell the user to check their portal
 * credentials in Settings rather than silently failing.
 */
export async function fetchAcademiaData(email: string, password: string, cachedSessionData?: unknown): Promise<AcademiaData | null> {
  if (!email || !password) return null;

  try {
    const response = await fetchWithTimeout(`${SCRAPER_BASE}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, session_data: cachedSessionData ?? undefined })
    });

    if (!response.ok) {
      console.warn("Academia scrape failed:", response.status, await response.text().catch(() => ""));
      return null;
    }

    const data = await response.json();
    if (data.status !== "success") return null;

    const attendance = data.attendance ?? {};
    const timetable = data.timetable ?? {};

    return {
      dayOrder: typeof attendance.day_order === "number" ? attendance.day_order : null,
      overallAttendance:
        typeof attendance.attendance?.overall_attendance === "number" ? attendance.attendance.overall_attendance : null,
      attendanceByCourse: attendance.attendance?.courses ?? {},
      courses: timetable.courses ?? [],
      sessionData: data.session_data
    };
  } catch (err) {
    console.warn("Academia scrape error:", err);
    return null;
  }
}
