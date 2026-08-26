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
  TouchableOpacity,
  View
} from "react-native";
import { useAppState } from "../state/AppState";
import { Colors } from "../theme/colors";
import { SqliteDataStore } from "../db/sqliteStore";

export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { store, user, refresh } = useAppState();
  const [apiKey, setApiKey] = useState("");
  const [name, setName] = useState("");
  const [wakeTime, setWakeTime] = useState("07:00");
  const [sleepTime, setSleepTime] = useState("23:00");
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [saving, setSaving] = useState(false);

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
    })();
  }, [store, user]);

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
    setSaving(true);
    try {
      await store.setPreference("gemini_api_key", apiKey.trim());
      await store.setPreference("offline_only", offlineOnly ? "true" : "false");
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
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Profile */}
        <Text style={styles.sectionLabel}>PROFILE</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={Colors.textMuted}
          />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Wake time</Text>
              <TextInput
                style={styles.input}
                value={wakeTime}
                onChangeText={setWakeTime}
                placeholder="07:00"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <View style={{ width: 16 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>Sleep time</Text>
              <TextInput
                style={styles.input}
                value={sleepTime}
                onChangeText={setSleepTime}
                placeholder="23:00"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>
        </View>

        {/* AI */}
        <Text style={styles.sectionLabel}>AI ASSISTANT</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>Gemini API Key</Text>
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
          <Text style={styles.hint}>
            Get a free key at ai.google.dev. The key is stored locally on your device only.
          </Text>

          <View style={styles.switchRow}>
            <Text style={styles.fieldLabel}>Offline-only mode</Text>
            <Switch
              value={offlineOnly}
              onValueChange={setOfflineOnly}
              trackColor={{ false: Colors.bgCardAlt, true: Colors.accentSoft }}
              thumbColor={offlineOnly ? Colors.accent : Colors.textMuted}
            />
          </View>
          <Text style={styles.hint}>
            When enabled, the PA only uses deterministic local engines — no API calls.
          </Text>
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveButton, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? "Saving…" : "Save Settings"}
          </Text>
        </TouchableOpacity>

        {/* Danger zone */}
        <Text style={styles.sectionLabel}>DANGER ZONE</Text>
        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.fieldLabel}>Reset local data</Text>
          <Text style={styles.hint}>
            Permanently deletes everything stored on this device — goals, projects, tasks,
            calendar, and history. Cannot be undone.
          </Text>
          <TouchableOpacity style={styles.dangerButton} onPress={resetLocalData}>
            <Text style={styles.dangerButtonText}>Reset local data</Text>
          </TouchableOpacity>
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
    borderBottomColor: Colors.border
  },
  headerTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: "700" },
  closeText: { color: Colors.accent, fontWeight: "600", fontSize: 15 },
  body: { flex: 1 },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 20,
    marginBottom: 10
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 4
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6
  },
  input: {
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12
  },
  hint: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12
  },
  row: { flexDirection: "row" },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
    marginTop: 4
  },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24
  },
  saveButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  dangerCard: { borderColor: "rgba(239, 68, 68, 0.3)" },
  dangerButton: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)"
  },
  dangerButtonText: { color: Colors.danger, fontWeight: "700", fontSize: 14 }
});
