/**
 * Client for the deployed academia-scraper service (services/academia-scraper
 * in this repo, running at SCRAPER_BASE). Scrapes the user's own SRM Academia
 * portal using credentials they entered in Settings — sent directly to this
 * one deployed endpoint, never anywhere else.
 */
const SCRAPER_BASE = process.env.EXPO_PUBLIC_SCRAPER_URL || "https://jeeko.onrender.com";
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
  /** Best-effort guess from the portal page text when no day order is
   * shown — not confirmed accurate wording yet, treat as a hint. */
  isHoliday: boolean;
  /** True when the real /My_Attendance fetch failed server-side and the
   * scraper fell back to placeholder zeros derived from the timetable
   * (see services/academia-scraper/tools/fallback_mock_attendance_data.py).
   * When true, overallAttendance/attendanceByCourse below are already
   * nulled out — never surface stale/fake numbers as real. */
  isAttendanceMock: boolean;
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
    // is_mock defaults to true (not false) when absent — an older/unknown
    // response shape should never be trusted as real attendance by default.
    const isAttendanceMock = attendance.is_mock !== false;

    return {
      dayOrder: typeof attendance.day_order === "number" ? attendance.day_order : null,
      isHoliday: attendance.is_holiday === true,
      isAttendanceMock,
      overallAttendance:
        !isAttendanceMock && typeof attendance.attendance?.overall_attendance === "number"
          ? attendance.attendance.overall_attendance
          : null,
      attendanceByCourse: isAttendanceMock ? {} : (attendance.attendance?.courses ?? {}),
      courses: timetable.courses ?? [],
      sessionData: data.session_data
    };
  } catch (err) {
    console.warn("Academia scrape error:", err);
    return null;
  }
}

export interface StudentPortalAttendanceCourse {
  course_code: string;
  course_title: string;
  category: string;
  faculty_name: string;
  slot: string;
  hours_conducted: number;
  hours_absent: number;
  attendance_percentage: number;
}

export interface StudentPortalMarkComponent {
  test_name: string;
  marks_obtained: number | null;
  max_marks: number | null;
  raw_text: string;
}

export interface StudentPortalMarkCourse {
  course_code: string;
  course_title: string;
  components: StudentPortalMarkComponent[];
}

export interface StudentPortalData {
  status: string;
  student_info: {
    reg_no: string;
    name: string;
  };
  attendance: {
    courses: StudentPortalAttendanceCourse[];
    overall_attendance: number;
    total_hours_conducted: number;
    total_hours_absent: number;
  };
  marks: {
    courses: StudentPortalMarkCourse[];
  };
  fetch_time_seconds?: number;
}

/**
 * Scrapes live attendance and internal marks directly from sp.srmist.edu.in.
 */
export async function fetchStudentPortalData(netid: string, password: string): Promise<StudentPortalData | null> {
  if (!netid || !password) return null;

  try {
    const cleanNetId = netid.split("@")[0].trim();
    const response = await fetchWithTimeout(`${SCRAPER_BASE}/student_portal/attendance_and_marks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ netid: cleanNetId, password })
    });

    if (!response.ok) {
      console.warn("Student Portal scrape HTTP failed:", response.status);
      return null;
    }

    const data = await response.json();
    if (data.status !== "success") return null;
    return data;
  } catch (err) {
    console.warn("Student Portal scrape error:", err);
    return null;
  }
}

