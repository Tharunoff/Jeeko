import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { executeTool, formatMinutes, type PlannedBlock, type Task } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { PressableScale } from "../components/PressableScale";
import { formatClock } from "../utils/format";

interface DayData {
  key: string;
  dayName: string;
  usable: number;
  committed: number;
  isToday: boolean;
  blocks: PlannedBlock[];
  unscheduledTaskIds: string[];
}

export function WeekScreen() {
  const { store, ready, version, user } = useAppState();
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<DayData[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overloadWarnings, setOverloadWarnings] = useState<string[]>([]);
  const [weeklyWarning, setWeeklyWarning] = useState<string | undefined>();
  const [weeklyStats, setWeeklyStats] = useState<{
    totalCapacity: number;
    totalCommitted: number;
  } | null>(null);
  // Today starts expanded — it's the day you actually care about walking in —
  // everything else starts collapsed so the week doesn't turn into a wall of text.
  const [expandedDay, setExpandedDay] = useState<string | null>("today");

  useEffect(() => {
    if (!store || !ready) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [result, allTasks] = (await Promise.all([
        executeTool("get_week_schedule", {}, { store, now: new Date() }),
        store.listTasks()
      ])) as [any, Task[]];
      if (cancelled) return;

      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      let totalCap = 0;
      let totalCommit = 0;

      const dayEntries: DayData[] = Object.entries(result.days).map(([key, d]: [string, any], i) => {
        const date = new Date(key + "T12:00:00");
        const usable = d.capacity.usableMinutes;
        const blocks: PlannedBlock[] = [...(d.blocks ?? [])].sort(
          (a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );
        const committed = blocks.reduce((s, b) => s + b.durationMinutes, 0);
        totalCap += usable;
        totalCommit += committed;
        return {
          key,
          dayName: i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayNames[date.getDay()],
          usable,
          committed,
          isToday: i === 0,
          blocks,
          unscheduledTaskIds: d.unscheduledTaskIds ?? []
        };
      });

      setDays(dayEntries);
      setTasks(allTasks);
      setOverloadWarnings(result.overloadWarnings.map((w: any) => w.message));
      setWeeklyWarning(result.weeklyOvercommitment.warning);
      setWeeklyStats({ totalCapacity: totalCap, totalCommitted: totalCommit });
      setLoading(false);
      // Today is expanded by the placeholder key "today" above — swap it for
      // today's real date key now that we know it, so the toggle logic below
      // (which compares against real keys) works the first time it's tapped.
      setExpandedDay((current) => (current === "today" ? dayEntries[0]?.key ?? null : current));
    })();
    return () => {
      cancelled = true;
    };
  }, [store, ready, version]);

  function titleFor(taskId: string): string {
    return tasks.find((t) => t.id === taskId)?.title ?? "Untitled task";
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} size="large" />
        <Text style={styles.loadingText}>Planning your week…</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 20, paddingBottom: 50 }}>
      <Text style={styles.title}>This Week</Text>

      {/* Weekly overview */}
      {weeklyStats && (
        <View style={styles.overviewCard}>
          <View style={styles.overviewRow}>
            <View style={styles.overviewItem}>
              <Text style={styles.overviewValue}>{formatMinutes(weeklyStats.totalCapacity)}</Text>
              <Text style={styles.overviewLabel}>capacity</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewValue}>{formatMinutes(weeklyStats.totalCommitted)}</Text>
              <Text style={styles.overviewLabel}>committed</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={[
                styles.overviewValue,
                weeklyStats.totalCommitted > weeklyStats.totalCapacity && { color: Colors.danger }
              ]}>
                {formatMinutes(Math.abs(weeklyStats.totalCapacity - weeklyStats.totalCommitted))}
              </Text>
              <Text style={styles.overviewLabel}>
                {weeklyStats.totalCommitted > weeklyStats.totalCapacity ? "overload" : "remaining"}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Weekly overcommitment warning */}
      {weeklyWarning && (
        <View style={styles.warningCard}>
          <Feather name="alert-triangle" size={15} color={Colors.warning} style={styles.warningIcon} />
          <Text style={styles.warningText}>{weeklyWarning}</Text>
        </View>
      )}

      {/* Day cards */}
      {days.map((d) => {
        const pct = d.usable > 0 ? Math.min(1, d.committed / d.usable) : 0;
        const over = d.committed > d.usable;
        const remaining = Math.max(0, d.usable - d.committed);
        const isExpanded = expandedDay === d.key;
        const isFree = d.blocks.length === 0 && d.unscheduledTaskIds.length === 0;
        return (
          <PressableScale
            key={d.key}
            style={[styles.dayCard, d.isToday && styles.dayCardToday]}
            onPress={() => setExpandedDay(isExpanded ? null : d.key)}
            haptic="selection"
            activeScale={0.98}
          >
            <View style={styles.dayHeader}>
              <View style={styles.dayNameRow}>
                <Text style={[styles.dayLabel, d.isToday && { color: Colors.accent }]}>
                  {d.dayName}
                </Text>
                <Text style={styles.dayDate}>{d.key}</Text>
              </View>
              <View style={styles.dayStats}>
                <Text style={[styles.dayCommitted, over && { color: Colors.danger }]}>
                  {formatMinutes(d.committed)}
                </Text>
                <Text style={styles.daySlash}>/</Text>
                <Text style={styles.dayUsable}>{formatMinutes(d.usable)}</Text>
                <Feather
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={16}
                  color={Colors.textMuted}
                  style={{ marginLeft: 6 }}
                />
              </View>
            </View>

            {/* Progress bar */}
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.min(100, pct * 100)}%`,
                    backgroundColor: over
                      ? Colors.danger
                      : pct > 0.8
                      ? Colors.warning
                      : Colors.accent
                  }
                ]}
              />
            </View>

            {/* Expanded detail — what's actually scheduled, at what time, and
                what didn't fit. This is the whole point of opening a day. */}
            {isExpanded && (
              <View style={styles.dayDetail}>
                {isFree ? (
                  <Text style={styles.emptyText}>Nothing scheduled — fully free.</Text>
                ) : (
                  <>
                    {d.blocks.map((b) => (
                      <View key={b.id} style={styles.blockRow}>
                        <Text style={styles.blockTime}>
                          {formatClock(new Date(b.startTime), user?.timezone ?? "UTC")}
                          {" – "}
                          {formatClock(new Date(b.endTime), user?.timezone ?? "UTC")}
                        </Text>
                        <Text style={styles.blockTitle} numberOfLines={1}>
                          {titleFor(b.taskId)}
                        </Text>
                        <Text style={styles.blockDuration}>{formatMinutes(b.durationMinutes)}</Text>
                      </View>
                    ))}

                    {d.unscheduledTaskIds.length > 0 && (
                      <View style={styles.unscheduledBlock}>
                        <Text style={styles.unscheduledLabel}>
                          Didn't fit today ({d.unscheduledTaskIds.length}):
                        </Text>
                        {d.unscheduledTaskIds.map((id) => (
                          <Text key={id} style={styles.unscheduledItem} numberOfLines={1}>
                            • {titleFor(id)}
                          </Text>
                        ))}
                      </View>
                    )}

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Remaining free time</Text>
                      <Text style={styles.detailValue}>{formatMinutes(remaining)}</Text>
                    </View>
                  </>
                )}
              </View>
            )}
          </PressableScale>
        );
      })}

      {/* Per-day overload warnings */}
      {overloadWarnings.map((msg, i) => (
        <View key={i} style={styles.warningCard}>
          <Feather name="clipboard" size={15} color={Colors.warning} style={styles.warningIcon} />
          <Text style={styles.warningText}>{msg}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  center: {
    flex: 1,
    backgroundColor: Colors.bg,
    justifyContent: "center",
    alignItems: "center",
    gap: 14
  },
  loadingText: { color: Colors.textMuted, fontSize: 15 },
  title: {
    color: Colors.textPrimary,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: 0.37,
    marginBottom: 20
  },

  // Overview
  overviewCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    ...CardShadow
  },
  overviewRow: { flexDirection: "row", alignItems: "center" },
  overviewItem: { flex: 1, alignItems: "center" },
  overviewDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: Colors.separator },
  overviewValue: { color: Colors.textPrimary, fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
  overviewLabel: { color: Colors.textMuted, fontSize: 12, marginTop: 4 },

  // Warning
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(255, 214, 10, 0.06)",
    borderRadius: 14,
    padding: 16,
    marginBottom: 10
  },
  warningIcon: { marginRight: 12, marginTop: 1 },
  warningText: { flex: 1, color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },

  // Day cards
  dayCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
    ...CardShadow
  },
  dayCardToday: {
    backgroundColor: Colors.accentSoft
  },
  dayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  dayNameRow: { flexDirection: "column" },
  dayLabel: { color: Colors.textPrimary, fontSize: 17, fontWeight: "600", letterSpacing: -0.4 },
  dayDate: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  dayStats: { flexDirection: "row", alignItems: "center" },
  dayCommitted: { color: Colors.textPrimary, fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] },
  daySlash: { color: Colors.textMuted, fontSize: 15, marginHorizontal: 3 },
  dayUsable: { color: Colors.textMuted, fontSize: 15, fontVariant: ["tabular-nums"] },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.bgCardAlt,
    overflow: "hidden"
  },
  barFill: { height: 8, borderRadius: 4 },

  // Expanded detail
  dayDetail: { marginTop: 14, gap: 8 },
  emptyText: { color: Colors.textMuted, fontSize: 14, fontStyle: "italic" },
  blockRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  blockTime: { color: Colors.textMuted, fontSize: 12, width: 110, fontVariant: ["tabular-nums"] },
  blockTitle: { flex: 1, color: Colors.textPrimary, fontSize: 14 },
  blockDuration: { color: Colors.textMuted, fontSize: 12, fontVariant: ["tabular-nums"] },
  unscheduledBlock: {
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.separator,
    gap: 3
  },
  unscheduledLabel: { color: Colors.warning, fontSize: 12, fontWeight: "600" },
  unscheduledItem: { color: Colors.textSecondary, fontSize: 13 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.separator
  },
  detailLabel: { color: Colors.textMuted, fontSize: 14 },
  detailValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }
});
