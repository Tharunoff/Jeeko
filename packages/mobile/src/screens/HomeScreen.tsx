import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import {
  detectGoalDrift,
  detectProcrastination,
  executeTool,
  formatMinutes
} from "@personalos/core";
import { useAppState } from "../state/AppState";
import { useToday } from "../hooks/useToday";
import { Colors } from "../theme/colors";
import { Gradients } from "../theme/typography";
import { formatClock } from "../utils/format";

type Energy = "low" | "medium" | "high";

export function HomeScreen({ onOpenChat }: { onOpenChat: () => void }) {
  const { user, store, seed, version } = useAppState();
  const [energy, setEnergy] = useState<Energy | undefined>(undefined);
  const today = useToday(energy);
  const [insights, setInsights] = useState<{
    procrastination: Array<{ title: string; postponedCount: number }>;
    goalDrift?: string;
    deadlines: Array<{ title: string; hoursLeft: number }>;
  }>({ procrastination: [], deadlines: [] });

  // Load insights when data changes
  React.useEffect(() => {
    if (!store || !user) return;
    (async () => {
      const [tasks, decisions, goals, timeLogs] = await Promise.all([
        store.listTasks(),
        store.listDecisions(),
        store.listGoals(),
        store.listTimeLogs()
      ]);

      // Procrastination
      const procFlags = detectProcrastination(decisions, tasks);
      // Goal drift
      const drift = detectGoalDrift({ timeLogs, tasks, goals, now: new Date() });
      // Approaching deadlines (within 24h)
      const now = new Date();
      const oneDayMs = 24 * 60 * 60 * 1000;
      const deadlines = tasks
        .filter(
          (t) =>
            t.deadline &&
            t.deadlineType === "hard" &&
            t.status !== "completed" &&
            t.status !== "cancelled" &&
            new Date(t.deadline).getTime() - now.getTime() < oneDayMs &&
            new Date(t.deadline).getTime() > now.getTime()
        )
        .map((t) => ({
          title: t.title,
          hoursLeft: Math.round((new Date(t.deadline!).getTime() - now.getTime()) / 3600000)
        }));

      setInsights({
        procrastination: procFlags.map((p) => ({ title: p.title, postponedCount: p.postponedCount })),
        goalDrift: drift.drifting ? drift.message : undefined,
        deadlines
      });
    })();
  }, [store, user, version]);

  if (!user) return null;

  if (today.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} size="large" />
        <Text style={styles.loadingText}>Calculating your day…</Text>
      </View>
    );
  }

  const hasAnyTasks = today.tasks.length > 0;
  const plannedMinutes = today.blocks.reduce((s, b) => s + b.durationMinutes, 0);
  const capacityPct = today.capacity
    ? Math.min(1, plannedMinutes / Math.max(1, today.capacity.usableMinutes))
    : 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 50, paddingTop: 16 }}
    >
      {/* Greeting */}
      <Text style={styles.greeting}>Hey {user.name}</Text>
      <Text style={styles.dateSubtitle}>
        {new Date().toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric"
        })}
      </Text>

      {/* Empty state */}
      {!hasAnyTasks && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Your PA is ready</Text>
          <Text style={styles.emptyBody}>
            Add goals, projects, tasks, and fixed commitments to get real decisions — or load sample data.
          </Text>
          <TouchableOpacity style={styles.primaryButton} onPress={seed}>
            <Text style={styles.primaryButtonText}>Load sample data</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Insight banners */}
      {insights.deadlines.map((d, i) => (
        <View key={`dl_${i}`} style={styles.deadlineBanner}>
          <Feather name="clock" size={15} color={Colors.danger} style={styles.bannerIcon} />
          <Text style={styles.bannerText}>
            <Text style={styles.bannerBold}>{d.title}</Text> due in ~{d.hoursLeft}h
          </Text>
        </View>
      ))}

      {insights.goalDrift && (
        <View style={styles.driftBanner}>
          <Feather name="alert-triangle" size={15} color={Colors.warning} style={styles.bannerIcon} />
          <Text style={styles.bannerText}>{insights.goalDrift}</Text>
        </View>
      )}

      {insights.procrastination.map((p, i) => (
        <View key={`proc_${i}`} style={styles.procBanner}>
          <Feather name="repeat" size={15} color={Colors.accent} style={styles.bannerIcon} />
          <Text style={styles.bannerText}>
            <Text style={styles.bannerBold}>{p.title}</Text> has been postponed {p.postponedCount} times.
            Consider splitting it into a smaller block.
          </Text>
        </View>
      ))}

      {/* ═══ NOW ═══ */}
      <SectionLabel>NOW</SectionLabel>
      {today.nextAction?.now ? (
        <LinearGradient colors={Gradients.nowCard as [string, string]} style={styles.nowCardGradient}>
          <View style={styles.nowCard}>
            <View style={styles.nowGlow} />
            <Text style={styles.nowTitle}>{today.nextAction.now.task.title}</Text>
            <Text style={styles.nowDuration}>
              {formatMinutes(today.nextAction.now.minutesRemaining)} remaining
            </Text>
            <View style={styles.divider} />
            <Text style={styles.whyLabel}>WHY THIS, WHY NOW</Text>
            {today.nextAction.now.reasoning.map((f, i) => (
              <View key={i} style={styles.reasonRow}>
                <View style={styles.reasonDot} />
                <Text style={styles.reasonText}>
                  <Text style={styles.reasonBold}>{f.label}</Text> — {f.detail}
                </Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      ) : (
        <View style={styles.card}>
          <Text style={styles.openTimeText}>Nothing scheduled right now — open time.</Text>
        </View>
      )}

      {/* ═══ NEXT ═══ */}
      <SectionLabel>NEXT</SectionLabel>
      {today.nextAction?.next ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextTitle}>{today.nextAction.next.task.title}</Text>
          <Text style={styles.nextMeta}>
            {formatMinutes(today.nextAction.next.block.durationMinutes)} ·{" "}
            {today.nextAction.next.task.energyRequirement} energy
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardBody}>Nothing else planned today.</Text>
        </View>
      )}

      {/* ═══ ENERGY ═══ */}
      <SectionLabel>ENERGY LEVEL</SectionLabel>
      <View style={styles.energyRow}>
        {(["low", "medium", "high"] as Energy[]).map((level) => {
          const iconName = level === "low" ? "moon" : level === "medium" ? "sun" : "zap";
          const isActive = energy === level;
          return (
            <TouchableOpacity
              key={level}
              style={[styles.energyPill, isActive && styles.energyPillActive]}
              onPress={() => setEnergy(isActive ? undefined : level)}
            >
              <Feather name={iconName} size={15} color={isActive ? Colors.accent : Colors.textMuted} />
              <Text style={[styles.energyPillText, isActive && styles.energyPillTextActive]}>
                {level}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ═══ TODAY CAPACITY ═══ */}
      <SectionLabel>TODAY</SectionLabel>
      {today.capacity && (
        <View style={styles.capacityCard}>
          {/* Capacity arc visualization */}
          <View style={styles.capacityHeader}>
            <View>
              <Text style={styles.capacityStat}>{formatMinutes(today.capacity.usableMinutes)}</Text>
              <Text style={styles.capacityLabel}>usable time</Text>
            </View>
            <View style={styles.capacityRing}>
              <View style={styles.capacityRingBg}>
                <View
                  style={[
                    styles.capacityRingFill,
                    {
                      height: `${Math.round(capacityPct * 100)}%`,
                      backgroundColor:
                        capacityPct > 0.9
                          ? Colors.danger
                          : capacityPct > 0.7
                          ? Colors.warning
                          : Colors.accent
                    }
                  ]}
                />
              </View>
              <Text style={styles.capacityPct}>{Math.round(capacityPct * 100)}%</Text>
            </View>
          </View>

          <View style={styles.statGrid}>
            <StatPill label="Waking" value={formatMinutes(today.capacity.wakingMinutes)} />
            <StatPill
              label="Fixed"
              value={formatMinutes(today.capacity.fixedMinutes + today.capacity.travelMinutes)}
            />
            <StatPill label="Planned" value={formatMinutes(plannedMinutes)} />
            <StatPill label="Buffer" value={formatMinutes(today.capacity.bufferMinutes)} />
            <StatPill label="Deep work" value={formatMinutes(today.capacity.deepWorkMinutes)} />
            <StatPill label="Low energy" value={formatMinutes(today.capacity.lowEnergyMinutes)} />
          </View>
        </View>
      )}

      {/* ═══ TIMELINE ═══ */}
      {today.blocks.length > 0 && (
        <View style={styles.timelineCard}>
          <Text style={styles.timelineTitle}>Schedule</Text>
          {today.blocks
            .slice()
            .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
            .map((b, i) => {
              const task = today.tasks.find((t) => t.id === b.taskId);
              const isNow =
                today.nextAction?.now?.block.id === b.id;
              return (
                <View key={b.id} style={styles.timelineRow}>
                  <View style={styles.timelineDotCol}>
                    <View style={[styles.timelineDot, isNow && styles.timelineDotActive]} />
                    {i < today.blocks.length - 1 && <View style={styles.timelineLine} />}
                  </View>
                  <View style={styles.timelineContent}>
                    <Text style={[styles.timelineTime, isNow && { color: Colors.accent }]}>
                      {formatClock(b.startTime, user.timezone)} – {formatClock(b.endTime, user.timezone)}
                    </Text>
                    <Text style={[styles.timelineTask, isNow && { color: Colors.textPrimary }]}>
                      {task?.title ?? b.taskId}
                    </Text>
                    <Text style={styles.timelineDur}>{formatMinutes(b.durationMinutes)}</Text>
                  </View>
                </View>
              );
            })}
        </View>
      )}

      {/* ═══ UNSCHEDULED ═══ */}
      {today.unscheduledTaskIds.length > 0 && (
        <View style={styles.warningCard}>
          <View style={styles.warningTitleRow}>
            <Feather name="alert-triangle" size={15} color={Colors.warning} />
            <Text style={styles.warningTitle}>Cannot fit today</Text>
          </View>
          {today.unscheduledTaskIds.map((id) => {
            const task = today.tasks.find((t) => t.id === id);
            return (
              <Text key={id} style={styles.warningLine}>
                • {task?.title ?? id} ({task ? formatMinutes(task.estimatedMinutes) : "?"})
              </Text>
            );
          })}
        </View>
      )}

      {/* ═══ ASK PA ═══ */}
      <TouchableOpacity style={styles.askBar} onPress={onOpenChat} activeOpacity={0.7}>
        <Feather name="message-circle" size={17} color={Colors.textMuted} style={styles.askBarIcon} />
        <Text style={styles.askBarText}>Ask your PA…</Text>
        <Feather name="arrow-right" size={17} color={Colors.textMuted} />
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statPill}>
      <Text style={styles.statPillValue}>{value}</Text>
      <Text style={styles.statPillLabel}>{label}</Text>
    </View>
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
  greeting: { color: Colors.textPrimary, fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  dateSubtitle: { color: Colors.textMuted, fontSize: 14, marginTop: 4, marginBottom: 8 },

  // Empty state
  emptyCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    marginTop: 12
  },
  emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptyBody: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center", marginBottom: 16 },
  primaryButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  // Insight banners
  deadlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.25)"
  },
  driftBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(245, 158, 11, 0.1)",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)"
  },
  procBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(99, 102, 241, 0.08)",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(99, 102, 241, 0.2)"
  },
  bannerIcon: { marginRight: 10, marginTop: 2 },
  bannerText: { flex: 1, color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  bannerBold: { fontWeight: "700", color: Colors.textPrimary },

  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.8,
    marginTop: 24,
    marginBottom: 10
  },

  // NOW card
  nowCardGradient: { borderRadius: 22, marginBottom: 4 },
  nowCard: {
    borderRadius: 22,
    padding: 20,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    overflow: "hidden"
  },
  nowGlow: {
    position: "absolute",
    top: -40,
    right: -40,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(99, 102, 241, 0.15)"
  },
  nowTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: "800", letterSpacing: -0.3 },
  nowDuration: { color: Colors.accent, fontSize: 15, fontWeight: "600", marginTop: 6 },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 14 },
  whyLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 8
  },
  reasonRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
  reasonDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
    marginTop: 7,
    marginRight: 10
  },
  reasonText: { flex: 1, color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  reasonBold: { fontWeight: "600", color: Colors.textPrimary },

  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    padding: 18,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: Colors.border
  },
  cardBody: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  openTimeText: { color: Colors.textSecondary, fontSize: 15, textAlign: "center" },

  // NEXT card
  nextCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    padding: 18,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    borderLeftColor: Colors.deepEnergy
  },
  nextTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: "600" },
  nextMeta: { color: Colors.textMuted, fontSize: 13, marginTop: 4 },

  // Energy
  energyRow: { flexDirection: "row", gap: 10 },
  energyPill: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  energyPillActive: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  energyPillText: { color: Colors.textSecondary, fontSize: 13, textTransform: "capitalize" },
  energyPillTextActive: { color: Colors.textPrimary, fontWeight: "600" },

  // Capacity
  capacityCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 20,
    padding: 20,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: Colors.border
  },
  capacityHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  capacityStat: { color: Colors.textPrimary, fontSize: 32, fontWeight: "800", letterSpacing: -1 },
  capacityLabel: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
  capacityRing: { alignItems: "center", justifyContent: "center" },
  capacityRingBg: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.bgCardAlt,
    overflow: "hidden",
    justifyContent: "flex-end"
  },
  capacityRingFill: { width: "100%", borderRadius: 4 },
  capacityPct: { color: Colors.textMuted, fontSize: 11, fontWeight: "600", marginTop: 4 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statPill: {
    backgroundColor: Colors.bgCardAlt,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: "30%",
    flex: 1
  },
  statPillValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: "700" },
  statPillLabel: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },

  // Timeline
  timelineCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 20,
    padding: 20,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border
  },
  timelineTitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: 14
  },
  timelineRow: { flexDirection: "row", minHeight: 56 },
  timelineDotCol: { width: 20, alignItems: "center" },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.border,
    marginTop: 4
  },
  timelineDotActive: { backgroundColor: Colors.accent },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: Colors.border,
    marginTop: 4,
    marginBottom: 4
  },
  timelineContent: { flex: 1, paddingBottom: 14, paddingLeft: 10 },
  timelineTime: { color: Colors.textMuted, fontSize: 12, fontWeight: "600" },
  timelineTask: { color: Colors.textSecondary, fontSize: 15, fontWeight: "500", marginTop: 2 },
  timelineDur: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },

  // Warning
  warningCard: {
    backgroundColor: "rgba(245, 158, 11, 0.08)",
    borderRadius: 18,
    padding: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.25)"
  },
  warningTitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  warningTitle: { color: Colors.warning, fontSize: 15, fontWeight: "700" },
  warningLine: { color: Colors.textSecondary, fontSize: 13, marginBottom: 3, lineHeight: 19 },

  // Ask PA bar
  askBar: {
    marginTop: 28,
    backgroundColor: Colors.bgCardAlt,
    borderRadius: 26,
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center"
  },
  askBarIcon: { marginRight: 10 },
  askBarText: { flex: 1, color: Colors.textMuted, fontSize: 16 }
});
