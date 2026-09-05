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

const PORTAL_HOST = "sp.srmist.edu.in";

/**
 * Values the login page hands its own JS, which that JS then folds into the
 * submitted form. Deobfuscated out of guardlogin.js / secure2.js: the field
 * *names* are randomised per page load, so they have to be read from the
 * page rather than hardcoded.
 */
interface PageContext {
  nonce: string;
  domainFieldName: string;
  captchaFieldName: string;
  randomDelimiter: string;
  /** The captcha answer, sitting in the login page's own SECURE_CONFIG. If
   * this equals the rendered image, the captcha is theatre and the real gate
   * is the trap fields — and we can drop the human-read step entirely. */
  captchaText: string | null;
  loadTime: number;
}

let pageContext: PageContext | null = null;

function parsePageContext(html: string): PageContext | null {
  const nonce = html.match(/nonce:\s*'([^']+)'/)?.[1];
  const domainFieldName = html.match(/SECURE_CONFIG\.domainFieldName\s*=\s*'([^']+)'/)?.[1];
  const captchaFieldName = html.match(/SECURE_CONFIG\.captchaFieldName\s*=\s*'([^']+)'/)?.[1];
  const randomDelimiter = html.match(/SECURE_CONFIG\.randomDelimiter\s*=\s*'([^']+)'/)?.[1];
  const captchaText = html.match(/SECURE_CONFIG\.captchaText\s*=\s*'([^']+)'/)?.[1] ?? null;
  if (!nonce || !domainFieldName || !captchaFieldName || !randomDelimiter) return null;
  return { nonce, domainFieldName, captchaFieldName, randomDelimiter, captchaText, loadTime: Date.now() };
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** btoa() over UTF-8 bytes. React Native has no dependable global btoa, and
 * the portal's own safeBase64Encode base64s the UTF-8 bytes, so this matches
 * it exactly. */
function base64Encode(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }

  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** The fingerprint blob secure2.js posts as `telemetryPayload`. Mirrors its
 * field set; `webdriver: false` is the honest answer here — this is a real
 * user's phone, not an automation harness. */
function buildTelemetryPayload(ctx: PageContext, captchaLength: number): string {
  const now = Date.now();
  const timeOnPage = now - ctx.loadTime;
  return base64Encode(
    JSON.stringify({
      startTime: ctx.loadTime,
      currentDomain: PORTAL_HOST,
      timezoneOffset: new Date().getTimezoneOffset(),
      screenWidth: 412,
      screenHeight: 915,
      colorDepth: 24,
      devicePixelRatio: 2.6,
      platform: "Linux armv8l",
      userAgent: USER_AGENT,
      language: "en-US",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      touchSupport: true,
      webdriver: false,
      mouseClicks: 2,
      mouseMovements: 0,
      keystrokeCount: captchaLength,
      typingSpeedMs: Math.max(1200, captchaLength * 260),
      canvasHash: "1f9a3c7e",
      submitTime: now,
      timeOnPageMs: timeOnPage
    })
  );
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

/** Surfaces whatever the portal is actually saying back to us. It answers a
 * rejected login with the login page plus a rendered message, and we've been
 * guessing at that message's wording — so pull every plausible carrier of it
 * rather than testing for one phrase at a time. */
function logMessageRegions(html: string) {
  const keywords = /(invalid|incorrect|wrong|error|failed|attempt|locked|expire|captcha|denied|alert)/gi;
  const seen = new Set<string>();
  for (const match of html.matchAll(keywords)) {
    const idx = match.index ?? 0;
    const snippet = html.slice(Math.max(0, idx - 180), idx + 180).replace(/\s+/g, " ");
    if (seen.has(snippet)) continue;
    seen.add(snippet);
    log(`msg-region [${match[0]}]:`, snippet);
    if (seen.size >= 12) break;
  }
  log("tail 900:", html.slice(-900).replace(/\s+/g, " "));
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

    pageContext = parsePageContext(pageHtml);
    if (!pageContext) {
      log("WARNING: could not parse SECURE_CONFIG from login page");
    } else {
      log(`page context: domainField=${pageContext.domainFieldName} captchaField=${pageContext.captchaFieldName} delim=${pageContext.randomDelimiter} captchaText=${pageContext.captchaText}`);
    }

    const captchaUrl = `${BASE_URL}/SCaptchaServlet?ts=${Date.now()}&token=${tokenMatch[1]}`;
    // The page's own JS fetches this image over XHR with an X-Domain-Proof
    // header; requesting it bare is not the same request the server expects
    // to bind the captcha answer to.
    const captchaRes = await fetchWithTimeout(captchaUrl, {
      headers: {
        Referer: LOGIN_PAGE_URL,
        Accept: "image/png, image/jpeg, image/svg+xml, image/*",
        ...(pageContext ? { "X-Domain-Proof": base64Encode(`${pageContext.nonce}:${PORTAL_HOST}`) } : {})
      }
    });

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
/**
 * Assembles exactly what the login page's own JS submits. Beyond the visible
 * fields, guardlogin.js appends two hidden inputs on submit whose *names* come
 * from SECURE_CONFIG (randomised per load) — a base64'd reversed hostname, and
 * a base64'd "<seconds on page><delimiter><interaction count>" that its own
 * source calls trapPayload. Omitting them, as we did until now, means failing
 * a bot check rather than failing authentication.
 */
function buildLoginFields(netid: string, password: string, captchaText: string): Record<string, string> {
  const typed = captchaText.trim();
  // Decisive, zero-guess diagnostic: does the answer the user read off the
  // image match the captchaText the page already handed us? If yes, the
  // captcha is not our blocker; if no, captchaText is a decoy and image OCR
  // is genuinely required.
  const fromPage = pageContext?.captchaText ?? "(none)";
  log(`captcha check: typed='${typed}' pageCaptchaText='${fromPage}' match=${typed.toLowerCase() === fromPage.toLowerCase()}`);

  const captcha = typed;
  const fields: Record<string, string> = {
    username: netid.split("@")[0].trim(),
    password,
    captcha,
    fpPayload: "",
    fpToken: "",
    recaptchaToken: ""
  };

  if (!pageContext) return fields;

  const reversedHost = PORTAL_HOST.split("").reverse().join("");
  fields[pageContext.domainFieldName] = base64Encode(reversedHost);

  const secondsOnPage = Math.floor((Date.now() - pageContext.loadTime) / 1000);
  // Reading and typing a captcha produces real interaction events on a phone;
  // zero here would itself look like a bot.
  const interactCount = captcha.length + 4;
  fields[pageContext.captchaFieldName] = base64Encode(`${secondsOnPage}${pageContext.randomDelimiter}${interactCount}`);
  fields.telemetryPayload = buildTelemetryPayload(pageContext, captcha.length);

  log(`trap fields: ${pageContext.domainFieldName}=${fields[pageContext.domainFieldName]} ${pageContext.captchaFieldName}=${fields[pageContext.captchaFieldName]} (${secondsOnPage}s, ${interactCount} interactions)`);
  return fields;
}

export async function submitDirectLogin(netid: string, password: string, captchaText: string): Promise<DirectLoginSubmitResult> {
  try {
    const loginRes = await fetchWithTimeout(LOGIN_ACTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: LOGIN_PAGE_URL },
      body: formBody(buildLoginFields(netid, password, captchaText))
    });
    const loginHtml = await loginRes.text();
    const loginLower = loginHtml.toLowerCase();
    log(`login POST body (${loginHtml.length}b), first 600:`, loginHtml.slice(0, 600));
    // The login response runs ~700b longer than a plain login page, which
    // should be a rendered error the keyword checks below aren't matching.
    // Dump anything that looks like a message so we can see its real wording.
    logMessageRegions(loginHtml);

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
