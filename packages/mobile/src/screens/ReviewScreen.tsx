import React, { useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
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
import { Colors } from "../theme/colors";

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
      <Text style={styles.title}>Daily Review</Text>
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
              <View style={[styles.barTrack, { marginTop: 3 }]}>
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
          {completedToday.map((t) => {
            const hasLog = todayLogs.some((l) => l.taskId === t.id);
            return (
              <View key={t.id} style={styles.logCard}>
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
                      <TouchableOpacity onPress={() => setLoggingTaskId(null)}>
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.logButton} onPress={() => logTime(t)}>
                        <Text style={styles.logButtonText}>Log</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : !hasLog ? (
                  <TouchableOpacity
                    style={styles.logTimeButton}
                    onPress={() => {
                      setLoggingTaskId(t.id);
                      setActualMinutesInput(String(t.estimatedMinutes));
                    }}
                  >
                    <Text style={styles.logTimeText}>Log time</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          })}
        </>
      )}

      {/* Create daily review */}
      <TouchableOpacity style={styles.reviewButton} onPress={createDailyReview}>
        <Feather name="clipboard" size={15} color={Colors.textPrimary} />
        <Text style={styles.reviewButtonText}>Generate Daily Review</Text>
      </TouchableOpacity>

      {/* Latest review */}
      {latestReview && (
        <>
          <Text style={styles.sectionLabel}>LATEST REVIEW</Text>
          <View style={styles.reviewCard}>
            <Text style={styles.reviewDate}>{latestReview.date}</Text>
            <View style={styles.reviewStats}>
              <View style={styles.reviewStatRow}>
                <Feather name="check-circle" size={13} color={Colors.success} />
                <Text style={styles.reviewStat}>{latestReview.completedCount} done</Text>
                <Feather name="x-circle" size={13} color={Colors.danger} style={{ marginLeft: 10 }} />
                <Text style={styles.reviewStat}>{latestReview.incompleteCount} missed</Text>
              </View>
              <View style={styles.reviewStatRow}>
                <Feather name="bar-chart-2" size={13} color={Colors.textMuted} />
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
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginTop: 4, marginBottom: 16 },

  // Stats card
  statsCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12
  },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, height: 32, backgroundColor: Colors.border },
  statValue: { color: Colors.textPrimary, fontSize: 22, fontWeight: "800" },
  statLabel: { color: Colors.textMuted, fontSize: 11, marginTop: 4 },

  // Accuracy
  accuracySection: { marginTop: 16 },
  accuracyHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  accuracyLabel: { color: Colors.textMuted, fontSize: 13 },
  accuracyValue: { fontSize: 14, fontWeight: "700" },
  dualBar: {},
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.bgCardAlt,
    overflow: "hidden"
  },
  barEstimated: { height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  barActual: { height: 8, borderRadius: 4, backgroundColor: Colors.success },
  barLegend: { flexDirection: "row", gap: 16, marginTop: 8 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: Colors.textMuted, fontSize: 11 },

  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 10
  },

  // Log cards
  logCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border
  },
  logHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  logTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: "600" },
  logEstimate: { color: Colors.textMuted, fontSize: 12, marginTop: 3 },
  loggedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(34, 197, 94, 0.15)",
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8
  },
  loggedText: { color: Colors.success, fontSize: 11, fontWeight: "600" },

  logForm: { marginTop: 10 },
  input: {
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 8
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cancelText: { color: Colors.textMuted, fontSize: 14 },
  logButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 18
  },
  logButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  logTimeButton: { marginTop: 8 },
  logTimeText: { color: Colors.accent, fontSize: 13, fontWeight: "600" },

  // Review button
  reviewButton: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 12
  },
  reviewButtonText: { color: Colors.textPrimary, fontWeight: "600", fontSize: 15 },

  // Review card
  reviewCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border
  },
  reviewDate: { color: Colors.accent, fontSize: 14, fontWeight: "700", marginBottom: 8 },
  reviewStats: { gap: 6 },
  reviewStatRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  reviewStat: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  issueBox: {
    marginTop: 12,
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderRadius: 10,
    padding: 10
  },
  issueLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 4
  },
  issueText: { color: Colors.warning, fontSize: 13, lineHeight: 18 },
  adjustBox: {
    marginTop: 8,
    backgroundColor: "rgba(99, 102, 241, 0.08)",
    borderRadius: 10,
    padding: 10
  },
  adjustText: { color: Colors.accent, fontSize: 13, lineHeight: 18 }
});
