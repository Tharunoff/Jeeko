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
import { executeTool, type CalendarEvent } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors } from "../theme/colors";
import { formatClock } from "../utils/format";

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
        <Text style={styles.headerTitle}>Fixed Commitments</Text>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={styles.hint}>
          Classes, meetings, meals, travel — anything that blocks time in your schedule.
        </Text>

        {/* Today */}
        {todayEvents.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>TODAY</Text>
            {todayEvents.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                timezone={user?.timezone ?? "UTC"}
                onDelete={() => deleteEvent(e.id)}
              />
            ))}
          </>
        )}

        {/* Future */}
        {futureEvents.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>UPCOMING</Text>
            {futureEvents.map((e) => (
              <EventCard
                key={e.id}
                event={e}
                timezone={user?.timezone ?? "UTC"}
                onDelete={() => deleteEvent(e.id)}
              />
            ))}
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
              contentContainerStyle={{ gap: 6 }}
            >
              {EVENT_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.typePill, eventType === t.key && styles.typePillActive]}
                  onPress={() => setEventType(t.key)}
                >
                  <Feather name={t.icon} size={13} color={eventType === t.key ? Colors.accent : Colors.textMuted} />
                  <Text style={[styles.typeText, eventType === t.key && styles.typeTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.formActions}>
              <TouchableOpacity onPress={() => setAdding(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={addEvent}>
                <Text style={styles.saveButtonText}>Add Event</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.addButton} onPress={() => setAdding(true)}>
            <Text style={styles.addButtonText}>+ Add commitment</Text>
          </TouchableOpacity>
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
      <TouchableOpacity onPress={onDelete} style={styles.deleteButton}>
        <Feather name="x" size={13} color={Colors.textMuted} />
      </TouchableOpacity>
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
    borderBottomColor: Colors.border
  },
  headerTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: "700" },
  closeText: { color: Colors.accent, fontWeight: "600", fontSize: 15 },
  body: { flex: 1 },
  hint: { color: Colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: 12 },
  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 16,
    marginBottom: 10
  },

  // Event cards
  eventCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border
  },
  eventLeft: { marginRight: 12 },
  eventContent: { flex: 1 },
  eventTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: "600" },
  eventTime: { color: Colors.accent, fontSize: 12, marginTop: 3 },
  eventType: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.bgCardAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  // Empty state
  emptyState: { alignItems: "center", paddingVertical: 30 },
  emptyText: { color: Colors.textSecondary, fontSize: 16, fontWeight: "600" },
  emptySubtext: { color: Colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },

  // Form
  addCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    padding: 18,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.border
  },
  input: {
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10
  },
  formRow: { flexDirection: "row" },
  typeScroll: { marginBottom: 12 },
  typePill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: Colors.bgCardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  typePillActive: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  typeText: { color: Colors.textSecondary, fontSize: 12 },
  typeTextActive: { color: Colors.textPrimary, fontWeight: "600" },
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cancelText: { color: Colors.textMuted, fontSize: 14 },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20
  },
  saveButtonText: { color: "#fff", fontWeight: "700" },
  addButton: { alignItems: "center", paddingVertical: 14, marginTop: 12 },
  addButtonText: { color: Colors.accent, fontWeight: "700", fontSize: 15 }
});
