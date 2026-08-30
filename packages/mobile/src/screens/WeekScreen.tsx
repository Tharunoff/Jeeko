import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { executeTool, formatMinutes } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { PressableScale } from "../components/PressableScale";

interface DayData {
  key: string;
  dayName: string;
  usable: number;
  committed: number;
  isToday: boolean;
}

export function WeekScreen() {
  const { store, ready, version } = useAppState();
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<DayData[]>([]);
  const [overloadWarnings, setOverloadWarnings] = useState<string[]>([]);
  const [weeklyWarning, setWeeklyWarning] = useState<string | undefined>();
  const [weeklyStats, setWeeklyStats] = useState<{
    totalCapacity: number;
    totalCommitted: number;
  } | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  useEffect(() => {
    if (!store || !ready) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result = (await executeTool("get_week_schedule", {}, { store, now: new Date() })) as any;
      if (cancelled) return;

      const todayKey = Object.keys(result.days)[0]; // first day is today
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      let totalCap = 0;
      let totalCommit = 0;

      const dayEntries = Object.entries(result.days).map(([key, d]: [string, any], i) => {
        const date = new Date(key + "T12:00:00");
        const usable = d.capacity.usableMinutes;
        const committed = d.blocks.reduce((s: number, b: any) => s + b.durationMinutes, 0);
        totalCap += usable;
        totalCommit += committed;
        return {
          key,
          dayName: i === 0 ? "Today" : i === 1 ? "Tomorrow" : dayNames[date.getDay()],
          usable,
          committed,
          isToday: i === 0
        };
      });

      setDays(dayEntries);
      setOverloadWarnings(result.overloadWarnings.map((w: any) => w.message));
      setWeeklyWarning(result.weeklyOvercommitment.warning);
      setWeeklyStats({ totalCapacity: totalCap, totalCommitted: totalCommit });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, ready, version]);

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
        return (
          <PressableScale
            key={d.key}
            style={[styles.dayCard, d.isToday && styles.dayCardToday]}
            onPress={() => setExpandedDay(expandedDay === d.key ? null : d.key)}
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

            {/* Expanded detail */}
            {expandedDay === d.key && (
              <View style={styles.dayDetail}>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Remaining</Text>
                  <Text style={styles.detailValue}>{formatMinutes(remaining)}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Load</Text>
                  <Text style={[
                    styles.detailValue,
                    over && { color: Colors.danger }
                  ]}>
                    {Math.round(pct * 100)}%
                  </Text>
                </View>
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
  dayStats: { flexDirection: "row", alignItems: "baseline" },
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
  dayDetail: { marginTop: 14, gap: 6 },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailLabel: { color: Colors.textMuted, fontSize: 14 },
  detailValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] }
});
