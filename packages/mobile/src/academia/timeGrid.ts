/**
 * SRM's unified B.Tech/M.Tech Batch-1 period-time grid — a fixed,
 * university-wide table (not something the portal exposes via scraping),
 * transcribed from the official timetable image the user provided. This is
 * what turns a course's slot code (e.g. "A", "P27-P28", "L51-L52") plus
 * today's day order (1-5, from get_academia_status) into an actual clock
 * time range.
 *
 * Each grid cell can hold one or two codes separated by "/" (e.g. "A/X") —
 * both codes are considered valid matches for that period.
 */

export interface Period {
  hour: number;
  from: string; // "HH:MM" 24h
  to: string; // "HH:MM" 24h
}

// Column headers: hour 1-12 -> clock range, identical across all 5 day orders.
export const PERIODS: Period[] = [
  { hour: 1, from: "08:00", to: "08:50" },
  { hour: 2, from: "08:50", to: "09:40" },
  { hour: 3, from: "09:45", to: "10:35" },
  { hour: 4, from: "10:40", to: "11:30" },
  { hour: 5, from: "11:35", to: "12:25" },
  { hour: 6, from: "12:30", to: "13:20" },
  { hour: 7, from: "13:25", to: "14:15" },
  { hour: 8, from: "14:20", to: "15:10" },
  { hour: 9, from: "15:10", to: "16:00" },
  { hour: 10, from: "16:00", to: "16:50" },
  { hour: 11, from: "16:50", to: "17:30" },
  { hour: 12, from: "17:30", to: "18:10" }
];

// Row data: day order (1-5) -> the code(s) occupying each of the 12 hours.
const DAY_ORDER_GRID: Record<number, string[]> = {
  1: ["A", "A/X", "F/X", "F", "G", "P6", "P7", "P8", "P9", "P10", "L11", "L12"],
  2: ["P11", "P12/X", "P13/X", "P14", "P15", "B", "B", "G", "G", "A", "L21", "L22"],
  3: ["C", "C/X", "A/X", "D", "B", "P26", "P27", "P28", "P29", "P30", "L31", "L32"],
  4: ["P31", "P32/X", "P33/X", "P34", "P35", "D", "D", "B", "E", "C", "L41", "L42"],
  5: ["E", "E/X", "C/X", "F", "D", "P46", "P47", "P48", "P49", "P50", "L51", "L52"]
};

/** For a given day order, finds every hour whose grid cell matches `code`
 * (splitting "A/X" style cells on "/"). Used both for single-letter theory
 * slots (which can recur at more than one hour in a day order) and for
 * unique P/L codes (which occur exactly once). */
function findHoursForCode(dayOrder: number, code: string): number[] {
  const row = DAY_ORDER_GRID[dayOrder];
  if (!row) return [];
  const hours: number[] = [];
  row.forEach((cell, idx) => {
    const parts = cell.split("/").map((p) => p.trim().toUpperCase());
    if (parts.includes(code.trim().toUpperCase())) {
      hours.push(idx + 1);
    }
  });
  return hours;
}

export interface ResolvedSlotTime {
  from: string;
  to: string;
  hours: number[];
}

/**
 * Resolves a course's slot string (as returned by the scraper, e.g. "A",
 * "P27-P28", "L51-L52") against today's day order into one or more clock
 * time ranges. A slot can legitimately resolve to more than one time range
 * in a day (e.g. a theory slot appearing at two separate hours), so this
 * returns an array — callers should show/consider all of them, not just
 * the first.
 */
export function resolveSlotTimes(dayOrder: number, slot: string): ResolvedSlotTime[] {
  if (!slot) return [];
  const codes = slot
    .split("-")
    .map((s) => s.trim())
    .filter(Boolean);

  // Single code (e.g. "A"): each matching hour is its own separate time range.
  if (codes.length === 1) {
    const hours = findHoursForCode(dayOrder, codes[0]);
    return hours.map((h) => {
      const period = PERIODS[h - 1];
      return { from: period.from, to: period.to, hours: [h] };
    });
  }

  // Multi-code range (e.g. "P27-P28", "L51-L52"): each code should resolve
  // to exactly one hour; combine into a single contiguous range spanning
  // the earliest start to the latest end.
  const allHours: number[] = [];
  for (const code of codes) {
    const hours = findHoursForCode(dayOrder, code);
    allHours.push(...hours);
  }
  if (allHours.length === 0) return [];
  allHours.sort((a, b) => a - b);
  const from = PERIODS[allHours[0] - 1].from;
  const to = PERIODS[allHours[allHours.length - 1] - 1].to;
  return [{ from, to, hours: allHours }];
}
