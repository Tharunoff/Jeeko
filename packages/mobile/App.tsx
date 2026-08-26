import React, { useState } from "react";
import { Modal, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { AppStateProvider } from "./src/state/AppState";
import { HomeScreen } from "./src/screens/HomeScreen";
import { WeekScreen } from "./src/screens/WeekScreen";
import { GoalsScreen } from "./src/screens/GoalsScreen";
import { TasksScreen } from "./src/screens/TasksScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { CalendarEventsEditor } from "./src/components/CalendarEventsEditor";
import { Colors } from "./src/theme/colors";

type Tab = "home" | "week" | "goals" | "tasks" | "review";

const TABS: Array<{ key: Tab; label: string; icon: React.ComponentProps<typeof Feather>["name"] }> = [
  { key: "home", label: "Home", icon: "home" },
  { key: "week", label: "Week", icon: "calendar" },
  { key: "goals", label: "Goals", icon: "target" },
  { key: "tasks", label: "Tasks", icon: "check-square" },
  { key: "review", label: "Review", icon: "bar-chart-2" }
];

function MainNavigator() {
  const [tab, setTab] = useState<Tab>("home");
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Top header bar */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>PersonalOS</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TouchableOpacity style={styles.settingsButton} onPress={() => setCalendarOpen(true)}>
            <Feather name="calendar" size={17} color={Colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.settingsButton} onPress={() => setSettingsOpen(true)}>
            <Feather name="settings" size={17} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Screen content */}
      <View style={styles.body}>
        {tab === "home" && <HomeScreen onOpenChat={() => setChatOpen(true)} />}
        {tab === "week" && <WeekScreen />}
        {tab === "goals" && <GoalsScreen />}
        {tab === "tasks" && <TasksScreen />}
        {tab === "review" && <ReviewScreen />}
      </View>

      {/* Bottom tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabButton, tab === t.key && styles.tabButtonActive]}
            onPress={() => setTab(t.key)}
          >
            <Feather
              name={t.icon}
              size={19}
              color={tab === t.key ? Colors.accent : Colors.textMuted}
              style={styles.tabIcon}
            />
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Chat modal */}
      <Modal visible={chatOpen} animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <ChatScreen onClose={() => setChatOpen(false)} />
      </Modal>

      {/* Settings modal */}
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <SettingsScreen onClose={() => setSettingsOpen(false)} />
      </Modal>

      {/* Calendar modal */}
      <Modal visible={calendarOpen} animationType="slide" onRequestClose={() => setCalendarOpen(false)}>
        <CalendarEventsEditor onClose={() => setCalendarOpen(false)} />
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <MainNavigator />
    </AppStateProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border
  },
  topBarTitle: {
    color: Colors.accent,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.3
  },
  settingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bgCard,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border
  },
  body: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgCard,
    paddingBottom: 4
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  tabButtonActive: {},
  tabIcon: { marginBottom: 2 },
  tabLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: "600" },
  tabLabelActive: { color: Colors.accent }
});
