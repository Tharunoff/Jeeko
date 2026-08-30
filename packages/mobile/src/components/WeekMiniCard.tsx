import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatMinutes } from "@personalos/core";
import { Colors } from "../theme/colors";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * A whole week, at a glance, inside a chat bubble — this is exactly the kind of
 * answer that's better shown than said: seven bars, over/under-committed color,
 * today highlighted. Reads straight off the same get_week_schedule/plan_week tool
 * result the reply text was generated from, so it can never disagree with what
 * Jeeko said.
 */
export function WeekMiniCard({ result }: { result: any }) {
  const dayEntries = Object.entries(result.days ?? {}) as [string, any][];
  if (dayEntries.length === 0) return null;

  const days = dayEntries.map(([key, d], i) => {
    const usable = d.capacity?.usableMinutes ?? 0;
    const committed = (d.blocks ?? []).reduce((s: number, b: any) => s + b.durationMinutes, 0);
    const pct = usable > 0 ? Math.min(1, committed / usable) : 0;
    const over = committed > usable;
    const date = new Date(`${key}T12:00:00`);
    return { key, i, usable, committed, pct, over, letter: DAY_LETTERS[date.getDay()] };
  });

  return (
    <View style={styles.card}>
      <Text style={styles.title}>This week</Text>
      <View style={styles.barsRow}>
        {days.map((d) => (
          <View key={d.key} style={styles.dayCol}>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    height: `${Math.max(6, Math.round(d.pct * 100))}%`,
                    backgroundColor: d.over ? Colors.danger : Colors.accent
                  }
                ]}
              />
            </View>
            <Text style={[styles.dayLabel, d.i === 0 && styles.dayLabelToday]}>{d.letter}</Text>
          </View>
        ))}
      </View>
      {result.weeklyOvercommitment?.warning ? (
        <Text style={styles.warning}>{result.weeklyOvercommitment.warning}</Text>
      ) : (
        <Text style={styles.caption}>
          {formatMinutes(days.reduce((s, d) => s + d.committed, 0))} committed of{" "}
          {formatMinutes(days.reduce((s, d) => s + d.usable, 0))} usable
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCardAlt,
    borderRadius: 16,
    padding: 14,
    marginTop: 8,
    minWidth: 220
  },
  title: { color: Colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 10 },
  barsRow: { flexDirection: "row", justifyContent: "space-between", height: 64, alignItems: "flex-end" },
  dayCol: { alignItems: "center", width: 20, height: "100%", justifyContent: "flex-end" },
  barTrack: {
    width: 8,
    flex: 1,
    borderRadius: 4,
    backgroundColor: Colors.bgCard,
    justifyContent: "flex-end",
    overflow: "hidden"
  },
  barFill: { width: 8, borderRadius: 4 },
  dayLabel: { color: Colors.textMuted, fontSize: 10, marginTop: 6 },
  dayLabelToday: { color: Colors.accent, fontWeight: "700" },
  warning: { color: Colors.warning, fontSize: 11, marginTop: 10, lineHeight: 15 },
  caption: { color: Colors.textMuted, fontSize: 11, marginTop: 10 }
});
