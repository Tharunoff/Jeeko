/**
 * Student Portal (sp.srmist.edu.in) login + attendance/marks scraping, run
 * DIRECTLY FROM THE DEVICE rather than through our scraper service.
 *
 * Why on-device: every server-side attempt failed identically — a
 * hand-built anti-bot payload, a real headless Chromium (Playwright), and
 * plain HTTP with a human-read CAPTCHA all got the same silent bounce back
 * to a fresh login page. A genuine browser should have defeated
 * fingerprint-based detection, so the remaining suspect is the one thing
 * never varied: the request's origin IP. The portal sits behind an F5
 * BIG-IP WAF (its session cookie is named TS<hex>), and those commonly
 * distrust cloud/datacenter ranges outright. Requests from here come from
 * the student's own phone network instead.
 *
 * React Native's fetch isn't subject to CORS (that's a browser sandbox
 * mechanism) and its native HTTP stack keeps a shared cookie jar across
 * calls, so this can hold a session the same way requests.Session did.
 */

const BASE_URL = "https://sp.srmist.edu.in/srmiststudentportal";
const LOGIN_PAGE_URL = `${BASE_URL}/students/loginManager/youLogin.jsp`;
const LOGIN_ACTION_URL = `${BASE_URL}/LoginServlet`;
const DASHBOARD_URL = `${BASE_URL}/students/template/HRDSystem.jsp`;
const ATTENDANCE_URL = `${BASE_URL}/students/report/studentAttendanceDetails.jsp`;
const MARKS_URL = `${BASE_URL}/students/report/studentInternalMarkDetails.jsp`;

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36";

const REQUEST_TIMEOUT_MS = 20000;

export interface StudentPortalCourseAttendance {
  courseCode: string;
  courseTitle: string;
  category: string;
  facultyName: string;
  slot: string;
  hoursConducted: number;
  hoursAbsent: number;
  attendancePercentage: number;
}

export interface StudentPortalMarkComponent {
  testName: string;
  marksObtained: number | null;
  maxMarks: number | null;
  rawText: string;
}

export interface StudentPortalMarkCourse {
  courseCode: string;
  courseTitle: string;
  components: StudentPortalMarkComponent[];
}

export interface StudentPortalResult {
  studentInfo: { regNo: string; name: string };
  attendance: {
    courses: StudentPortalCourseAttendance[];
    overallAttendance: number;
    totalHoursConducted: number;
    totalHoursAbsent: number;
  };
  marks: { courses: StudentPortalMarkCourse[] };
}

export interface DirectCaptchaChallenge {
  /** data: URI, ready to hand straight to <Image source={{ uri }} /> */
  captchaImageUri: string;
}

export type DirectLoginStartResult = { success: true; challenge: DirectCaptchaChallenge } | { success: false; message: string };

export type DirectLoginSubmitResult =
  | { success: true; data: StudentPortalResult }
  | { success: false; message: string; wrongCaptcha?: boolean; locked?: boolean };

/**
 * Explicit cookie jar. React Native's native HTTP stacks usually persist
 * cookies across fetch calls on their own, but "usually" isn't good enough
 * here: if they don't, the login POST arrives with no session, the captcha
 * token is orphaned, and the failure is indistinguishable from the portal
 * rejecting us — which is exactly the ambiguity that made the first
 * on-device attempt uninterpretable. Tracking them by hand removes the
 * platform from the equation.
 */
let cookieJar: Record<string, string> = {};

function resetCookies() {
  cookieJar = {};
}

function captureCookies(response: Response) {
  // RN exposes Set-Cookie (no CORS sandbox to hide it); multiple cookies
  // arrive comma-joined, so split on commas that begin a new `name=` pair.
  const raw = response.headers.get("set-cookie");
  if (!raw) return;
  for (const piece of raw.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
    const [pair] = piece.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    cookieJar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

function cookieHeader(): string {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export function debugCookieNames(): string[] {
  return Object.keys(cookieJar);
}

/** Tagged so it can be isolated in logcat:
 *  adb logcat | grep "\[SP\]" */
function log(...parts: unknown[]) {
  console.log("[SP]", ...parts);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const cookies = cookieHeader();
  try {
    log(`→ ${init.method ?? "GET"} ${url} | sending cookies: ${cookies || "(none)"}`);
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(cookies ? { Cookie: cookies } : {}),
        ...(init.headers ?? {})
      }
    });
    captureCookies(response);
    log(`← ${response.status} ${url} | set-cookie: ${response.headers.get("set-cookie") ?? "(none)"} | jar now: ${Object.keys(cookieJar).join(",") || "(empty)"}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Resolves a relative href against a base URL. Hand-rolled rather than
 * using `new URL(relative, base)` — React Native's URL implementation is
 * incomplete and throws on relative resolution. */
function resolveUrl(base: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;

  const origin = base.match(/^(https?:\/\/[^/]+)/i)?.[1] ?? "";
  if (href.startsWith("/")) return origin + href;

  const segments = base.replace(/^https?:\/\/[^/]+/i, "").split("/").slice(0, -1);
  for (const part of href.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return `${origin}/${segments.filter(Boolean).join("/")}`;
}

async function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read captcha image"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/**
 * The portal answers some navigations with a "Please wait login screen is
 * loading..." page whose only content is an onload script that auto-submits
 * an empty form. A browser runs that instantly; fetch never will, so follow
 * it by hand or we stop one hop short of the real destination.
 */
async function followLoaderChain(response: Response, html: string, maxHops = 4): Promise<{ response: Response; html: string }> {
  let currentHtml = html;
  let currentUrl = response.url || DASHBOARD_URL;
  let currentResponse = response;

  for (let hop = 0; hop < maxHops; hop++) {
    const lower = currentHtml.toLowerCase();
    if (!lower.includes("please wait") || !lower.includes("callme")) break;

    const match = currentHtml.match(/\.action\s*=\s*"([^"]+)"/) ?? currentHtml.match(/action\s*=\s*"([^"]+)"/);
    if (!match) break;

    const nextUrl = resolveUrl(currentUrl, match[1]);
    currentResponse = await fetchWithTimeout(nextUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: currentUrl }
    });
    currentHtml = await currentResponse.text();
    currentUrl = currentResponse.url || nextUrl;
  }

  return { response: currentResponse, html: currentHtml };
}

/**
 * Loads the login page and fetches the real CAPTCHA image for the user to
 * read. Leaves the session cookies in the device's shared cookie jar so
 * submitDirectLogin() continues the same session.
 */
export async function startDirectLogin(): Promise<DirectLoginStartResult> {
  try {
    resetCookies();
    const pageRes = await fetchWithTimeout(LOGIN_PAGE_URL);
    const pageHtml = await pageRes.text();

    const tokenMatch = pageHtml.match(/SCaptchaServlet\?ts=.*?token=([a-z0-9-]+)/i);
    if (!tokenMatch) {
      return { success: false, message: "Couldn't find the captcha on the portal's login page." };
    }

    const captchaUrl = `${BASE_URL}/SCaptchaServlet?ts=${Date.now()}&token=${tokenMatch[1]}`;
    const captchaRes = await fetchWithTimeout(captchaUrl, { headers: { Referer: LOGIN_PAGE_URL } });

    const contentType = captchaRes.headers.get("Content-Type") ?? "";
    if (!contentType.includes("image")) {
      return { success: false, message: "The portal didn't return a captcha image. Try again shortly." };
    }

    const captchaImageUri = await blobToDataUri(await captchaRes.blob());
    return { success: true, challenge: { captchaImageUri } };
  } catch (err) {
    console.warn("Direct student portal login/start failed:", err);
    return { success: false, message: "Couldn't reach the SRM Student Portal. Check your connection and try again." };
  }
}

/**
 * Completes the login with the captcha the user typed, then pulls
 * attendance and internal marks off the authenticated session.
 */
export async function submitDirectLogin(netid: string, password: string, captchaText: string): Promise<DirectLoginSubmitResult> {
  try {
    const loginRes = await fetchWithTimeout(LOGIN_ACTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: LOGIN_PAGE_URL },
      body: formBody({
        username: netid.split("@")[0].trim(),
        password,
        captcha: captchaText.trim(),
        // The portal doesn't actually validate these — confirmed against a
        // working reference implementation that sends them empty too.
        fpPayload: "",
        fpToken: "",
        recaptchaToken: ""
      })
    });
    const loginHtml = await loginRes.text();
    const loginLower = loginHtml.toLowerCase();
    log(`login POST body (${loginHtml.length}b), first 600:`, loginHtml.slice(0, 600));

    if (loginLower.includes("temporarily locked")) {
      return {
        success: false,
        locked: true,
        message: "Your NetID is temporarily locked from too many attempts. Try again in about 5 minutes."
      };
    }
    if (loginLower.includes("invalid captcha")) {
      return { success: false, wrongCaptcha: true, message: "Incorrect captcha — please try again." };
    }

    // Mirror the portal's own post-login client-side redirect.
    await fetchWithTimeout(LOGIN_PAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: loginRes.url || LOGIN_ACTION_URL }
    });

    const dashRes = await fetchWithTimeout(DASHBOARD_URL, { headers: { Referer: LOGIN_PAGE_URL } });
    const dashRaw = await dashRes.text();
    const sawLoader = dashRaw.toLowerCase().includes("please wait");
    log(`dashboard body (${dashRaw.length}b) loader=${sawLoader}, first 600:`, dashRaw.slice(0, 600));
    const { html: dashHtml } = await followLoaderChain(dashRes, dashRaw);
    log(`after loader chain (${dashHtml.length}b), first 600:`, dashHtml.slice(0, 600));
    log(`has 'logout'? ${dashHtml.toLowerCase().includes("logout")}`);

    if (!dashHtml.toLowerCase().includes("logout")) {
      // Which of these shows up says *where* it broke: no cookies at all
      // means the platform dropped the session (our problem); cookies
      // present but still bounced to a login page means the portal
      // rejected us (their WAF).
      const cookies = debugCookieNames();
      const landedOn = dashHtml.toLowerCase().includes("secure_config")
        ? "login-page"
        : sawLoader
          ? "loader-only"
          : "unknown";
      return {
        success: false,
        wrongCaptcha: true,
        message:
          "Login didn't go through — double-check the captcha, or your NetID/password in Settings.\n\n" +
          `[diag] cookies=${cookies.length ? cookies.join(",") : "NONE"} · login-resp=${loginHtml.length}b · ` +
          `loader=${sawLoader ? "yes" : "no"} · landed=${landedOn}`
      };
    }

    return { success: true, data: await fetchAttendanceAndMarks(dashHtml) };
  } catch (err) {
    console.warn("Direct student portal login/submit failed:", err);
    return { success: false, message: "Couldn't reach the SRM Student Portal. Check your connection and try again." };
  }
}

async function fetchAttendanceAndMarks(dashHtml: string): Promise<StudentPortalResult> {
  const csrfSalt = dashHtml.match(/id="csrfPreventionSalt"[^>]*value="([^"]*)"/)?.[1] ?? "";
  const hdnForm = dashHtml.match(/id="hdnFormDetails"[^>]*value="([^"]*)"/)?.[1] ?? "1";

  const subtitles = [...dashHtml.matchAll(/class="sidenav-footer-subtitle"[^>]*>([\s\S]*?)</g)].map((m) => stripTags(m[1]));

  const fetchReport = async (url: string, iden: string): Promise<string[][][]> => {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Referer: DASHBOARD_URL
      },
      body: formBody({ filter: "", hdnFormDetails: hdnForm, csrfPreventionSalt: csrfSalt, iden })
    });
    return parseHtmlTables(await res.text());
  };

  const [attendanceTables, marksTables] = await Promise.all([
    fetchReport(ATTENDANCE_URL, "9").catch(() => [] as string[][][]),
    fetchReport(MARKS_URL, "13").catch(() => [] as string[][][])
  ]);

  return {
    studentInfo: { regNo: subtitles[0] ?? "Unknown", name: subtitles[1] ?? "Unknown" },
    attendance: parseAttendance(attendanceTables),
    marks: { courses: parseMarks(marksTables) }
  };
}

function stripTags(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlTables(html: string): string[][][] {
  const tables: string[][][] = [];
  for (const tableMatch of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows: string[][] = [];
    for (const rowMatch of tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]));
      if (cells.length) rows.push(cells);
    }
    if (rows.length) tables.push(rows);
  }
  return tables;
}

function findColumn(header: string[], ...needles: string[]): number {
  return header.findIndex((h) => needles.some((n) => h.includes(n)));
}

function toInt(value: string | undefined): number {
  const digits = (value ?? "").replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function parseAttendance(tables: string[][][]): StudentPortalResult["attendance"] {
  const courses: StudentPortalCourseAttendance[] = [];
  let totalConducted = 0;
  let totalAbsent = 0;

  for (const table of tables) {
    if (table.length < 2) continue;
    const header = table[0].map((c) => c.toLowerCase());
    const hasCourse = header.some((c) => c.includes("course") || c.includes("code"));
    const hasHours = header.some((c) => c.includes("hour") || c.includes("conduct") || c.includes("attend"));
    if (!hasCourse || !hasHours) continue;

    const codeIdx = Math.max(0, findColumn(header, "code"));
    const titleIdx = findColumn(header, "title", "desc", "name");
    const typeIdx = findColumn(header, "type", "category");
    const facultyIdx = findColumn(header, "faculty", "staff");
    const slotIdx = findColumn(header, "slot");
    const conductedIdx = findColumn(header, "conduct", "total");
    const absentIdx = findColumn(header, "absent");
    const pctIdx = findColumn(header, "%", "percent", "att");

    for (const row of table.slice(1)) {
      const courseCode = row[codeIdx];
      if (!courseCode || courseCode.toLowerCase().startsWith("total")) continue;

      const conducted = conductedIdx >= 0 ? toInt(row[conductedIdx]) : 0;
      const absent = absentIdx >= 0 ? toInt(row[absentIdx]) : 0;

      let percentage = 0;
      const rawPct = pctIdx >= 0 ? row[pctIdx]?.match(/(\d+(?:\.\d+)?)/) : null;
      if (rawPct) percentage = parseFloat(rawPct[1]);
      else if (conducted > 0) percentage = Math.round(((conducted - absent) / conducted) * 10000) / 100;

      totalConducted += conducted;
      totalAbsent += absent;

      courses.push({
        courseCode,
        courseTitle: (titleIdx >= 0 ? row[titleIdx] : "") ?? "",
        category: (typeIdx >= 0 ? row[typeIdx] : "") ?? "",
        facultyName: (facultyIdx >= 0 ? row[facultyIdx] : "") ?? "",
        slot: (slotIdx >= 0 ? row[slotIdx] : "") ?? "",
        hoursConducted: conducted,
        hoursAbsent: absent,
        attendancePercentage: percentage
      });
    }
  }

  return {
    courses,
    overallAttendance: totalConducted > 0 ? Math.round(((totalConducted - totalAbsent) / totalConducted) * 10000) / 100 : 0,
    totalHoursConducted: totalConducted,
    totalHoursAbsent: totalAbsent
  };
}

function parseMarks(tables: string[][][]): StudentPortalMarkCourse[] {
  const courses: StudentPortalMarkCourse[] = [];

  for (const table of tables) {
    if (table.length < 2) continue;
    const header = table[0].map((c) => c.toLowerCase());
    const hasCourse = header.some((c) => c.includes("course") || c.includes("code") || c.includes("subject"));
    const hasMarks = header.some((c) => c.includes("mark") || c.includes("test") || c.includes("score"));
    if (!hasCourse && !hasMarks) continue;

    const codeIdx = Math.max(0, findColumn(header, "code"));
    const titleIdx = findColumn(header, "title", "desc", "name");

    for (const row of table.slice(1)) {
      const courseCode = row[codeIdx];
      if (!courseCode || courseCode.toLowerCase().startsWith("total")) continue;

      const components: StudentPortalMarkComponent[] = [];
      for (let i = Math.max(codeIdx, titleIdx) + 1; i < row.length; i++) {
        const rawText = row[i];
        if (!rawText?.trim()) continue;
        const match = rawText.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?/);
        components.push({
          testName: table[0][i] ?? `Test ${i}`,
          marksObtained: match ? parseFloat(match[1]) : null,
          maxMarks: match?.[2] ? parseFloat(match[2]) : null,
          rawText
        });
      }

      courses.push({
        courseCode,
        courseTitle: (titleIdx >= 0 ? row[titleIdx] : "") ?? "",
        components
      });
    }
  }

  return courses;
}
