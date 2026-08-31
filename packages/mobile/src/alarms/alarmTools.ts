import type { ExternalTool } from "@personalos/core";
import { setSystemAlarm } from "./systemAlarm";

/**
 * Mobile-only tool wrapping the native system-alarm intent (see
 * systemAlarm.ts) — not part of core's ALL_TOOLS since it launches an
 * Android intent core has no business knowing about. Distinct from
 * create_reminder (packages/core/src/llm/tools.ts), which is a scheduled
 * in-app notification: this creates a REAL alarm in the phone's own Clock
 * app, for when the user explicitly wants an alarm rather than a reminder.
 */
export function createAlarmTools(): ExternalTool[] {
  const setAlarm: ExternalTool = {
    name: "set_system_alarm",
    description:
      "Sets a REAL alarm in the phone's own Clock app (not an in-app notification) — the kind that rings through Do Not Disturb and battery optimization, and shows up in the native Clock app for the user to view/edit. Use when the user explicitly says 'alarm' (e.g. 'set an alarm for 7am', 'wake me up at 6', or a daily alarm for a recurring task like the gym) rather than a softer 'remind me'. Set daily=true when the user wants it every day.",
    parameters: {
      type: "object",
      properties: {
        hour: { type: "integer", description: "0-23, 24-hour format" },
        minute: { type: "integer", description: "0-59" },
        label: { type: "string", description: "What the alarm is for, e.g. 'Gym'" },
        daily: { type: "boolean", description: "True to repeat every day, false/omitted for a one-time alarm" }
      },
      required: ["hour", "minute"]
    },
    handler: async (args: { hour: number; minute: number; label?: string; daily?: boolean }) => {
      const ok = await setSystemAlarm({ hour: args.hour, minute: args.minute, label: args.label, daily: args.daily });
      if (!ok) {
        return {
          error:
            "Couldn't open the system alarm — this only works on Android with a Clock app installed that supports the standard set-alarm intent."
        };
      }
      const timeStr = `${String(args.hour).padStart(2, "0")}:${String(args.minute).padStart(2, "0")}`;
      return {
        success: true,
        message: args.daily
          ? `Daily alarm set for ${timeStr} in the Clock app.`
          : `Alarm set for ${timeStr} in the Clock app.`
      };
    }
  };

  return [setAlarm];
}
