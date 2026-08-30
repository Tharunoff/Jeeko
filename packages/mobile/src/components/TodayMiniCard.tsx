import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatMinutes, type DataStore, type Task } from "@personalos/core";
import { Colors } from "../theme/colors";
import { formatClock } from "../utils/format";

/** Today's block-by-block schedule inside a chat bubble. The tool result only carries
 * task IDs, so this resolves titles itself once, off the same store the reply came
 * from — never fabricated, just looked up. */
export function TodayMiniCard({ result, store, timezone }: { result: any; store: DataStore; timezone: string }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.listTasks().then((t) => {
      if (!cancelled) setTasks(t);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const blocks = [...(result.blocks ?? [])].sort(
    (a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  if (blocks.length === 0) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Today's schedule</Text>
      {blocks.slice(0, 8).map((b: any) => {
        const task = tasks?.find((t) => t.id === b.taskId);
        return (
          <View key={b.id} style={styles.row}>
            <Text style={styles.time}>{formatClock(new Date(b.startTime), timezone)}</Text>
            <Text style={styles.task} numberOfLines={1}>
              {task?.title ?? (tasks ? b.taskId : "…")}
            </Text>
            <Text style={styles.dur}>{formatMinutes(b.durationMinutes)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCardAlt,
    borderRadius: 16,
    padding: 14,
    marginTop: 8,
    minWidth: 240,
    gap: 8
  },
  title: { color: Colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, marginBottom: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  time: { color: Colors.textMuted, fontSize: 11, width: 56 },
  task: { flex: 1, color: Colors.textPrimary, fontSize: 12 },
  dur: { color: Colors.textMuted, fontSize: 11 }
});
