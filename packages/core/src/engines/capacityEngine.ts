import type { CalendarEvent, CapacityBreakdown, TimeWindow, UserProfile } from "../types/index";
import { CapacityConfig, DEFAULT_CAPACITY_CONFIG } from "../config/capacityConfig";
import {
  gapsBetween,
  localDateKey,
  mergeIntervals,
  minutesBetween,
  parseLocalTimeOnDate
} from "../util/time";

/**
 * Computes real usable capacity for one day. Deliberately NOT
 * "24 hours - calendar events" — see the spec's capacity formula:
 *   Available Capacity = waking hours - fixed commitments - travel - meals
 *                         - planned breaks - required buffer
 * followed by a further split into usable / deep-work / low-energy minutes.
 */
export function calculateCapacity(params: {
  date: Date;
  user: UserProfile;
  events: CalendarEvent[];
  config?: CapacityConfig;
}): CapacityBreakdown {
  const config = params.config ?? DEFAULT_CAPACITY_CONFIG;
  const { user, events, date } = params;
  const timezone = user.timezone || "UTC";

  const wakeStr = user.preferredWakeTime || config.defaultWakeTime;
  const sleepStr = user.preferredSleepTime || config.defaultSleepTime;
  const wakingStart = parseLocalTimeOnDate(wakeStr, date, timezone);
  let wakingEnd = parseLocalTimeOnDate(sleepStr, date, timezone);
  if (wakingEnd.getTime() <= wakingStart.getTime()) {
    // sleep time is past midnight (e.g. wake 07:00, sleep 00:30) — roll to next day
    wakingEnd = new Date(wakingEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  const wakingMinutes = minutesBetween(wakingStart, wakingEnd);

  // Fixed/non-negotiable blocks: class, meeting, appointment, sleep, other(fixed), all clipped to waking hours.
  const fixedIntervals = events
    .filter((e) => e.fixed && ["class", "meeting", "appointment", "sleep", "other"].includes(e.type))
    .map((e) => ({ start: e.startTime, end: e.endTime }));
  const mergedFixed = mergeIntervals(fixedIntervals, wakingStart, wakingEnd);
  const fixedMinutes = mergedFixed.reduce((sum, iv) => sum + minutesBetween(iv.start, iv.end), 0);

  const travelIntervals = events
    .filter((e) => e.type === "travel")
    .map((e) => ({ start: e.startTime, end: e.endTime }));
  const mergedTravel = mergeIntervals(travelIntervals, wakingStart, wakingEnd);
  const travelMinutes = mergedTravel.reduce((sum, iv) => sum + minutesBetween(iv.start, iv.end), 0);

  const occupied = mergeIntervals([...mergedFixed, ...mergedTravel], wakingStart, wakingEnd);
  const occupiedMinutes = occupied.reduce((sum, iv) => sum + minutesBetween(iv.start, iv.end), 0);
  const totalFreeMinutes = Math.max(0, wakingMinutes - occupiedMinutes);

  const mealEvents = events.filter((e) => e.type === "meal");
  const mealMinutes =
    mealEvents.length > 0
      ? mergeIntervals(
          mealEvents.map((e) => ({ start: e.startTime, end: e.endTime })),
          wakingStart,
          wakingEnd
        ).reduce((sum, iv) => sum + minutesBetween(iv.start, iv.end), 0)
      : config.mealsPerDay * config.mealMinutesPerMeal;

  const breakMinutes =
    Math.floor(totalFreeMinutes / config.breakIntervalMinutes) * config.defaultBreakMinutes;

  const bufferMinutes = Math.max(
    config.defaultBufferMinutes,
    Math.round(totalFreeMinutes * config.bufferFractionOfFree)
  );

  const usableMinutes = Math.max(0, totalFreeMinutes - mealMinutes - breakMinutes - bufferMinutes);

  // Literal free gaps (for placing blocks), tagged by whether they can host deep work.
  const gaps = gapsBetween(occupied, wakingStart, wakingEnd);
  const deepCutoff = new Date(wakingEnd.getTime() - config.noDeepWorkBeforeSleepMinutes * 60000);
  const windows: TimeWindow[] = gaps
    .map((g) => {
      const minutes = minutesBetween(g.start, g.end);
      const canBeDeep = minutes >= config.deepWorkMinBlockMinutes && g.start.getTime() < deepCutoff.getTime();
      return {
        start: g.start,
        end: g.end,
        minutes,
        energyTag: (canBeDeep ? "deep" : "low") as "deep" | "low"
      };
    })
    .filter((w) => w.minutes >= config.lowEnergyMinBlockMinutes);

  const deepWorkMinutes = windows.filter((w) => w.energyTag === "deep").reduce((s, w) => s + w.minutes, 0);
  const lowEnergyMinutes = windows.filter((w) => w.energyTag === "low").reduce((s, w) => s + w.minutes, 0);

  return {
    date: localDateKey(date, timezone),
    wakingMinutes,
    fixedMinutes,
    travelMinutes,
    mealMinutes,
    breakMinutes,
    bufferMinutes,
    totalFreeMinutes,
    usableMinutes,
    deepWorkMinutes,
    lowEnergyMinutes,
    windows
  };
}
