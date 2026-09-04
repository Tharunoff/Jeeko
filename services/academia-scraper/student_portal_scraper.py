"""
Dedicated scraper for SRM Student Portal (sp.srmist.edu.in).
Scrapes strictly Attendance and Internal Marks — nothing else.
"""

import os
import re
import time
import json
import base64
import requests
from typing import Dict, Any, List, Optional
from bs4 import BeautifulSoup
from concurrent.futures import ThreadPoolExecutor

# Try to import Google GenAI for 100% case-accurate CAPTCHA solving
try:
    import google.genai as genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

# Fallback OCR
try:
    import ddddocr
    DDDDOCR_AVAILABLE = True
except ImportError:
    DDDDOCR_AVAILABLE = False


def _get_gemini_key() -> Optional[str]:
    """Retrieve Gemini API key from environment or .env.local"""
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    
    env_paths = [
        os.path.join(os.path.dirname(__file__), "..", "..", "packages", "mobile", ".env.local"),
        os.path.join(os.path.dirname(__file__), ".env"),
        os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
    ]
    for p in env_paths:
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line.startswith("#") or not line:
                            continue
                        if "GEMINI_API_KEY" in line and "=" in line:
                            val = line.split("=", 1)[1].strip().strip('"').strip("'")
                            if val.startswith("AIza"):
                                return val
            except Exception:
                pass
    return None


class StudentPortalScraper:
    """Scraper for SRMIST Student Portal (sp.srmist.edu.in)"""

    BASE_URL = "https://sp.srmist.edu.in/srmiststudentportal"
    LOGIN_PAGE_URL = f"{BASE_URL}/students/loginManager/youLogin.jsp"
    LOGIN_ACTION_URL = f"{BASE_URL}/LoginServlet"
    DASHBOARD_URL = f"{BASE_URL}/students/template/HRDSystem.jsp"

    ATTENDANCE_URL = f"{BASE_URL}/students/report/studentAttendanceDetails.jsp"
    MARKS_URL = f"{BASE_URL}/students/report/studentInternalMarkDetails.jsp"

    def __init__(self, netid: str, password: str, max_captcha_retries: int = 3):
        self.netid = netid.split("@")[0].strip()
        self.password = password
        self.max_captcha_retries = max_captcha_retries
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": self.LOGIN_PAGE_URL,
            "Origin": "https://sp.srmist.edu.in"
        })
        
        self.gemini_client = None
        gemini_key = _get_gemini_key()
        if GENAI_AVAILABLE and gemini_key:
            try:
                self.gemini_client = genai.Client(api_key=gemini_key)
            except Exception as e:
                print(f"[WARN] Failed to init Gemini client: {e}")

        self.ocr = ddddocr.DdddOcr(show_ad=False) if DDDDOCR_AVAILABLE else None

        self.csrf_salt = ""
        self.hdn_form = "1"
        self.student_info: Dict[str, str] = {}

    def _solve_captcha(self, image_bytes: bytes) -> str:
        if not image_bytes:
            return ""

        if self.gemini_client:
            try:
                response = self.gemini_client.models.generate_content(
                    # Same lite model the mobile app uses elsewhere — verified it
                    # accepts image input fine, and its free-tier daily quota is
                    # far more generous than gemini-3.6-flash's (confirmed via a
                    # real 429 body earlier: ~20 requests/day on that tier, which
                    # a single login's multiple CAPTCHA retries could burn through
                    # fast).
                    model="gemini-3.1-flash-lite",
                    contents=[
                        types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
                        "Read the exact 6 characters in this CAPTCHA image. Preserve exact case (uppercase/lowercase/numbers). Return ONLY the 6 characters, nothing else."
                    ]
                )
                code = re.sub(r"\s+", "", response.text)
                if len(code) == 6:
                    print(f"[CAPTCHA] Solved with Gemini: '{code}'")
                    return code
            except Exception as e:
                print(f"[WARN] Gemini CAPTCHA solving failed: {e}")

        if self.ocr:
            try:
                res = self.ocr.classification(image_bytes)
                code = res.strip() if res else ""
                print(f"[CAPTCHA] Solved with ddddocr (fallback): '{code}'")
                return code
            except Exception as e:
                print(f"[ERROR] ddddocr CAPTCHA error: {e}")

        return ""

    def login(self) -> Dict[str, Any]:
        """
        Logs in via a REAL headless Chromium browser (Playwright) instead of
        hand-reconstructing the portal's obfuscated anti-bot payload. That
        reconstruction (domain-proof header, telemetry JSON, canvas
        fingerprint, hidden trap fields, even a correctly-read CAPTCHA)
        consistently failed silently — confirmed by deobfuscating the
        portal's own JS: it has real, actively-maintained bot detection
        (canvas fingerprinting, mouse/keystroke tracking, a field literally
        named 'trapPayload'), the kind that commonly also gates on IP
        reputation independent of payload correctness. A real browser lets
        all of that run genuinely instead of being guessed at — the portal's
        own JS computes its own hidden fields when we submit the real form.
        """
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True, args=["--disable-blink-features=AutomationControlled"])
            try:
                context = browser.new_context(
                    viewport={"width": 1366, "height": 768},
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                )
                page = context.new_page()

                for attempt in range(1, self.max_captcha_retries + 1):
                    print(f"[LOGIN] Playwright attempt {attempt}/{self.max_captcha_retries} for NetID: {self.netid}")

                    try:
                        page.goto(self.LOGIN_PAGE_URL, wait_until="networkidle", timeout=20000)
                    except Exception as e:
                        print(f"[ERROR] Failed to load login page: {e}")
                        continue

                    # The page's own JS fetches the real captcha image via an
                    # authenticated XHR after DOMContentLoaded and swaps it in
                    # as a blob: URL — wait for that to actually happen rather
                    # than screenshotting a placeholder.
                    try:
                        page.wait_for_function(
                            "document.getElementById('secure_captcha') && "
                            "document.getElementById('secure_captcha').src.startsWith('blob:')",
                            timeout=10000
                        )
                    except Exception:
                        print("[WARN] Captcha image didn't load in time, retrying...")
                        continue

                    captcha_el = page.query_selector("#secure_captcha")
                    captcha_bytes = captcha_el.screenshot()
                    solved_captcha = self._solve_captcha(captcha_bytes)
                    if not solved_captcha or len(solved_captcha) < 4:
                        print("[WARN] Invalid captcha resolution, retrying...")
                        continue

                    page.fill("#username", self.netid)
                    page.fill("#password", self.password)
                    page.fill("#captcha", solved_captcha)

                    try:
                        with page.expect_navigation(wait_until="networkidle", timeout=20000):
                            # requestSubmit() (not a raw form.submit()) fires the
                            # real 'submit' event, which is what the portal's own
                            # guardlogin.js/secure2.js listen on to populate their
                            # hidden anti-bot fields with genuine values.
                            page.evaluate("document.getElementById('login_form').requestSubmit()")
                    except Exception as e:
                        print(f"[WARN] Navigation after submit didn't complete cleanly: {e}")

                    content = page.content()

                    if "temporarily locked" in content.lower():
                        msg = "Your user ID is temporarily locked due to multiple unsuccessful attempts. Please try again in 5 minutes."
                        print(f"[ERROR] {msg}")
                        return {"success": False, "message": msg, "locked": True}

                    if "invalid login credentials" in content.lower() or "attempts remaining" in content.lower():
                        attempts_match = re.search(r"(\d+\s+out\s+of\s+\d+\s+login\s+attempts\s+remaining)", content, re.I)
                        detail = f" ({attempts_match.group(1)})" if attempts_match else ""
                        msg = f"Invalid NetID or Password on SRM Student Portal{detail}."
                        print(f"[ERROR] {msg}")
                        return {"success": False, "message": msg, "invalid_credentials": True}

                    if "logout" in content.lower():
                        print("[LOGIN] Successfully authenticated into SRM Student Portal (Playwright)!")
                        # Hand the real, validly-obtained cookies to self.session
                        # so the rest of scrape() (attendance/marks fetch) can
                        # keep using plain `requests`, unchanged.
                        for c in context.cookies():
                            self.session.cookies.set(c["name"], c["value"], domain=c["domain"], path=c.get("path", "/"))
                        self._extract_dashboard_meta(content)
                        return {"success": True}

                    print(f"[WARN] Dashboard verification failed on Playwright attempt {attempt}.")
                    print(f"[DEBUG] page content (first 1000 chars): {content[:1000]}")
                    time.sleep(1)

                return {
                    "success": False,
                    "message": "Failed to log in to student portal. Please verify your credentials or try again later."
                }
            except Exception as e:
                print(f"[ERROR] Playwright login error: {e}")
                return {"success": False, "message": f"Browser automation error: {e}"}
            finally:
                browser.close()

    def _extract_dashboard_meta(self, dash_html: str):
        soup = BeautifulSoup(dash_html, "html.parser")
        subs = soup.find_all(class_="sidenav-footer-subtitle")
        self.student_info = {
            "reg_no": subs[0].get_text(strip=True) if len(subs) > 0 else "Unknown",
            "name": subs[1].get_text(strip=True) if len(subs) > 1 else "Unknown"
        }
        salt_tag = soup.find(id="csrfPreventionSalt")
        self.csrf_salt = salt_tag.get("value", "") if salt_tag else ""
        form_tag = soup.find(id="hdnFormDetails")
        self.hdn_form = form_tag.get("value", "1") if form_tag else "1"
        print(f"[META] Student: {self.student_info.get('name')} ({self.student_info.get('reg_no')})")

    @staticmethod
    def _parse_html_tables(html: str) -> List[List[List[str]]]:
        soup = BeautifulSoup(html, "html.parser")
        tables = soup.find_all("table")
        parsed_tables = []
        for table in tables:
            rows = []
            for tr in table.find_all("tr"):
                cols = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
                if cols:
                    rows.append(cols)
            if rows:
                parsed_tables.append(rows)
        return parsed_tables

    def _parse_attendance_data(self, raw_tables: List[List[List[str]]]) -> Dict[str, Any]:
        courses = []
        total_conducted = 0
        total_absent = 0

        for table in raw_tables:
            if not table or len(table) < 2:
                continue

            header = [c.lower() for c in table[0]]
            has_course = any("course" in c or "code" in c for c in header)
            has_hours = any("hour" in c or "conduct" in c or "attend" in c for c in header)

            if not (has_course and has_hours):
                continue

            code_idx = next((i for i, c in enumerate(header) if "code" in c), 0)
            title_idx = next((i for i, c in enumerate(header) if "title" in c or "desc" in c or "name" in c), 1)
            type_idx = next((i for i, c in enumerate(header) if "type" in c or "category" in c), -1)
            faculty_idx = next((i for i, c in enumerate(header) if "faculty" in c or "staff" in c), -1)
            slot_idx = next((i for i, c in enumerate(header) if "slot" in c), -1)
            conducted_idx = next((i for i, c in enumerate(header) if "conduct" in c or "total" in c), -1)
            absent_idx = next((i for i, c in enumerate(header) if "absent" in c), -1)
            pct_idx = next((i for i, c in enumerate(header) if "%" in c or "percent" in c or "att" in c), -1)

            for row in table[1:]:
                if len(row) <= max(code_idx, title_idx):
                    continue

                course_code = row[code_idx]
                if not course_code or course_code.lower().startswith("total"):
                    continue

                course_title = row[title_idx] if title_idx < len(row) else ""
                category = row[type_idx] if type_idx >= 0 and type_idx < len(row) else ""
                faculty = row[faculty_idx] if faculty_idx >= 0 and faculty_idx < len(row) else ""
                slot = row[slot_idx] if slot_idx >= 0 and slot_idx < len(row) else ""

                conducted = 0
                if conducted_idx >= 0 and conducted_idx < len(row):
                    digits = re.sub(r"[^\d]", "", row[conducted_idx])
                    conducted = int(digits) if digits else 0

                absent = 0
                if absent_idx >= 0 and absent_idx < len(row):
                    digits = re.sub(r"[^\d]", "", row[absent_idx])
                    absent = int(digits) if digits else 0

                pct = 0.0
                if pct_idx >= 0 and pct_idx < len(row):
                    pct_match = re.search(r"(\d+(?:\.\d+)?)", row[pct_idx])
                    pct = float(pct_match.group(1)) if pct_match else 0.0
                elif conducted > 0:
                    pct = round(((conducted - absent) / conducted) * 100, 2)

                total_conducted += conducted
                total_absent += absent

                courses.append({
                    "course_code": course_code,
                    "course_title": course_title,
                    "category": category,
                    "faculty_name": faculty,
                    "slot": slot,
                    "hours_conducted": conducted,
                    "hours_absent": absent,
                    "attendance_percentage": pct
                })

        overall_pct = (
            round(((total_conducted - total_absent) / total_conducted) * 100, 2)
            if total_conducted > 0 else 0.0
        )

        return {
            "courses": courses,
            "overall_attendance": overall_pct,
            "total_hours_conducted": total_conducted,
            "total_hours_absent": total_absent
        }

    def _parse_marks_data(self, raw_tables: List[List[List[str]]]) -> Dict[str, Any]:
        courses = []

        for table in raw_tables:
            if not table or len(table) < 2:
                continue

            header = [c.lower() for c in table[0]]
            has_course = any("course" in c or "code" in c or "subject" in c for c in header)
            has_marks = any("mark" in c or "test" in c or "score" in c for c in header)

            if not (has_course or has_marks):
                continue

            code_idx = next((i for i, c in enumerate(header) if "code" in c), 0)
            title_idx = next((i for i, c in enumerate(header) if "title" in c or "desc" in c or "name" in c), 1)

            for row in table[1:]:
                if len(row) <= code_idx:
                    continue

                course_code = row[code_idx]
                if not course_code or course_code.lower().startswith("total"):
                    continue

                course_title = row[title_idx] if title_idx < len(row) else ""
                components = []

                for col_idx in range(max(code_idx, title_idx) + 1, len(row)):
                    col_header = table[0][col_idx] if col_idx < len(table[0]) else f"Test {col_idx}"
                    col_val = row[col_idx]

                    match = re.search(r"(\d+(?:\.\d+)?)\s*(?:/\s*(\d+(?:\.\d+)?))?", col_val)
                    if match:
                        scored = float(match.group(1))
                        max_m = float(match.group(2)) if match.group(2) else None
                        components.append({
                            "test_name": col_header,
                            "marks_obtained": scored,
                            "max_marks": max_m,
                            "raw_text": col_val
                        })
                    elif col_val.strip():
                        components.append({
                            "test_name": col_header,
                            "marks_obtained": None,
                            "max_marks": None,
                            "raw_text": col_val
                        })

                courses.append({
                    "course_code": course_code,
                    "course_title": course_title,
                    "components": components
                })

        return {"courses": courses}

    def scrape(self) -> Dict[str, Any]:
        start_time = time.time()

        login_res = self.login()
        if not login_res.get("success"):
            return {
                "status": "error",
                "message": login_res.get("message", "Login failed"),
                "details": login_res
            }

        self.session.headers.update({
            "X-Requested-With": "XMLHttpRequest",
            "Referer": self.DASHBOARD_URL
        })

        base_payload = {
            "filter": "",
            "hdnFormDetails": str(self.hdn_form),
            "csrfPreventionSalt": self.csrf_salt
        }

        def fetch_endpoint(url: str, iden: str):
            payload = {**base_payload, "iden": iden}
            r = self.session.post(url, data=payload, timeout=15)
            r.raise_for_status()
            return self._parse_html_tables(r.text)

        print("[DATA] Fetching Attendance and Marks in parallel...")
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_att = executor.submit(fetch_endpoint, self.ATTENDANCE_URL, "9")
            future_marks = executor.submit(fetch_endpoint, self.MARKS_URL, "13")

            try:
                raw_attendance = future_att.result()
            except Exception as e:
                print(f"[ERROR] Attendance fetch failed: {e}")
                raw_attendance = []

            try:
                raw_marks = future_marks.result()
            except Exception as e:
                print(f"[ERROR] Marks fetch failed: {e}")
                raw_marks = []

        parsed_attendance = self._parse_attendance_data(raw_attendance)
        parsed_marks = self._parse_marks_data(raw_marks)

        elapsed = round(time.time() - start_time, 2)
        print(f"✓ [DATA] Completed in {elapsed}s: {len(parsed_attendance['courses'])} courses with attendance, {len(parsed_marks['courses'])} courses with marks.")

        return {
            "status": "success",
            "student_info": self.student_info,
            "attendance": parsed_attendance,
            "marks": parsed_marks,
            "raw_tables": {
                "attendance": raw_attendance,
                "internal_marks": raw_marks
            },
            "fetch_time_seconds": elapsed
        }


def scrape_student_attendance_and_marks(netid: str, password: str) -> Dict[str, Any]:
    scraper = StudentPortalScraper(netid, password)
    return scraper.scrape()


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 3:
        print("Usage: python student_portal_scraper.py <netid> <password>")
        sys.exit(1)

    u = sys.argv[1]
    p = sys.argv[2]
    res = scrape_student_attendance_and_marks(u, p)
    print("\n" + "=" * 60)
    print(json.dumps(res, indent=2))
