import React, { useRef, useState } from "react";
import { Animated, Modal, SafeAreaView, StatusBar, StyleSheet, Text, View } from "react-native";
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
import { PressableScale } from "./src/components/PressableScale";
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

  const fade = useRef(new Animated.Value(1)).current;

  function selectTab(next: Tab) {
    if (next === tab) return;
    fade.setValue(0);
    setTab(next);
    Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bg} />

      {/* Top header bar — clean, minimal */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>Jeeko</Text>
        <View style={styles.topBarActions}>
          <PressableScale onPress={() => setCalendarOpen(true)} haptic="light" style={styles.topBarButton}>
            <Feather name="calendar" size={20} color={Colors.textSecondary} />
          </PressableScale>
          <PressableScale onPress={() => setSettingsOpen(true)} haptic="light" style={styles.topBarButton}>
            <Feather name="settings" size={20} color={Colors.textSecondary} />
          </PressableScale>
        </View>
      </View>

      {/* Screen content */}
      <Animated.View style={[styles.body, { opacity: fade }]}>
        {tab === "home" && <HomeScreen onOpenChat={() => setChatOpen(true)} />}
        {tab === "week" && <WeekScreen />}
        {tab === "goals" && <GoalsScreen />}
        {tab === "tasks" && <TasksScreen />}
        {tab === "review" && <ReviewScreen />}
      </Animated.View>

      {/* Bottom tab bar — Apple-style with labels */}
      <View style={styles.tabBar}>
        {TABS.map((t) => {
          const isActive = tab === t.key;
          return (
            <PressableScale
              key={t.key}
              style={styles.tabButton}
              onPress={() => selectTab(t.key)}
              haptic="selection"
              activeScale={0.88}
            >
              <Feather
                name={t.icon}
                size={22}
                color={isActive ? Colors.accent : Colors.textMuted}
              />
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                {t.label}
              </Text>
            </PressableScale>
          );
        })}
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

  // Header — clean, no borders
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  topBarTitle: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.4
  },
  topBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center"
  },

  body: { flex: 1 },

  // Tab bar — Apple style with labels
  tabBar: {
    flexDirection: "row",
    backgroundColor: "rgba(28, 28, 30, 0.92)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.separator,
    paddingTop: 6,
    paddingBottom: 2
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
    gap: 2
  },
  tabLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "500"
  },
  tabLabelActive: {
    color: Colors.accent,
    fontWeight: "600"
  }
});
