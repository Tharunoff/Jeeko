import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { executeTool, type Goal, type Project } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors } from "../theme/colors";

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
      <Text style={styles.title}>Goals & Projects</Text>
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
                    <Text style={styles.statusText}>{g.status}</Text>
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
                {goalProjects.map((p) => (
                  <View key={p.id} style={styles.projectRow}>
                    <View style={styles.projectConnector} />
                    <View style={styles.projectContent}>
                      <Text style={styles.projectTitle}>{p.title}</Text>
                      <View style={styles.projectMeta}>
                        <View style={[styles.statusBadge, p.status === "active" && styles.statusActive]}>
                          <Text style={styles.statusText}>{p.status}</Text>
                        </View>
                        {p.deadline && (
                          <Text style={styles.deadlineText}>
                            due {new Date(p.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </Text>
                        )}
                      </View>
                    </View>
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
                  <TouchableOpacity onPress={() => setAddingProject(null)}>
                    <Text style={styles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallButton} onPress={() => addProject(g.id)}>
                    <Text style={styles.smallButtonText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addProjectButton}
                onPress={() => {
                  setAddingProject(g.id);
                  setProjectTitle("");
                }}
              >
                <Text style={styles.addProjectText}>+ Add project</Text>
              </TouchableOpacity>
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
            <TouchableOpacity onPress={() => setAddingGoal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={addGoal}>
              <Text style={styles.saveButtonText}>Create Goal</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addButton} onPress={() => setAddingGoal(true)}>
          <Text style={styles.addButtonText}>+ New goal</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginTop: 4, marginBottom: 16 },

  // Goal card
  goalCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border
  },
  goalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  goalInfo: { flex: 1, marginRight: 12 },
  goalTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: "700" },
  goalMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  weightText: { color: Colors.textMuted, fontSize: 11 },

  progressCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  progressText: { color: Colors.accent, fontSize: 12, fontWeight: "700" },

  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.bgCardAlt,
    marginTop: 12,
    overflow: "hidden"
  },
  progressFill: { height: 4, borderRadius: 2 },

  // Status badges
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: Colors.bgCardAlt
  },
  statusActive: { backgroundColor: "rgba(34, 197, 94, 0.15)" },
  statusText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5
  },

  // Projects
  projectList: { marginTop: 14 },
  projectRow: { flexDirection: "row", marginBottom: 8 },
  projectConnector: {
    width: 2,
    backgroundColor: Colors.border,
    marginRight: 12,
    marginLeft: 8,
    borderRadius: 1
  },
  projectContent: { flex: 1, paddingVertical: 6 },
  projectTitle: { color: Colors.textSecondary, fontSize: 14, fontWeight: "500" },
  projectMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  deadlineText: { color: Colors.textMuted, fontSize: 11 },

  addProjectButton: { marginTop: 10 },
  addProjectText: { color: Colors.accent, fontSize: 13, fontWeight: "600" },

  // Forms
  inlineForm: { marginTop: 12 },
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
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  cancelText: { color: Colors.textMuted, fontSize: 14 },
  smallButton: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 16
  },
  smallButtonText: { color: "#fff", fontWeight: "600", fontSize: 13 },

  // Add goal
  addCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    padding: 18,
    marginTop: 8,
    borderWidth: 1,
    borderColor: Colors.border
  },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20
  },
  saveButtonText: { color: "#fff", fontWeight: "700" },
  addButton: { alignItems: "center", paddingVertical: 14, marginTop: 8 },
  addButtonText: { color: Colors.accent, fontWeight: "700", fontSize: 15 }
});
