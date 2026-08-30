import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  buildDailyReview,
  executeTool,
  formatMinutes,
  generateId,
  type DailyReview,
  type Task,
  type TimeLog
} from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { PressableScale } from "../components/PressableScale";

export function ReviewScreen() {
  const { store, user, ready, version, refresh } = useAppState();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [reviews, setReviews] = useState<DailyReview[]>([]);
  const [completedToday, setCompletedToday] = useState<Task[]>([]);

  // Track time log form
  const [loggingTaskId, setLoggingTaskId] = useState<string | null>(null);
  const [actualMinutesInput, setActualMinutesInput] = useState("");

  useEffect(() => {
    if (!store || !ready) return;
    (async () => {
      const allTasks = await store.listTasks();
      setTasks(allTasks);
      setTimeLogs(await store.listTimeLogs());
      setReviews(await store.listDailyReviews());

      // Tasks completed today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      setCompletedToday(
        allTasks.filter(
          (t) =>
            t.status === "completed" &&
            t.completedAt &&
            new Date(t.completedAt).getTime() >= todayStart.getTime()
        )
      );
    })();
  }, [store, ready, version]);

  async function logTime(task: Task) {
    if (!store) return;
    const actual = parseInt(actualMinutesInput, 10);
    if (isNaN(actual) || actual < 1) {
      Alert.alert("Enter valid minutes");
      return;
    }
    await executeTool(
      "record_actual_duration",
      {
        taskId: task.id,
        actualMinutes: actual
      },
      { store, now: new Date() }
    );
    setLoggingTaskId(null);
    setActualMinutesInput("");
    refresh();
  }

  async function createDailyReview() {
    if (!store || !user) return;
    const now = new Date();
    const allTasks = await store.listTasks();
    const allBlocks = await store.listPlannedBlocks();
    const allLogs = await store.listTimeLogs();
    const reviewData = buildDailyReview({
      date: now,
      timezone: user.timezone,
      todaysBlocks: allBlocks,
      tasks: allTasks,
      timeLogs: allLogs
    });
    await store.saveDailyReview({
      id: generateId("review"),
      ...reviewData,
      createdAt: now
    });
    refresh();
  }

  const totalEstimated = completedToday.reduce((s, t) => s + t.estimatedMinutes, 0);
  const todayLogs = timeLogs.filter((l) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(l.createdAt).getTime() >= today.getTime();
  });
  const totalActual = todayLogs.reduce((s, l) => s + l.actualMinutes, 0);
  const estimationAccuracy =
    totalEstimated > 0 ? Math.round((totalActual / totalEstimated) * 100) : 0;
  const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 20, paddingBottom: 50 }}>
      <Text style={styles.title}>Review</Text>
      <Text style={styles.subtitle}>Track actual time to improve estimates</Text>

      {/* Today stats */}
      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{completedToday.length}</Text>
            <Text style={styles.statLabel}>completed</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatMinutes(totalEstimated)}</Text>
            <Text style={styles.statLabel}>estimated</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatMinutes(totalActual)}</Text>
            <Text style={styles.statLabel}>actual</Text>
          </View>
        </View>

        {/* Accuracy bar */}
        {totalEstimated > 0 && (
          <View style={styles.accuracySection}>
            <View style={styles.accuracyHeader}>
              <Text style={styles.accuracyLabel}>Estimation accuracy</Text>
              <Text
                style={[
                  styles.accuracyValue,
                  estimationAccuracy > 120
                    ? { color: Colors.danger }
                    : estimationAccuracy > 100
                    ? { color: Colors.warning }
                    : { color: Colors.success }
                ]}
              >
                {estimationAccuracy}%
              </Text>
            </View>

            {/* Overlapping bars */}
            <View style={styles.dualBar}>
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barEstimated,
                    { width: `${Math.min(100, (totalEstimated / Math.max(totalEstimated, totalActual)) * 100)}%` }
                  ]}
                />
              </View>
              <View style={[styles.barTrack, { marginTop: 4 }]}>
                <View
                  style={[
                    styles.barActual,
                    { width: `${Math.min(100, (totalActual / Math.max(totalEstimated, totalActual)) * 100)}%` }
                  ]}
                />
              </View>
              <View style={styles.barLegend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.accent }]} />
                  <Text style={styles.legendText}>estimated</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: Colors.success }]} />
                  <Text style={styles.legendText}>actual</Text>
                </View>
              </View>
            </View>
          </View>
        )}
      </View>

      {/* Completed tasks — log time */}
      {completedToday.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>LOG ACTUAL TIME</Text>
          <View style={styles.logGroup}>
            {completedToday.map((t, idx) => {
              const hasLog = todayLogs.some((l) => l.taskId === t.id);
              return (
                <View key={t.id}>
                  <View style={styles.logCard}>
                    <View style={styles.logHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.logTitle}>{t.title}</Text>
                        <Text style={styles.logEstimate}>
                          estimated {formatMinutes(t.estimatedMinutes)}
                        </Text>
                      </View>
                      {hasLog ? (
                        <View style={styles.loggedBadge}>
                          <Feather name="check" size={11} color={Colors.success} />
                          <Text style={styles.loggedText}>logged</Text>
                        </View>
                      ) : null}
                    </View>

                    {loggingTaskId === t.id ? (
                      <View style={styles.logForm}>
                        <TextInput
                          style={styles.input}
                          placeholder="Actual minutes spent"
                          placeholderTextColor={Colors.textMuted}
                          value={actualMinutesInput}
                          onChangeText={setActualMinutesInput}
                          keyboardType="number-pad"
                          autoFocus
                        />
                        <View style={styles.formActions}>
                          <PressableScale onPress={() => setLoggingTaskId(null)} haptic="light">
                            <Text style={styles.cancelText}>Cancel</Text>
                          </PressableScale>
                          <PressableScale style={styles.logButton} onPress={() => logTime(t)} haptic="medium">
                            <Text style={styles.logButtonText}>Log</Text>
                          </PressableScale>
                        </View>
                      </View>
                    ) : !hasLog ? (
                      <PressableScale
                        style={styles.logTimeButton}
                        onPress={() => {
                          setLoggingTaskId(t.id);
                          setActualMinutesInput(String(t.estimatedMinutes));
                        }}
                        haptic="light"
                      >
                        <Text style={styles.logTimeText}>Log time</Text>
                      </PressableScale>
                    ) : null}
                  </View>
                  {idx < completedToday.length - 1 && <View style={styles.logSeparator} />}
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Create daily review */}
      <PressableScale style={styles.reviewButton} onPress={createDailyReview} haptic="medium">
        <Text style={styles.reviewButtonText}>Generate Daily Review</Text>
      </PressableScale>

      {/* Latest review */}
      {latestReview && (
        <>
          <Text style={styles.sectionLabel}>LATEST REVIEW</Text>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewDate}>{latestReview.date}</Text>
            <View style={styles.reviewStats}>
              <View style={styles.reviewStatRow}>
                <Feather name="check-circle" size={14} color={Colors.success} />
                <Text style={styles.reviewStat}>{latestReview.completedCount} done</Text>
                <Feather name="x-circle" size={14} color={Colors.danger} style={{ marginLeft: 12 }} />
                <Text style={styles.reviewStat}>{latestReview.incompleteCount} missed</Text>
              </View>
              <View style={styles.reviewStatRow}>
                <Feather name="bar-chart-2" size={14} color={Colors.textMuted} />
                <Text style={styles.reviewStat}>
                  Est {formatMinutes(latestReview.estimatedTotalMinutes)} · Act{" "}
                  {formatMinutes(latestReview.actualTotalMinutes)}
                </Text>
              </View>
            </View>
            {latestReview.mainIssue && (
              <View style={styles.issueBox}>
                <Text style={styles.issueLabel}>Main issue</Text>
                <Text style={styles.issueText}>{latestReview.mainIssue}</Text>
              </View>
            )}
            {latestReview.tomorrowAdjustment && (
              <View style={styles.adjustBox}>
                <Text style={styles.issueLabel}>Adjustment</Text>
                <Text style={styles.adjustText}>{latestReview.tomorrowAdjustment}</Text>
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  title: {
    color: Colors.textPrimary,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: 0.37
  },
  subtitle: { color: Colors.textMuted, fontSize: 14, marginTop: 4, marginBottom: 20 },

  // Stats card
  statsCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 22,
    marginBottom: 14,
    ...CardShadow
  },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statDivider: { width: StyleSheet.hairlineWidth, height: 36, backgroundColor: Colors.separator },
  statValue: { color: Colors.textPrimary, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] },
  statLabel: { color: Colors.textMuted, fontSize: 12, marginTop: 4 },

  // Accuracy
  accuracySection: { marginTop: 18 },
  accuracyHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  accuracyLabel: { color: Colors.textMuted, fontSize: 14 },
  accuracyValue: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  dualBar: {},
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.bgCardAlt,
    overflow: "hidden"
  },
  barEstimated: { height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  barActual: { height: 8, borderRadius: 4, backgroundColor: Colors.success },
  barLegend: { flexDirection: "row", gap: 18, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: Colors.textMuted, fontSize: 12 },

  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    letterSpacing: -0.08,
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 10
  },

  // Log cards — grouped
  logGroup: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    paddingHorizontal: 16,
    ...CardShadow
  },
  logCard: {
    paddingVertical: 14
  },
  logSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.separator
  },
  logHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  logTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: "600" },
  logEstimate: { color: Colors.textMuted, fontSize: 13, marginTop: 3 },
  loggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(48, 209, 88, 0.12)",
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 10
  },
  loggedText: { color: Colors.success, fontSize: 12, fontWeight: "600" },

  logForm: { marginTop: 12 },
  input: {
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cancelText: { color: Colors.textMuted, fontSize: 15, fontWeight: "500" },
  logButton: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20
  },
  logButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  logTimeButton: { marginTop: 10 },
  logTimeText: { color: Colors.accent, fontSize: 14, fontWeight: "600" },

  // Review button — full-width prominent
  reviewButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 16
  },
  reviewButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  // Review card
  reviewCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 18,
    ...CardShadow
  },
  reviewDate: { color: Colors.accent, fontSize: 15, fontWeight: "700", marginBottom: 10 },
  reviewStats: { gap: 8 },
  reviewStatRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewStat: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  issueBox: {
    marginTop: 14,
    backgroundColor: "rgba(255, 214, 10, 0.06)",
    borderRadius: 12,
    padding: 12
  },
  issueLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4
  },
  issueText: { color: Colors.warning, fontSize: 14, lineHeight: 20 },
  adjustBox: {
    marginTop: 10,
    backgroundColor: "rgba(34, 211, 238, 0.06)",
    borderRadius: 12,
    padding: 12
  },
  adjustText: { color: Colors.accent, fontSize: 14, lineHeight: 20 }
});
