/**
 * Tunables for the capacity engine. Documented so nobody has to guess why
 * "60" or "0.15" appear in the math.
 */
export interface CapacityConfig {
  /** Floor buffer in minutes, regardless of how long the day is. Absorbs
   * small overruns/interruptions even on a light day. */
  defaultBufferMinutes: number;
  /** Buffer also scales with the amount of free time available — a day with
   * a lot of open time needs a proportionally bigger safety margin because
   * there's more opportunity for estimation error to compound. */
  bufferFractionOfFree: number;
  /** Assumed minutes per meal when no explicit `meal` calendar events exist
   * for the day (most users won't log every meal). */
  mealMinutesPerMeal: number;
  mealsPerDay: number;
  /** One break of this length is assumed per ~90 minutes of free time
   * (a conservative Pomodoro-ish assumption), deducted from usable time. */
  defaultBreakMinutes: number;
  breakIntervalMinutes: number;
  /** A free window shorter than this can't meaningfully host deep work. */
  deepWorkMinBlockMinutes: number;
  /** A free window shorter than this is too small to schedule anything. */
  lowEnergyMinBlockMinutes: number;
  /** Windows starting within this many minutes of preferredSleepTime are
   * never tagged "deep" — winding-down hours aren't for hard cognitive work. */
  noDeepWorkBeforeSleepMinutes: number;
  /** Fallback waking hours when the user hasn't set wake/sleep preferences. */
  defaultWakeTime: string;
  defaultSleepTime: string;
}

export const DEFAULT_CAPACITY_CONFIG: CapacityConfig = {
  defaultBufferMinutes: 60,
  bufferFractionOfFree: 0.15,
  mealMinutesPerMeal: 30,
  mealsPerDay: 3,
  defaultBreakMinutes: 10,
  breakIntervalMinutes: 90,
  deepWorkMinBlockMinutes: 45,
  lowEnergyMinBlockMinutes: 15,
  noDeepWorkBeforeSleepMinutes: 60,
  defaultWakeTime: "07:00",
  defaultSleepTime: "23:00"
};
