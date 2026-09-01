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
import {
  executeTool,
  formatMinutes,
  getAllDependents,
  scoreTask,
  type Goal,
  type Project,
  type Task
} from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors, CardShadow } from "../theme/colors";
import { PressableScale } from "../components/PressableScale";

const ENERGY_OPTIONS = ["low", "medium", "high"] as const;
const ENERGY_ICON: Record<(typeof ENERGY_OPTIONS)[number], React.ComponentProps<typeof Feather>["name"]> = {
  low: "moon",
  medium: "sun",
  high: "zap"
};

export function TasksScreen() {
  const { store, ready, version, refresh } = useAppState();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("30");
  const [energy, setEnergy] = useState<(typeof ENERGY_OPTIONS)[number]>("medium");
  const [deadlineText, setDeadlineText] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();

  useEffect(() => {
    if (!store || !ready) return;
    (async () => {
      setTasks(await store.listTasks());
      setGoals(await store.listGoals());
      setProjects(await store.listProjects());
    })();
  }, [store, ready, version]);

  async function addTask() {
    if (!store || !title.trim()) return;
    const est = parseInt(minutes, 10) || 30;
    const args: any = {
      title: title.trim(),
      estimatedMinutes: est,
      energyRequirement: energy
    };

    if (selectedProjectId) {
      args.projectId = selectedProjectId;
      const proj = projects.find((p) => p.id === selectedProjectId);
      if (proj) args.goalIds = proj.goalIds;
    }

    if (deadlineText.trim()) {
      // Try to parse as a date
      const parsed = new Date(deadlineText.trim());
      if (!isNaN(parsed.getTime())) {
        args.deadline = parsed.toISOString();
        args.deadlineType = "soft";
      }
    }

    const created: any = await executeTool("create_task", args, { store, now: new Date() });
    await executeTool("update_task", { id: created.task.id, status: "planned" }, { store, now: new Date() });

    setTitle("");
    setMinutes("30");
    setDeadlineText("");
    setSelectedProjectId(undefined);
    setAdding(false);
    refresh();
  }

  async function complete(task: Task) {
    if (!store) return;
    await executeTool("complete_task", { id: task.id }, { store, now: new Date() });
    refresh();
  }

  async function deferToTomorrow(task: Task) {
    if (!store) return;
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    await executeTool("reschedule_task", { taskId: task.id, deferUntil: tomorrow }, { store, now: new Date() });
    refresh();
  }

  function confirmDelete(task: Task) {
    Alert.alert("Delete task?", `"${task.title}" will be permanently removed.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (!store) return;
          await executeTool("delete_task", { id: task.id }, { store, now: new Date() });
          refresh();
        }
      }
    ]);
  }

  // Sorted by the same finalScore the priority engine actually uses for
  // get_next_action/check_feasibility — a hand-rolled urgency+importance sum
  // here used to silently disagree with what Jeeko says out loud is next,
  // which is confusing (the list order should match the reasoning, not just
  // approximate it).
  const now = new Date();
  const active = tasks
    .filter((t) => t.status !== "completed" && t.status !== "cancelled")
    .map((t) => {
      const project = projects.find((p) => p.id === t.projectId);
      const dependents = getAllDependents(t.id, tasks);
      const score = scoreTask(t, { now, goals, project, dependents }).finalScore;
      return { task: t, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.task);
  const done = tasks.filter((t) => t.status === "completed");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: 20, paddingBottom: 50 }}>
      <Text style={styles.title}>Tasks</Text>
      <Text style={styles.subtitle}>
        {active.length} active · {done.length} completed
      </Text>

      {/* Active tasks */}
      {active.map((t) => {
        const project = projects.find((p) => p.id === t.projectId);
        const priorityColor =
          t.importance >= 0.8
            ? Colors.danger
            : t.importance >= 0.5
            ? Colors.warning
            : Colors.textMuted;

        return (
          <View key={t.id} style={styles.taskCard}>
            <View style={styles.taskHeader}>
              <PressableScale style={styles.checkbox} onPress={() => complete(t)} haptic="medium" activeScale={0.8}>
                <View style={[styles.checkboxInner, { borderColor: priorityColor }]} />
              </PressableScale>
              <View style={styles.taskInfo}>
                <Text style={styles.taskTitle}>{t.title}</Text>
                <View style={styles.taskMeta}>
                  <Text style={styles.metaPill}>
                    {formatMinutes(t.estimatedMinutes)}
                  </Text>
                  <View style={styles.metaDot} />
                  <Feather name={ENERGY_ICON[t.energyRequirement]} size={12} color={Colors.textMuted} />
                  <Text style={styles.metaPill}>{t.energyRequirement}</Text>
                  <View style={styles.metaDot} />
                  <View style={[styles.difficultyDot, {
                    backgroundColor:
                      t.difficulty === "hard" ? Colors.danger :
                      t.difficulty === "medium" ? Colors.warning :
                      Colors.success
                  }]} />
                  <Text style={styles.metaPill}>{t.difficulty}</Text>
                </View>
                {project && (
                  <View style={styles.tagRow}>
                    <Feather name="folder" size={12} color={Colors.textMuted} />
                    <Text style={styles.projectTag}>{project.title}</Text>
                  </View>
                )}
                {t.deadline && (
                  <View style={styles.tagRow}>
                    <Feather name="calendar" size={12} color={t.deadlineType === "hard" ? Colors.danger : Colors.warning} />
                    <Text style={[
                      styles.deadlineTag,
                      t.deadlineType === "hard" && { color: Colors.danger }
                    ]}>
                      {new Date(t.deadline).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      {t.deadlineType === "hard" ? " (hard)" : ""}
                    </Text>
                  </View>
                )}
                {t.deferredUntil && (
                  <View style={styles.tagRow}>
                    <Feather name="arrow-right-circle" size={12} color={Colors.lowEnergy} />
                    <Text style={styles.deferredTag}>Deferred</Text>
                  </View>
                )}
                {t.dependencies.length > 0 && (
                  <View style={styles.tagRow}>
                    <Feather name="link" size={12} color={Colors.textMuted} />
                    <Text style={styles.depTag}>
                      Depends on {t.dependencies.length} task{t.dependencies.length > 1 ? "s" : ""}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Actions */}
            <View style={styles.taskActions}>
              <PressableScale onPress={() => confirmDelete(t)} haptic="light" style={styles.deleteAction}>
                <Feather name="trash-2" size={14} color={Colors.textMuted} />
              </PressableScale>
              <PressableScale onPress={() => deferToTomorrow(t)} haptic="light">
                <Text style={styles.actionText}>Move to tomorrow</Text>
              </PressableScale>
            </View>
          </View>
        );
      })}

      {/* Add task form */}
      {adding ? (
        <View style={styles.addCard}>
          <TextInput
            style={styles.input}
            placeholder="What needs to be done?"
            placeholderTextColor={Colors.textMuted}
            value={title}
            onChangeText={setTitle}
            autoFocus
          />
          <View style={styles.formRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Minutes"
              placeholderTextColor={Colors.textMuted}
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
            />
            <View style={{ width: 10 }} />
            <TextInput
              style={[styles.input, { flex: 2 }]}
              placeholder="Deadline (YYYY-MM-DD)"
              placeholderTextColor={Colors.textMuted}
              value={deadlineText}
              onChangeText={setDeadlineText}
            />
          </View>

          {/* Energy selector */}
          <View style={styles.energyRow}>
            {ENERGY_OPTIONS.map((e) => (
              <PressableScale
                key={e}
                style={[styles.energyPill, energy === e && styles.energyPillActive]}
                onPress={() => setEnergy(e)}
                haptic="selection"
                activeScale={0.94}
              >
                <Feather name={ENERGY_ICON[e]} size={13} color={energy === e ? Colors.accent : Colors.textMuted} />
                <Text style={[styles.energyPillText, energy === e && styles.energyPillTextActive]}>
                  {e}
                </Text>
              </PressableScale>
            ))}
          </View>

          {/* Project selector */}
          {projects.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectScroll}>
              <PressableScale
                style={[styles.projectPill, !selectedProjectId && styles.projectPillActive]}
                onPress={() => setSelectedProjectId(undefined)}
                haptic="selection"
                activeScale={0.94}
              >
                <Text style={[styles.projectPillText, !selectedProjectId && styles.projectPillTextActive]}>No project</Text>
              </PressableScale>
              {projects
                .filter((p) => p.status === "active")
                .map((p) => (
                  <PressableScale
                    key={p.id}
                    style={[styles.projectPill, selectedProjectId === p.id && styles.projectPillActive]}
                    onPress={() => setSelectedProjectId(p.id)}
                    haptic="selection"
                    activeScale={0.94}
                  >
                    <Text style={[styles.projectPillText, selectedProjectId === p.id && styles.projectPillTextActive]}>{p.title}</Text>
                  </PressableScale>
                ))}
            </ScrollView>
          )}

          <View style={styles.formActions}>
            <PressableScale onPress={() => setAdding(false)} haptic="light">
              <Text style={styles.cancelText}>Cancel</Text>
            </PressableScale>
            <PressableScale style={styles.saveButton} onPress={addTask} haptic="medium">
              <Text style={styles.saveButtonText}>Add Task</Text>
            </PressableScale>
          </View>
        </View>
      ) : (
        <PressableScale style={styles.addButton} onPress={() => setAdding(true)} haptic="light">
          <Text style={styles.addButtonText}>+ New task</Text>
        </PressableScale>
      )}

      {/* Completed tasks */}
      {done.length > 0 && (
        <>
          <Text style={styles.doneLabel}>COMPLETED</Text>
          <View style={styles.doneCard}>
            {done.slice(0, 10).map((t, idx) => (
              <View key={t.id}>
                <View style={styles.doneRow}>
                  <Feather name="check" size={14} color={Colors.success} />
                  <Text style={styles.doneTitle}>{t.title}</Text>
                  <Text style={styles.doneMeta}>{formatMinutes(t.estimatedMinutes)}</Text>
                </View>
                {idx < Math.min(done.length, 10) - 1 && <View style={styles.doneSeparator} />}
              </View>
            ))}
          </View>
        </>
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

  // Task card
  taskCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
    ...CardShadow
  },
  taskHeader: { flexDirection: "row", alignItems: "flex-start" },
  checkbox: { marginTop: 2, marginRight: 14 },
  checkboxInner: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2
  },
  taskInfo: { flex: 1 },
  taskTitle: { color: Colors.textPrimary, fontSize: 16, fontWeight: "600", letterSpacing: -0.3 },
  taskMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    flexWrap: "wrap"
  },
  metaPill: { color: Colors.textMuted, fontSize: 13 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: Colors.textMuted, opacity: 0.5 },
  difficultyDot: { width: 7, height: 7, borderRadius: 3.5 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  projectTag: { color: Colors.textMuted, fontSize: 13 },
  deadlineTag: { color: Colors.warning, fontSize: 13 },
  deferredTag: { color: Colors.lowEnergy, fontSize: 13 },
  depTag: { color: Colors.textMuted, fontSize: 13 },

  // Actions
  taskActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  deleteAction: { padding: 4 },
  actionText: { color: Colors.accent, fontSize: 14, fontWeight: "500" },

  // Add form
  addCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 20,
    marginTop: 8,
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
  energyRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  energyPill: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.bgCardAlt,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5
  },
  energyPillActive: { backgroundColor: Colors.accentSoft },
  energyPillText: { color: Colors.textSecondary, fontSize: 13, textTransform: "capitalize" },
  energyPillTextActive: { color: Colors.accent, fontWeight: "600" },
  projectScroll: { marginBottom: 12 },
  projectPill: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: Colors.bgCardAlt,
    marginRight: 8
  },
  projectPillActive: { backgroundColor: Colors.accentSoft },
  projectPillText: { color: Colors.textSecondary, fontSize: 13 },
  projectPillTextActive: { color: Colors.accent, fontWeight: "600" },
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4
  },
  cancelText: { color: Colors.textMuted, fontSize: 15, fontWeight: "500" },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 22
  },
  saveButtonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  addButton: { alignItems: "center", paddingVertical: 16, marginTop: 8 },
  addButtonText: { color: Colors.accent, fontWeight: "700", fontSize: 16 },

  // Completed
  doneLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "400",
    letterSpacing: -0.08,
    textTransform: "uppercase",
    marginTop: 28,
    marginBottom: 10
  },
  doneCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 14,
    paddingHorizontal: 16,
    ...CardShadow
  },
  doneRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 10
  },
  doneSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.separator
  },
  doneTitle: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 15,
    textDecorationLine: "line-through"
  },
  doneMeta: { color: Colors.textMuted, fontSize: 13, fontVariant: ["tabular-nums"] }
});
