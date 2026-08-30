import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { executeTool, type Goal, type Project } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { PressableScale } from "../components/PressableScale";

export function GoalsScreen() {
  const { store, ready, version, refresh } = useAppState();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [addingGoal, setAddingGoal] = useState(false);
  const [addingProject, setAddingProject] = useState<string | null>(null); // goal ID for which project is being added
  const [newTitle, setNewTitle] = useState("");
  const [projectTitle, setProjectTitle] = useState("");

  useEffect(() => {
    if (!store || !ready) return;
    (async () => {
      setGoals(await store.listGoals());
      setProjects(await store.listProjects());
    })();
  }, [store, ready, version]);

  async function addGoal() {
    if (!store || !newTitle.trim()) return;
    await executeTool("create_goal", { title: newTitle.trim() }, { store, now: new Date() });
    setNewTitle("");
    setAddingGoal(false);
    refresh();
  }

  async function addProject(goalId: string) {
    if (!store || !projectTitle.trim()) return;
    await executeTool(
      "create_project",
      { title: projectTitle.trim(), goalIds: [goalId] },
      { store, now: new Date() }
    );
    setProjectTitle("");
    setAddingProject(null);
    refresh();
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 20, paddingBottom: 50 }}>
      <Text style={styles.title}>Goals</Text>
      <Text style={styles.subtitle}>
        {goals.filter((g) => g.status === "active").length} active goals ·{" "}
        {projects.filter((p) => p.status === "active").length} projects
      </Text>

      {goals.map((g) => {
        const goalProjects = projects.filter((p) => p.goalIds.includes(g.id));
        const progressPct = Math.round(g.progress * 100);
        return (
          <View key={g.id} style={styles.goalCard}>
            {/* Goal header */}
            <View style={styles.goalHeader}>
              <View style={styles.goalInfo}>
                <Text style={styles.goalTitle}>{g.title}</Text>
                <View style={styles.goalMeta}>
                  <View style={[styles.statusBadge, g.status === "active" && styles.statusActive]}>
                    <Text style={[styles.statusText, g.status === "active" && styles.statusTextActive]}>{g.status}</Text>
                  </View>
                  <Text style={styles.weightText}>weight: {g.priorityWeight.toFixed(1)}</Text>
                </View>
              </View>
              <View style={styles.progressCircle}>
                <Text style={styles.progressText}>{progressPct}%</Text>
              </View>
            </View>

            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progressPct}%`,
                    backgroundColor:
                      progressPct >= 75
                        ? Colors.success
                        : progressPct >= 40
                        ? Colors.accent
                        : Colors.deepEnergy
                  }
                ]}
              />
            </View>

            {/* Projects under this goal */}
            {goalProjects.length > 0 && (
              <View style={styles.projectList}>
                {goalProjects.map((p, idx) => (
                  <View key={p.id}>
                    <View style={styles.projectRow}>
                      <View style={styles.projectContent}>
                        <Text style={styles.projectTitle}>{p.title}</Text>
                        <View style={styles.projectMeta}>
                          <View style={[styles.statusBadge, p.status === "active" && styles.statusActive]}>
                            <Text style={[styles.statusText, p.status === "active" && styles.statusTextActive]}>{p.status}</Text>
                          </View>
                          {p.deadline && (
                            <Text style={styles.deadlineText}>
                              due {new Date(p.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>
                    {idx < goalProjects.length - 1 && <View style={styles.projectSeparator} />}
                  </View>
                ))}
              </View>
            )}

            {/* Add project button */}
            {addingProject === g.id ? (
              <View style={styles.inlineForm}>
                <TextInput
                  style={styles.input}
                  placeholder="Project name"
                  placeholderTextColor={Colors.textMuted}
                  value={projectTitle}
                  onChangeText={setProjectTitle}
                  autoFocus
                />
                <View style={styles.formActions}>
                  <PressableScale onPress={() => setAddingProject(null)} haptic="light">
                    <Text style={styles.cancelText}>Cancel</Text>
                  </PressableScale>
                  <PressableScale style={styles.smallButton} onPress={() => addProject(g.id)} haptic="medium">
                    <Text style={styles.smallButtonText}>Add</Text>
                  </PressableScale>
                </View>
              </View>
            ) : (
              <PressableScale
                style={styles.addProjectButton}
                onPress={() => {
                  setAddingProject(g.id);
                  setProjectTitle("");
                }}
                haptic="light"
              >
                <Text style={styles.addProjectText}>+ Add project</Text>
              </PressableScale>
            )}
          </View>
        );
      })}

      {/* Add goal */}
      {addingGoal ? (
        <View style={styles.addCard}>
          <TextInput
            style={styles.input}
            placeholder="What's your goal?"
            placeholderTextColor={Colors.textMuted}
            value={newTitle}
            onChangeText={setNewTitle}
            autoFocus
          />
          <View style={styles.formActions}>
            <PressableScale onPress={() => setAddingGoal(false)} haptic="light">
              <Text style={styles.cancelText}>Cancel</Text>
            </PressableScale>
            <PressableScale style={styles.saveButton} onPress={addGoal} haptic="medium">
              <Text style={styles.saveButtonText}>Create Goal</Text>
            </PressableScale>
          </View>
        </View>
      ) : (
        <PressableScale style={styles.addButton} onPress={() => setAddingGoal(true)} haptic="light">
          <Text style={styles.addButtonText}>+ New goal</Text>
        </PressableScale>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  title: {
    color: Colors.textPrimary,
    fontSize: 34,
    fontWeight: "700",
    letterSpacing: 0.37
  },
  subtitle: { color: Colors.textMuted, fontSize: 14, marginTop: 4, marginBottom: 20 },

  // Goal card
  goalCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 20,
    marginBottom: 14,
    ...CardShadow
  },
  goalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  goalInfo: { flex: 1, marginRight: 14 },
  goalTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: "600", letterSpacing: -0.4 },
  goalMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  weightText: { color: Colors.textMuted, fontSize: 12 },

  progressCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2.5,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  progressText: { color: Colors.accent, fontSize: 13, fontWeight: "700", fontVariant: ["tabular-nums"] },

  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.bgCardAlt,
    marginTop: 14,
    overflow: "hidden"
  },
  progressFill: { height: 6, borderRadius: 3 },

  // Status badges
  statusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: Colors.bgCardAlt
  },
  statusActive: { backgroundColor: "rgba(48, 209, 88, 0.12)" },
  statusText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },
  statusTextActive: {
    color: Colors.success
  },

  // Projects
  projectList: {
    marginTop: 16,
    backgroundColor: Colors.bgCardAlt,
    borderRadius: 12,
    paddingHorizontal: 14
  },
  projectRow: { paddingVertical: 12 },
  projectSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.separator
  },
  projectContent: {},
  projectTitle: { color: Colors.textSecondary, fontSize: 15, fontWeight: "500" },
  projectMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 5 },
  deadlineText: { color: Colors.textMuted, fontSize: 12 },

  addProjectButton: { marginTop: 12 },
  addProjectText: { color: Colors.accent, fontSize: 14, fontWeight: "600" },

  // Forms
  inlineForm: { marginTop: 14 },
  input: {
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cancelText: { color: Colors.textMuted, fontSize: 15, fontWeight: "500" },
  smallButton: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 18
  },
  smallButtonText: { color: "#fff", fontWeight: "600", fontSize: 14 },

  // Add goal
  addCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
    ...CardShadow
  },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 22
  },
  saveButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  addButton: { alignItems: "center", paddingVertical: 16, marginTop: 8 },
  addButtonText: { color: Colors.accent, fontWeight: "700", fontSize: 16 }
});
