import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { executeTool, formatMinutes } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors } from "../theme/colors";

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
              <Text style={styles.overviewLabel}>total capacity</Text>
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
          <TouchableOpacity
            key={d.key}
            style={[styles.dayCard, d.isToday && styles.dayCardToday]}
            onPress={() => setExpandedDay(expandedDay === d.key ? null : d.key)}
            activeOpacity={0.7}
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
          </TouchableOpacity>
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
    gap: 12
  },
  loadingText: { color: Colors.textMuted, fontSize: 14 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3, marginBottom: 16 },

  // Overview
  overviewCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border
  },
  overviewRow: { flexDirection: "row", alignItems: "center" },
  overviewItem: { flex: 1, alignItems: "center" },
  overviewDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  overviewValue: { color: Colors.textPrimary, fontSize: 20, fontWeight: "800" },
  overviewLabel: { color: Colors.textMuted, fontSize: 11, marginTop: 4 },

  // Warning
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.2)"
  },
  warningIcon: { marginRight: 10, marginTop: 2 },
  warningText: { flex: 1, color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },

  // Day cards
  dayCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border
  },
  dayCardToday: { borderColor: Colors.accent, borderWidth: 1.5 },
  dayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  dayNameRow: { flexDirection: "column" },
  dayLabel: { color: Colors.textPrimary, fontSize: 16, fontWeight: "700" },
  dayDate: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
  dayStats: { flexDirection: "row", alignItems: "baseline" },
  dayCommitted: { color: Colors.textPrimary, fontSize: 16, fontWeight: "700" },
  daySlash: { color: Colors.textMuted, fontSize: 14, marginHorizontal: 3 },
  dayUsable: { color: Colors.textMuted, fontSize: 14 },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.bgCardAlt,
    overflow: "hidden"
  },
  barFill: { height: 6, borderRadius: 3 },

  // Expanded detail
  dayDetail: { marginTop: 12, gap: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailLabel: { color: Colors.textMuted, fontSize: 13 },
  detailValue: { color: Colors.textPrimary, fontSize: 13, fontWeight: "600" }
});
