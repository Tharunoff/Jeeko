import React, { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { detectGoalDrift, detectProcrastination, formatMinutes } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { useToday } from "../hooks/useToday";
import { Colors, CardShadow } from "../theme/colors";
import { formatClock } from "../utils/format";
import { PressableScale } from "../components/PressableScale";
import { FadeInUp } from "../components/FadeInUp";
import { VoiceOrb } from "../components/VoiceOrb";
import { useVoiceSession } from "../hooks/useVoiceSession";

type Energy = "low" | "medium" | "high";
const ENERGY_OPTIONS: Energy[] = ["low", "medium", "high"];
const ENERGY_ICON: Record<Energy, React.ComponentProps<typeof Feather>["name"]> = {
  low: "moon",
  medium: "sun",
  high: "zap"
};
const ENERGY_LABEL: Record<Energy, string> = {
  low: "Low",
  medium: "Med",
  high: "High"
};

/**
 * Jeeko-first home: the orb is the whole point of the screen — everything else is
 * one quiet "Today" summary you open only if you want it, not six cards fighting
 * for attention above the fold. Talk to Jeeko for anything that isn't already
 * sitting right here.
 */
export function HomeScreen({ onOpenChat }: { onOpenChat: () => void }) {
  const { user, store, seed, version, hasGemini } = useAppState();
  const [energy, setEnergy] = useState<Energy | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const today = useToday(energy);
  const voice = useVoiceSession();
  const [insights, setInsights] = useState<{
    procrastination: Array<{ title: string; postponedCount: number }>;
    goalDrift?: string;
    deadlines: Array<{ title: string; hoursLeft: number }>;
  }>({ procrastination: [], deadlines: [] });

  React.useEffect(() => {
    if (!store || !user) return;
    (async () => {
      const [tasks, decisions, goals, timeLogs] = await Promise.all([
        store.listTasks(),
        store.listDecisions(),
        store.listGoals(),
        store.listTimeLogs()
      ]);
      const procFlags = detectProcrastination(decisions, tasks);
      const drift = detectGoalDrift({ timeLogs, tasks, goals, now: new Date() });
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
      </View>
    );
  }

  const hasAnyTasks = today.tasks.length > 0;
  const plannedMinutes = today.blocks.reduce((s, b) => s + b.durationMinutes, 0);
  const capacityPct = today.capacity ? Math.min(1, plannedMinutes / Math.max(1, today.capacity.usableMinutes)) : 0;
  const alertCount = insights.deadlines.length + insights.procrastination.length + (insights.goalDrift ? 1 : 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 }}>
      {/* ═══ JEEKO — the whole point of this screen ═══ */}
      <View style={styles.voiceSection}>
        <VoiceOrb state={voice.state} onPress={voice.tapOrb} />
        <Text style={styles.voiceStateLabel}>
          {voice.state === "idle" && (voice.sessionActive ? "Tap to continue" : "Tap to talk to Jeeko")}
          {voice.state === "listening" && `Listening… ${(voice.recordingMs / 1000).toFixed(0)}s`}
          {voice.state === "thinking" && "Thinking…"}
          {voice.state === "speaking" && "Speaking — tap to interrupt"}
        </Text>

        {/* Energy pills */}
        <View style={styles.energyRow}>
          {ENERGY_OPTIONS.map((level) => {
            const isActive = energy === level;
            return (
              <PressableScale
                key={level}
                style={[styles.energyPill, isActive && styles.energyPillActive]}
                onPress={() => setEnergy(isActive ? undefined : level)}
                haptic="selection"
                activeScale={0.9}
              >
                <Feather name={ENERGY_ICON[level]} size={13} color={isActive ? Colors.accent : Colors.textMuted} />
                <Text style={[styles.energyPillText, isActive && styles.energyPillTextActive]}>
                  {ENERGY_LABEL[level]}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        {!hasGemini && <Text style={styles.voiceHint}>Add a Gemini API key in Settings to talk to Jeeko.</Text>}

        {(voice.lastUserText || voice.lastReplyText) && (
          <FadeInUp style={styles.voiceTranscript}>
            {voice.lastUserText && <Text style={styles.voiceYou}>You: {voice.lastUserText}</Text>}
            {voice.lastReplyText && <Text style={styles.voiceReply}>{voice.lastReplyText}</Text>}
          </FadeInUp>
        )}

        {voice.sessionActive && (
          <PressableScale onPress={voice.endSession} haptic="light">
            <Text style={styles.endSessionText}>End conversation</Text>
          </PressableScale>
        )}
      </View>

      {/* ═══ TODAY — one quiet summary, everything else is a tap away ═══ */}
      {hasAnyTasks ? (
        <PressableScale style={styles.todayCard} onPress={() => setExpanded((e) => !e)} haptic="light" activeScale={0.99}>
          <View style={styles.todayTopRow}>
            <View style={{ flex: 1 }}>
              {today.nextAction?.now ? (
                <>
                  <View style={styles.liveRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveLabel}>NOW</Text>
                  </View>
                  <Text style={styles.todayNowTitle}>{today.nextAction.now.task.title}</Text>
                  <Text style={styles.todayNowMeta}>{formatMinutes(today.nextAction.now.minutesRemaining)} remaining</Text>
                </>
              ) : (
                <Text style={styles.todayNowTitle}>Open time right now</Text>
              )}
            </View>
            {alertCount > 0 && (
              <View style={styles.alertBadge}>
                <Feather name="alert-triangle" size={11} color={Colors.warning} />
                <Text style={styles.alertBadgeText}>{alertCount}</Text>
              </View>
            )}
            <Feather name={expanded ? "chevron-up" : "chevron-down"} size={18} color={Colors.textMuted} style={{ marginLeft: 8 }} />
          </View>

          {/* Progress bar */}
          <View style={styles.barTrack}>
            <View
              style={[
                styles.barFill,
                {
                  width: `${Math.round(capacityPct * 100)}%`,
                  backgroundColor: capacityPct > 0.9 ? Colors.danger : capacityPct > 0.7 ? Colors.warning : Colors.accent
                }
              ]}
            />
          </View>
          <Text style={styles.barCaption}>
            {formatMinutes(plannedMinutes)} planned of {today.capacity ? formatMinutes(today.capacity.usableMinutes) : "—"} usable
            {today.nextAction?.next ? ` · next: ${today.nextAction.next.task.title}` : ""}
          </Text>

          {expanded && (
            <View style={styles.expandedArea}>
              {today.nextAction?.now && (
                <View style={styles.whyBlock}>
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
              )}

              {insights.deadlines.map((d, i) => (
                <View key={`dl_${i}`} style={styles.alertLine}>
                  <Feather name="clock" size={13} color={Colors.danger} />
                  <Text style={styles.alertText}>
                    <Text style={styles.alertBold}>{d.title}</Text> due in ~{d.hoursLeft}h
                  </Text>
                </View>
              ))}
              {insights.goalDrift && (
                <View style={styles.alertLine}>
                  <Feather name="alert-triangle" size={13} color={Colors.warning} />
                  <Text style={styles.alertText}>{insights.goalDrift}</Text>
                </View>
              )}
              {insights.procrastination.map((p, i) => (
                <View key={`proc_${i}`} style={styles.alertLine}>
                  <Feather name="repeat" size={13} color={Colors.accent} />
                  <Text style={styles.alertText}>
                    <Text style={styles.alertBold}>{p.title}</Text> postponed {p.postponedCount}× — try a smaller block.
                  </Text>
                </View>
              ))}

              {today.capacity && (
                <View style={styles.statRow}>
                  <Stat label="Waking" value={formatMinutes(today.capacity.wakingMinutes)} />
                  <Stat label="Fixed" value={formatMinutes(today.capacity.fixedMinutes + today.capacity.travelMinutes)} />
                  <Stat label="Buffer" value={formatMinutes(today.capacity.bufferMinutes)} />
                </View>
              )}

              {today.blocks.length > 0 && (
                <View style={styles.timeline}>
                  {today.blocks
                    .slice()
                    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
                    .map((b) => {
                      const task = today.tasks.find((t) => t.id === b.taskId);
                      const isNow = today.nextAction?.now?.block.id === b.id;
                      return (
                        <View key={b.id} style={styles.timelineRow}>
                          <Text style={[styles.timelineTime, isNow && { color: Colors.accent }]}>
                            {formatClock(b.startTime, user.timezone)}
                          </Text>
                          <Text style={[styles.timelineTask, isNow && { color: Colors.textPrimary, fontWeight: "600" }]} numberOfLines={1}>
                            {task?.title ?? b.taskId}
                          </Text>
                          <Text style={styles.timelineDur}>{formatMinutes(b.durationMinutes)}</Text>
                        </View>
                      );
                    })}
                </View>
              )}

              {today.unscheduledTaskIds.length > 0 && (
                <View style={styles.cannotFit}>
                  <Text style={styles.cannotFitTitle}>Can't fit today</Text>
                  {today.unscheduledTaskIds.map((id) => {
                    const task = today.tasks.find((t) => t.id === id);
                    return (
                      <Text key={id} style={styles.cannotFitLine}>
                        • {task?.title ?? id}
                      </Text>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </PressableScale>
      ) : (
        <View style={styles.emptyRow}>
          <Text style={styles.emptyText}>Tell Jeeko what's on your plate to get started.</Text>
          <PressableScale onPress={seed} haptic="light">
            <Text style={styles.emptyLink}>Load sample data</Text>
          </PressableScale>
        </View>
      )}

      {/* ═══ TYPE INSTEAD ═══ */}
      <PressableScale style={styles.askBar} onPress={onOpenChat} haptic="medium" activeScale={0.98}>
        <Feather name="message-circle" size={16} color={Colors.textMuted} style={styles.askBarIcon} />
        <Text style={styles.askBarText}>Message Jeeko…</Text>
      </PressableScale>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, backgroundColor: Colors.bg, justifyContent: "center", alignItems: "center" },

  // Voice hero
  voiceSection: { alignItems: "center", paddingVertical: 16, gap: 14 },
  voiceStateLabel: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontWeight: "500",
    letterSpacing: -0.2
  },
  energyRow: { flexDirection: "row", gap: 10 },
  energyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: Colors.bgCard
  },
  energyPillActive: {
    backgroundColor: Colors.accentSoft
  },
  energyPillText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "500"
  },
  energyPillTextActive: {
    color: Colors.accent,
    fontWeight: "600"
  },
  voiceHint: { color: Colors.textMuted, fontSize: 13, textAlign: "center", maxWidth: 260 },
  voiceTranscript: {
    width: "100%",
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    gap: 6,
    ...CardShadow
  },
  voiceYou: { color: Colors.textMuted, fontSize: 13, fontStyle: "italic" },
  voiceReply: { color: Colors.textPrimary, fontSize: 15, lineHeight: 22 },
  endSessionText: { color: Colors.textMuted, fontSize: 14, fontWeight: "600", textDecorationLine: "underline" },

  // Today card
  todayCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    ...CardShadow
  },
  todayTopRow: { flexDirection: "row", alignItems: "flex-start" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  liveDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: Colors.success },
  liveLabel: { color: Colors.success, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  todayNowTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: "600", letterSpacing: -0.4 },
  todayNowMeta: { color: Colors.accent, fontSize: 14, fontWeight: "500", marginTop: 3 },
  alertBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255, 214, 10, 0.12)",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  alertBadgeText: { color: Colors.warning, fontSize: 12, fontWeight: "700" },

  barTrack: { height: 8, borderRadius: 4, backgroundColor: Colors.bgCardAlt, marginTop: 16, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  barCaption: { color: Colors.textMuted, fontSize: 13, marginTop: 8, letterSpacing: -0.1 },

  expandedArea: { marginTop: 18, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.separator, gap: 16 },
  whyBlock: {},
  whyLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" },
  reasonRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 6 },
  reasonDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent, marginTop: 7, marginRight: 10 },
  reasonText: { flex: 1, color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  reasonBold: { fontWeight: "600", color: Colors.textPrimary },

  alertLine: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  alertText: { flex: 1, color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  alertBold: { fontWeight: "700", color: Colors.textPrimary },

  statRow: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, backgroundColor: Colors.bgCardAlt, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  statValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: "700" },
  statLabel: { color: Colors.textMuted, fontSize: 11, marginTop: 3 },

  timeline: { gap: 10 },
  timelineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 2
  },
  timelineTime: { color: Colors.textMuted, fontSize: 13, width: 60, fontVariant: ["tabular-nums"] },
  timelineTask: { flex: 1, color: Colors.textSecondary, fontSize: 14 },
  timelineDur: { color: Colors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] },

  cannotFit: {
    backgroundColor: "rgba(255, 214, 10, 0.06)",
    borderRadius: 12,
    padding: 14
  },
  cannotFitTitle: { color: Colors.warning, fontSize: 13, fontWeight: "600", marginBottom: 6 },
  cannotFitLine: { color: Colors.textSecondary, fontSize: 14, marginTop: 2 },

  // Empty state
  emptyRow: { alignItems: "center", gap: 8, marginTop: 24 },
  emptyText: { color: Colors.textMuted, fontSize: 15, textAlign: "center" },
  emptyLink: { color: Colors.accent, fontSize: 15, fontWeight: "600" },

  // Message bar
  askBar: {
    marginTop: 24,
    backgroundColor: Colors.bgCard,
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center"
  },
  askBarIcon: { marginRight: 8 },
  askBarText: { color: Colors.textMuted, fontSize: 15 }
});
