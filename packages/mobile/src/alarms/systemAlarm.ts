import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";

export interface SetAlarmParams {
  /** 0-23 */
  hour: number;
  /** 0-59 */
  minute: number;
  label?: string;
  /** Repeats every day when true. Uses Calendar.DAY_OF_WEEK values
   * (Sunday=1 ... Saturday=7), which is what AlarmClock.EXTRA_DAYS expects. */
  daily?: boolean;
}

/**
 * Hands off to the phone's own Clock app via Android's public
 * AlarmClock.ACTION_SET_ALARM intent — this creates a REAL system alarm,
 * not a scheduled notification. It rings even under aggressive battery
 * optimization / Do Not Disturb the way a notification might not, shows up
 * in the native Clock app, and the user can view/edit/delete it there like
 * any manually-set alarm. This is what "actual alarm, not just a
 * notification" means and is the only reliable way to get that without
 * writing a full native alarm-clock implementation ourselves.
 *
 * SKIP_UI asks the Clock app to add the alarm silently; most stock/AOSP
 * Clock apps honor it, but some OEM skins may briefly show a confirmation
 * screen instead — that's a Clock-app behavior we can't control from here.
 */
export async function setSystemAlarm(params: SetAlarmParams): Promise<boolean> {
  if (Platform.OS !== "android") return false; // no equivalent public intent on iOS

  const extra: Record<string, unknown> = {
    "android.intent.extra.alarm.HOUR": params.hour,
    "android.intent.extra.alarm.MINUTES": params.minute,
    "android.intent.extra.alarm.MESSAGE": params.label ?? "Jeeko",
    "android.intent.extra.alarm.SKIP_UI": true
  };
  if (params.daily) {
    extra["android.intent.extra.alarm.DAYS"] = [1, 2, 3, 4, 5, 6, 7];
  }

  try {
    await IntentLauncher.startActivityAsync("android.intent.action.SET_ALARM", { extra });
    return true;
  } catch (e) {
    console.warn("Failed to set system alarm:", e);
    return false;
  }
}
