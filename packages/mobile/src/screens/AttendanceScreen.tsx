import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { PressableScale } from "../components/PressableScale";
import { fetchAndSaveSnapshot, getCachedSnapshotRaw, localDateKey, type CachedSchedule } from "../academia/classReminders";

function attendanceColor(pct: number): string {
  if (pct < 75) return Colors.danger;
  if (pct < 85) return Colors.warning;
  return Colors.success;
}

function formatSyncedWhen(dateKey: string, today: string): string {
  if (dateKey === today) return "Synced today";
  const [y, m, d] = dateKey.split("-").map(Number);
  const synced = new Date(y, m - 1, d);
  const [ty, tm, td] = today.split("-").map(Number);
  const daysAgo = Math.round((new Date(ty, tm - 1, td).getTime() - synced.getTime()) / 86400000);
  if (daysAgo === 1) return "Last synced yesterday";
  return `Last synced ${synced.toLocaleDateString(undefined, { month: "short", day: "numeric" })} (${daysAgo} days ago)`;
}

/**
 * A dedicated place to SEE the local academia cache directly — separate from
 * asking Jeeko — specifically so it's visible at a glance whether data has
 * actually been fetched and how fresh it is, not just trusted blind. Reads
 * the same cache get_academia_status reads (see academia/classReminders.ts);
 * "Refresh now" does the same live fetch the tool's forceRefresh path does.
 */
export function AttendanceScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { store, ready, version } = useAppState();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<CachedSchedule | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!store) return;
    const [email, password, spNetId, spPassword, cached] = await Promise.all([
      store.getPreference("academia_email"),
      store.getPreference("academia_password"),
      store.getPreference("student_portal_netid"),
      store.getPreference("student_portal_password"),
      getCachedSnapshotRaw(store)
    ]);
    setHasCredentials((!!email && !!password) || (!!spNetId && !!spPassword));
    setSnapshot(cached);
    setLoading(false);
  }, [store]);

  useEffect(() => {
    if (!store || !ready) return;
    load();
  }, [store, ready, version, load]);

  async function refreshNow() {
    if (!store) return;
    setRefreshing(true);
    setError(null);
    const result = await fetchAndSaveSnapshot(store, new Date());
    if ("error" in result) {
      setError(result.error);
    } else {
      setSnapshot(result.snapshot);
    }
    setRefreshing(false);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  const today = localDateKey(new Date());
  const isFresh = snapshot?.date === today;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: 20, paddingBottom: 50 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshNow} tintColor={Colors.accent} />}
    >
      <Text style={styles.title}>Attendance</Text>

      {!hasCredentials ? (
        <View style={styles.setupCard}>
          <Feather name="user-x" size={22} color={Colors.textMuted} />
          <Text style={styles.setupText}>
            Add your SRM Student Portal (or Academia) credentials in Settings so Jeeko can fetch your attendance.
          </Text>
          <PressableScale style={styles.setupButton} onPress={onOpenSettings} haptic="light">
            <Text style={styles.setupButtonText}>Open Settings</Text>
          </PressableScale>
        </View>
      ) : (
        <>
          {/* Sync status banner — the whole point of this screen */}
          <View style={[styles.syncBanner, isFresh ? styles.syncBannerFresh : styles.syncBannerStale]}>
            <Feather
              name={snapshot ? (isFresh ? "check-circle" : "alert-triangle") : "cloud-off"}
              size={16}
              color={snapshot ? (isFresh ? Colors.success : Colors.warning) : Colors.textMuted}
            />
            <Text style={[styles.syncText, { color: snapshot ? (isFresh ? Colors.success : Colors.warning) : Colors.textMuted }]}>
              {snapshot ? formatSyncedWhen(snapshot.date, today) : "Not fetched yet"}
            </Text>
            <PressableScale onPress={refreshNow} disabled={refreshing} haptic="light" style={styles.refreshButton}>
              {refreshing ? (
                <ActivityIndicator size="small" color={Colors.accent} />
              ) : (
                <Feather name="refresh-cw" size={16} color={Colors.accent} />
              )}
            </PressableScale>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {!snapshot ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No data cached yet. Pull down or tap the refresh icon above to fetch it.</Text>
            </View>
          ) : (
            <>
              {/* Overall */}
              <View style={styles.overallCard}>
                {snapshot.isAttendanceAvailable && snapshot.overallAttendancePercent !== null ? (
                  <>
                    <Text style={[styles.overallValue, { color: attendanceColor(snapshot.overallAttendancePercent) }]}>
                      {snapshot.overallAttendancePercent}%
                    </Text>
                    <Text style={styles.overallLabel}>overall attendance</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.overallUnavailable}>—</Text>
                    <Text style={styles.overallLabel}>attendance unavailable this fetch — try refreshing</Text>
                  </>
                )}
                {snapshot.dayOrder !== null && (
                  <Text style={styles.dayOrderText}>Today: Day Order {snapshot.dayOrder}</Text>
                )}
                {snapshot.isHoliday && <Text style={styles.dayOrderText}>Looks like a holiday today</Text>}
              </View>

              {/* Per-course */}
              {snapshot.attendanceByCourse.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>BY COURSE</Text>
                  <View style={styles.courseCard}>
                    {snapshot.attendanceByCourse.map((c, i) => (
                      <View key={`${c.title}_${i}`}>
                        {i > 0 && <View style={styles.separator} />}
                        <View style={styles.courseRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.courseTitle} numberOfLines={1}>
                              {c.title}
                            </Text>
                            <Text style={styles.courseMeta}>
                              {c.hoursConducted} conducted · {c.hoursAbsent} absent
                            </Text>
                          </View>
                          <Text style={[styles.coursePct, { color: attendanceColor(c.attendancePercent) }]}>
                            {c.attendancePercent}%
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, backgroundColor: Colors.bg, justifyContent: "center", alignItems: "center" },
  title: { color: Colors.textPrimary, fontSize: 34, fontWeight: "700", letterSpacing: 0.37, marginBottom: 20 },

  setupCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    gap: 12,
    ...CardShadow
  },
  setupText: { color: Colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  setupButton: { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20, marginTop: 4 },
  setupButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },

  syncBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 14
  },
  syncBannerFresh: { backgroundColor: "rgba(48, 209, 88, 0.1)" },
  syncBannerStale: { backgroundColor: "rgba(255, 214, 10, 0.08)" },
  syncText: { flex: 1, fontSize: 13, fontWeight: "600" },
  refreshButton: { padding: 4 },

  errorCard: {
    backgroundColor: "rgba(255, 69, 58, 0.08)",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14
  },
  errorText: { color: Colors.danger, fontSize: 13, lineHeight: 18 },

  emptyCard: { backgroundColor: Colors.bgCard, borderRadius: 16, padding: 22, alignItems: "center", ...CardShadow },
  emptyText: { color: Colors.textMuted, fontSize: 14, textAlign: "center", lineHeight: 20 },

  overallCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    marginBottom: 14,
    ...CardShadow
  },
  overallValue: { fontSize: 44, fontWeight: "800", fontVariant: ["tabular-nums"] },
  overallUnavailable: { fontSize: 44, fontWeight: "800", color: Colors.textMuted },
  overallLabel: { color: Colors.textMuted, fontSize: 13, marginTop: 4 },
  dayOrderText: { color: Colors.textSecondary, fontSize: 13, marginTop: 10 },

  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    letterSpacing: -0.08,
    textTransform: "uppercase",
    marginBottom: 8,
    marginLeft: 4
  },
  courseCard: { backgroundColor: Colors.bgCard, borderRadius: 14, paddingHorizontal: 16, ...CardShadow },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.separator },
  courseRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 10 },
  courseTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: "600" },
  courseMeta: { color: Colors.textMuted, fontSize: 12, marginTop: 3 },
  coursePct: { fontSize: 17, fontWeight: "700", fontVariant: ["tabular-nums"] }
});
