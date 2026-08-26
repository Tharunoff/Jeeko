import { DateTime } from "luxon";

/** Start/end of the given instant's calendar day, in the given IANA timezone, expressed as UTC JS Dates. */
export function localDayBounds(instant: Date, timezone: string): { startUtc: Date; endUtc: Date } {
  const local = DateTime.fromJSDate(instant, { zone: timezone });
  return {
    startUtc: local.startOf("day").toUTC().toJSDate(),
    endUtc: local.endOf("day").toUTC().toJSDate()
  };
}

/** "YYYY-MM-DD" for the given instant, in the given timezone. The one place "what day is it" gets decided. */
export function localDateKey(instant: Date, timezone: string): string {
  return DateTime.fromJSDate(instant, { zone: timezone }).toFormat("yyyy-LL-dd");
}

/** Parses "HH:mm" onto the calendar day of `referenceDate`, in `timezone`. */
export function parseLocalTimeOnDate(hhmm: string, referenceDate: Date, timezone: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const local = DateTime.fromJSDate(referenceDate, { zone: timezone }).set({
    hour: h,
    minute: m,
    second: 0,
    millisecond: 0
  });
  return local.toUTC().toJSDate();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

export interface Interval {
  start: Date;
  end: Date;
}

/** Merges overlapping/adjacent intervals, clipped to [windowStart, windowEnd]. Returns sorted, non-overlapping intervals. */
export function mergeIntervals(intervals: Interval[], windowStart: Date, windowEnd: Date): Interval[] {
  const clipped = intervals
    .map((iv) => ({
      start: iv.start.getTime() > windowStart.getTime() ? iv.start : windowStart,
      end: iv.end.getTime() < windowEnd.getTime() ? iv.end : windowEnd
    }))
    .filter((iv) => iv.end.getTime() > iv.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const iv of clipped) {
    const last = merged[merged.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end.getTime() > last.end.getTime()) last.end = iv.end;
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

/** Gaps between merged `busy` intervals, within [windowStart, windowEnd]. */
export function gapsBetween(busy: Interval[], windowStart: Date, windowEnd: Date): Interval[] {
  const merged = mergeIntervals(busy, windowStart, windowEnd);
  const gaps: Interval[] = [];
  let cursor = windowStart;
  for (const iv of merged) {
    if (iv.start.getTime() > cursor.getTime()) {
      gaps.push({ start: cursor, end: iv.start });
    }
    if (iv.end.getTime() > cursor.getTime()) cursor = iv.end;
  }
  if (cursor.getTime() < windowEnd.getTime()) {
    gaps.push({ start: cursor, end: windowEnd });
  }
  return gaps;
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/** "3h 20m" / "45m" style formatting for UI and explanations. */
export function formatMinutes(totalMinutes: number): string {
  const rounded = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
