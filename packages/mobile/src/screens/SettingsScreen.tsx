import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { Reminder } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { SqliteDataStore } from "../db/sqliteStore";
import { PressableScale } from "../components/PressableScale";
import { formatClock } from "../utils/format";

function formatReminderWhen(triggerAt: Date, timezone: string): string {
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysAhead = Math.round((startOfDay(triggerAt) - startOfDay(now)) / dayMs);
  const time = formatClock(triggerAt, timezone);
  if (daysAhead === 0) return `Today, ${time}`;
  if (daysAhead === 1) return `Tomorrow, ${time}`;
  if (daysAhead === -1) return `Yesterday, ${time}`;
  return `${triggerAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { store, user, refresh } = useAppState();
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("");
  const [wakeTime, setWakeTime] = useState("07:00");
  const [sleepTime, setSleepTime] = useState("23:00");
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [academiaEmail, setAcademiaEmail] = useState("");
  const [academiaPassword, setAcademiaPassword] = useState("");
  const [studentPortalNetId, setStudentPortalNetId] = useState("");
  const [studentPortalPassword, setStudentPortalPassword] = useState("");
  const [voiceEngine, setVoiceEngineState] = useState<"cloud" | "device">("cloud");

  useEffect(() => {
    if (!store || !user) return;
    setName(user.name);
    setWakeTime(user.preferredWakeTime ?? "07:00");
    setSleepTime(user.preferredSleepTime ?? "23:00");
    (async () => {
      const key = await store.getPreference("gemini_api_key");
      if (key) setApiKey(key);
      const offline = await store.getPreference("offline_only");
      setOfflineOnly(offline === "true");
      const savedEngine = await store.getPreference("voice_engine");
      if (savedEngine === "device" || savedEngine === "cloud") setVoiceEngineState(savedEngine);
      const academiaE = await store.getPreference("academia_email");
      if (academiaE) setAcademiaEmail(academiaE);
      const academiaP = await store.getPreference("academia_password");
      if (academiaP) setAcademiaPassword(academiaP);
      const spNetId = await store.getPreference("student_portal_netid");
      if (spNetId) setStudentPortalNetId(spNetId);
      const spPass = await store.getPreference("student_portal_password");
      if (spPass) setStudentPortalPassword(spPass);
    })();
    loadReminders();
  }, [store, user]);

  async function loadReminders() {
    if (!store) return;
    const all = await store.listReminders();
    setReminders(
      all.filter((r) => !r.fired).sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime())
    );
  }

  async function cancelReminder(id: string) {
    if (!store) return;
    await store.deleteReminder(id);
    setReminders((prev) => prev.filter((r) => r.id !== id));
    // Re-syncs the actual scheduled notifications (scheduleNotifications does
    // a full cancel-and-reschedule against current DataStore state), not just
    // the on-screen list.
    refresh();
  }

  async function resetLocalData() {
    Alert.alert(
      "Reset local data",
      "This permanently deletes every goal, project, task, calendar event, and history stored on this device. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: async () => {
            try {
              await SqliteDataStore.reset();
              if (Platform.OS === "web") {
                window.location.reload();
              } else {
                Alert.alert("Data cleared", "Close and reopen the app to finish resetting.");
              }
            } catch (e) {
              Alert.alert("Reset failed", String(e));
            }
          }
        }
      ]
    );
  }

  async function save() {
    if (!store || !user) return;
    // Wake/sleep time feed every capacity/free-time calculation in the app
    // (capacityEngine's parseLocalTimeOnDate) via naive "HH:MM".split(":") —
    // an unvalidated typo here doesn't error, it silently produces NaN that
    // propagates through the whole day's schedule with nothing visibly wrong
    // until numbers stop making sense. Catch it here instead.
    const timePattern = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(wakeTime.trim()) || !timePattern.test(sleepTime.trim())) {
      Alert.alert("Invalid time", 'Wake and sleep time must be in 24-hour "HH:MM" format, e.g. "07:00" or "23:30".');
      return;
    }
    setSaving(true);
    try {
      await store.setPreference("gemini_api_key", apiKey.trim());
      await store.setPreference("offline_only", offlineOnly ? "true" : "false");
      await store.setPreference("voice_engine", voiceEngine);
      await store.setPreference("academia_email", academiaEmail.trim());
      await store.setPreference("academia_password", academiaPassword);
      await store.setPreference("student_portal_netid", studentPortalNetId.trim());
      await store.setPreference("student_portal_password", studentPortalPassword);
      await store.saveUser({
        ...user,
        name: name.trim() || user.name,
        preferredWakeTime: wakeTime,
        preferredSleepTime: sleepTime
      });
      refresh();
      Alert.alert("Saved", "Settings updated.");
    } catch (e) {
      Alert.alert("Error", String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
        <PressableScale onPress={onClose} haptic="light">
          <Text style={styles.closeText}>Done</Text>
        </PressableScale>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Profile */}
        <Text style={styles.sectionLabel}>PROFILE</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.fieldInput}
              value={name}
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Wake time</Text>
            <TextInput
              style={styles.fieldInput}
              value={wakeTime}
              onChangeText={setWakeTime}
              placeholder="07:00"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Sleep time</Text>
            <TextInput
              style={styles.fieldInput}
              value={sleepTime}
              onChangeText={setSleepTime}
              placeholder="23:00"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
            />
          </View>
        </View>

        {/* In-app reminders — set via Jeeko ("remind me to X at 5pm"), managed here.
            Real alarms ("set an alarm for 7am") are a separate thing entirely — they
            go straight into the phone's own Clock app, not this list, so this footer
            has to say that explicitly or someone will set an "alarm" and never find it. */}
        <Text style={styles.sectionLabel}>REMINDERS</Text>
        {reminders.length === 0 ? (
          <Text style={styles.sectionFooter}>
            None set. Ask Jeeko to "remind me to X at 5pm" and it'll show up here. ("Set an alarm
            for 7am" is different — that goes straight into your phone's Clock app instead.)
          </Text>
        ) : (
          <View style={styles.card}>
            {reminders.map((r, i) => (
              <React.Fragment key={r.id}>
                {i > 0 && <View style={styles.separator} />}
                <View style={styles.reminderRow}>
                  <View style={styles.reminderText}>
                    <Text style={styles.fieldLabel} numberOfLines={1}>
                      {r.title}
                    </Text>
                    <Text style={styles.reminderWhen}>{formatReminderWhen(r.triggerAt, user?.timezone ?? "UTC")}</Text>
                  </View>
                  <PressableScale onPress={() => cancelReminder(r.id)} hitSlop={10} haptic="light" activeScale={0.85}>
                    <Feather name="x-circle" size={20} color={Colors.textMuted} />
                  </PressableScale>
                </View>
              </React.Fragment>
            ))}
          </View>
        )}
        {reminders.length > 0 && (
          <Text style={styles.sectionFooter}>
            Real alarms set with Jeeko live in your phone's Clock app instead — check there, not here.
          </Text>
        )}

        {/* AI */}
        <Text style={styles.sectionLabel}>AI ASSISTANT</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Gemini API Key</Text>
          </View>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="Enter your Gemini API key"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.separator} />
          <View style={styles.switchRow}>
            <Text style={styles.fieldLabel}>Offline-only mode</Text>
            <Switch
              value={offlineOnly}
              onValueChange={setOfflineOnly}
              trackColor={{ false: Colors.bgElevated, true: Colors.accentSoft }}
              thumbColor={offlineOnly ? Colors.accent : "#f4f4f4"}
            />
          </View>
          <View style={styles.separator} />
          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={styles.fieldLabel}>Voice Engine</Text>
              <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 2 }}>
                {voiceEngine === "cloud" ? "Natural AI Studio Voice (Gemini)" : "Fast Enhanced Device Voice (<50ms)"}
              </Text>
            </View>
            <Switch
              value={voiceEngine === "cloud"}
              onValueChange={(val) => setVoiceEngineState(val ? "cloud" : "device")}
              trackColor={{ false: Colors.bgElevated, true: Colors.accentSoft }}
              thumbColor={voiceEngine === "cloud" ? Colors.accent : "#f4f4f4"}
            />
          </View>
        </View>
        <Text style={styles.sectionFooter}>
          Get a free key at ai.google.dev. The key is stored locally on your device only. When
          offline-only is enabled, the PA uses deterministic local engines — no API calls.
        </Text>

        {/* Academia portal — timetable/attendance, so Jeeko can answer "when's my next class" */}
        <Text style={styles.sectionLabel}>ACADEMIA PORTAL</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Portal email</Text>
          </View>
          <TextInput
            style={styles.input}
            value={academiaEmail}
            onChangeText={setAcademiaEmail}
            placeholder="your.email@srmist.edu.in"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <TextInput
            style={[styles.input, { marginBottom: 4 }]}
            value={academiaPassword}
            onChangeText={setAcademiaPassword}
            placeholder="Portal password"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Text style={styles.sectionFooter}>
          Stored locally on your device only, sent directly to your own deployed scraper
          (jeeko.onrender.com) when Jeeko needs your timetable or attendance — never to Google or
          anywhere else.
        </Text>

        {/* SRM Student Portal (sp.srmist.edu.in) — attendance and marks */}
        <Text style={styles.sectionLabel}>SRM STUDENT PORTAL</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>NetID</Text>
          </View>
          <TextInput
            style={styles.input}
            value={studentPortalNetId}
            onChangeText={setStudentPortalNetId}
            placeholder="NetID (e.g. tr1201)"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, { marginBottom: 4 }]}
            value={studentPortalPassword}
            onChangeText={setStudentPortalPassword}
            placeholder="Portal / Email password"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Text style={styles.sectionFooter}>
          Used to fetch live attendance and marks from sp.srmist.edu.in. NetID is your email prefix without '@srmist.edu.in'. Stored locally on your device only.
        </Text>

        {/* Save */}
        <PressableScale
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          haptic="medium"
        >
          <Text style={styles.saveButtonText}>
            {saving ? "Saving…" : "Save Settings"}
          </Text>
        </PressableScale>

        {/* Danger zone */}
        <Text style={styles.sectionLabel}>DANGER ZONE</Text>
        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.fieldLabel}>Reset local data</Text>
          <Text style={styles.dangerHint}>
            Permanently deletes everything stored on this device — goals, projects, tasks,
            calendar, and history. Cannot be undone.
          </Text>
          <PressableScale style={styles.dangerButton} onPress={resetLocalData} haptic="medium">
            <Text style={styles.dangerButtonText}>Reset local data</Text>
          </PressableScale>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.separator
  },
  headerTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: "600", letterSpacing: -0.4 },
  closeText: { color: Colors.accent, fontWeight: "600", fontSize: 16 },
  body: { flex: 1 },

  // Section labels — Apple footnote style
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    letterSpacing: -0.08,
    textTransform: "uppercase",
    marginTop: 28,
    marginBottom: 8,
    marginLeft: 4
  },
  sectionFooter: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    marginLeft: 4,
    marginRight: 4
  },

  // Grouped inset card — Apple Settings style
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    paddingHorizontal: 16,
    ...CardShadow
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.separator
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 13
  },
  fieldLabel: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: "400"
  },
  fieldInput: {
    color: Colors.textSecondary,
    fontSize: 16,
    flex: 1,
    marginLeft: 12
  },
  input: {
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 12
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 13,
    gap: 12
  },
  reminderText: { flex: 1 },
  reminderWhen: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },

  // Save
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 28
  },
  saveButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },

  // Danger
  dangerCard: {
    paddingVertical: 16
  },
  dangerHint: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 14
  },
  dangerButton: {
    backgroundColor: "rgba(255, 69, 58, 0.1)",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center"
  },
  dangerButtonText: { color: Colors.danger, fontWeight: "600", fontSize: 15 }
});
