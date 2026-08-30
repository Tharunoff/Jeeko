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
import { executeTool, type CalendarEvent } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { formatClock } from "../utils/format";
import { PressableScale } from "./PressableScale";

const EVENT_TYPES: Array<{ key: string; label: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { key: "class", label: "Class", icon: "book-open" },
  { key: "meeting", label: "Meeting", icon: "users" },
  { key: "meal", label: "Meal", icon: "coffee" },
  { key: "travel", label: "Travel", icon: "navigation" },
  { key: "appointment", label: "Appointment", icon: "clipboard" },
  { key: "other", label: "Other", icon: "activity" }
];

export function CalendarEventsEditor({ onClose }: { onClose: () => void }) {
  const { store, user, ready, version, refresh } = useAppState();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [eventType, setEventType] = useState<string>("meeting");

  useEffect(() => {
    if (!store || !ready) return;
    (async () => {
      const all = await store.listCalendarEvents();
      // Sort by start time
      setEvents(
        all.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      );
    })();
  }, [store, ready, version]);

  async function addEvent() {
    if (!store || !title.trim() || !startTime.trim() || !endTime.trim()) {
      Alert.alert("Fill in all fields");
      return;
    }
    try {
      await executeTool(
        "create_calendar_event",
        {
          title: title.trim(),
          startTime: startTime.trim(),
          endTime: endTime.trim(),
          type: eventType,
          fixed: true
        },
        { store, now: new Date() }
      );
      setTitle("");
      setStartTime("");
      setEndTime("");
      setAdding(false);
      refresh();
    } catch (e) {
      Alert.alert("Error", String(e));
    }
  }

  async function deleteEvent(id: string) {
    if (!store) return;
    await store.deleteCalendarEvent(id);
    refresh();
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayEvents = events.filter(
    (e) => new Date(e.startTime).toISOString().slice(0, 10) === todayStr
  );
  const futureEvents = events.filter(
    (e) => new Date(e.startTime).toISOString().slice(0, 10) > todayStr
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Commitments</Text>
        <PressableScale onPress={onClose} haptic="light">
          <Text style={styles.closeText}>Done</Text>
        </PressableScale>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={styles.hint}>
          Classes, meetings, meals, travel — anything that blocks time in your schedule.
        </Text>

        {/* Today */}
        {todayEvents.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>TODAY</Text>
            <View style={styles.eventGroup}>
              {todayEvents.map((e, idx) => (
                <View key={e.id}>
                  <EventCard
                    event={e}
                    timezone={user?.timezone ?? "UTC"}
                    onDelete={() => deleteEvent(e.id)}
                  />
                  {idx < todayEvents.length - 1 && <View style={styles.eventSeparator} />}
                </View>
              ))}
            </View>
          </>
        )}

        {/* Future */}
        {futureEvents.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>UPCOMING</Text>
            <View style={styles.eventGroup}>
              {futureEvents.map((e, idx) => (
                <View key={e.id}>
                  <EventCard
                    event={e}
                    timezone={user?.timezone ?? "UTC"}
                    onDelete={() => deleteEvent(e.id)}
                  />
                  {idx < futureEvents.length - 1 && <View style={styles.eventSeparator} />}
                </View>
              ))}
            </View>
          </>
        )}

        {events.length === 0 && !adding && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No fixed commitments yet.</Text>
            <Text style={styles.emptySubtext}>
              Add classes, meetings, and other blocked time so the PA can schedule around them.
            </Text>
          </View>
        )}

        {/* Add form */}
        {adding ? (
          <View style={styles.addCard}>
            <TextInput
              style={styles.input}
              placeholder="Event title (e.g., CN Class)"
              placeholderTextColor={Colors.textMuted}
              value={title}
              onChangeText={setTitle}
              autoFocus
            />
            <View style={styles.formRow}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Start (YYYY-MM-DDThh:mm)"
                placeholderTextColor={Colors.textMuted}
                value={startTime}
                onChangeText={setStartTime}
              />
              <View style={{ width: 8 }} />
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="End (YYYY-MM-DDThh:mm)"
                placeholderTextColor={Colors.textMuted}
                value={endTime}
                onChangeText={setEndTime}
              />
            </View>

            {/* Type selector */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.typeScroll}
              contentContainerStyle={{ gap: 8 }}
            >
              {EVENT_TYPES.map((t) => (
                <PressableScale
                  key={t.key}
                  style={[styles.typePill, eventType === t.key && styles.typePillActive]}
                  onPress={() => setEventType(t.key)}
                  haptic="selection"
                  activeScale={0.94}
                >
                  <Feather name={t.icon} size={13} color={eventType === t.key ? Colors.accent : Colors.textMuted} />
                  <Text style={[styles.typeText, eventType === t.key && styles.typeTextActive]}>
                    {t.label}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>

            <View style={styles.formActions}>
              <PressableScale onPress={() => setAdding(false)} haptic="light">
                <Text style={styles.cancelText}>Cancel</Text>
              </PressableScale>
              <PressableScale style={styles.saveButton} onPress={addEvent} haptic="medium">
                <Text style={styles.saveButtonText}>Add Event</Text>
              </PressableScale>
            </View>
          </View>
        ) : (
          <PressableScale style={styles.addButton} onPress={() => setAdding(true)} haptic="light">
            <Text style={styles.addButtonText}>+ Add commitment</Text>
          </PressableScale>
        )}
      </ScrollView>
    </View>
  );
}

function EventCard({
  event,
  timezone,
  onDelete
}: {
  event: CalendarEvent;
  timezone: string;
  onDelete: () => void;
}) {
  const typeInfo = EVENT_TYPES.find((t) => t.key === event.type);
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventLeft}>
        <Feather name={typeInfo?.icon ?? "map-pin"} size={18} color={Colors.accent} />
      </View>
      <View style={styles.eventContent}>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <Text style={styles.eventTime}>
          {formatClock(new Date(event.startTime), timezone)} –{" "}
          {formatClock(new Date(event.endTime), timezone)}
        </Text>
        <Text style={styles.eventType}>{event.type} · {event.fixed ? "fixed" : "flexible"}</Text>
      </View>
      <PressableScale onPress={onDelete} style={styles.deleteButton} haptic="light" activeScale={0.85}>
        <Feather name="x" size={14} color={Colors.textMuted} />
      </PressableScale>
    </View>
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
  hint: { color: Colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 16 },

  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    letterSpacing: -0.08,
    textTransform: "uppercase",
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4
  },

  // Event cards — grouped
  eventGroup: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    paddingHorizontal: 16,
    ...CardShadow
  },
  eventSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.separator
  },
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14
  },
  eventLeft: { marginRight: 14 },
  eventContent: { flex: 1 },
  eventTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: "600" },
  eventTime: { color: Colors.accent, fontSize: 13, marginTop: 3 },
  eventType: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  deleteButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.bgCardAlt,
    alignItems: "center",
    justifyContent: "center"
  },

  // Empty state
  emptyState: { alignItems: "center", paddingVertical: 36 },
  emptyText: { color: Colors.textSecondary, fontSize: 17, fontWeight: "600" },
  emptySubtext: { color: Colors.textMuted, fontSize: 14, textAlign: "center", marginTop: 8, lineHeight: 20 },

  // Form
  addCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    ...CardShadow
  },
  input: {
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 10
  },
  formRow: { flexDirection: "row" },
  typeScroll: { marginBottom: 14 },
  typePill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.bgCardAlt,
    flexDirection: "row",
    alignItems: "center",
    gap: 5
  },
  typePillActive: { backgroundColor: Colors.accentSoft },
  typeText: { color: Colors.textSecondary, fontSize: 13 },
  typeTextActive: { color: Colors.accent, fontWeight: "600" },
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cancelText: { color: Colors.textMuted, fontSize: 15, fontWeight: "500" },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 22
  },
  saveButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  addButton: { alignItems: "center", paddingVertical: 18, marginTop: 16 },
  addButtonText: { color: Colors.accent, fontWeight: "700", fontSize: 16 }
});
