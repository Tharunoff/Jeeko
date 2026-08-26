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
import {
  executeTool,
  formatMinutes,
  type Goal,
  type Project,
  type Task
} from "@personalos/core";
import { useAppState } from "../state/AppState";
import { Colors } from "../theme/colors";

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

  const active = tasks
    .filter((t) => t.status !== "completed" && t.status !== "cancelled")
    .sort((a, b) => {
      // Sort by urgency desc, then importance desc
      const ua = (a.urgency ?? 0.5) + (a.importance ?? 0.5);
      const ub = (b.urgency ?? 0.5) + (b.importance ?? 0.5);
      return ub - ua;
    });
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
              <TouchableOpacity style={styles.checkbox} onPress={() => complete(t)}>
                <View style={[styles.checkboxInner, { borderColor: priorityColor }]} />
              </TouchableOpacity>
              <View style={styles.taskInfo}>
                <Text style={styles.taskTitle}>{t.title}</Text>
                <View style={styles.taskMeta}>
                  <Text style={styles.metaPill}>
                    {formatMinutes(t.estimatedMinutes)}
                  </Text>
                  <View style={styles.metaPillIconRow}>
                    <Feather name={ENERGY_ICON[t.energyRequirement]} size={11} color={Colors.textMuted} />
                    <Text style={styles.metaPill}>{t.energyRequirement}</Text>
                  </View>
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
                    <Feather name="folder" size={11} color={Colors.textMuted} />
                    <Text style={styles.projectTag}>{project.title}</Text>
                  </View>
                )}
                {t.deadline && (
                  <View style={styles.tagRow}>
                    <Feather name="calendar" size={11} color={t.deadlineType === "hard" ? Colors.danger : Colors.warning} />
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
                    <Feather name="arrow-right-circle" size={11} color={Colors.lowEnergy} />
                    <Text style={styles.deferredTag}>Deferred</Text>
                  </View>
                )}
                {t.dependencies.length > 0 && (
                  <View style={styles.tagRow}>
                    <Feather name="link" size={11} color={Colors.textMuted} />
                    <Text style={styles.depTag}>
                      Depends on {t.dependencies.length} task{t.dependencies.length > 1 ? "s" : ""}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Actions */}
            <View style={styles.taskActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => deferToTomorrow(t)}
              >
                <Text style={styles.actionText}>Move to tomorrow</Text>
              </TouchableOpacity>
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
              <TouchableOpacity
                key={e}
                style={[styles.energyPill, energy === e && styles.energyPillActive]}
                onPress={() => setEnergy(e)}
              >
                <Feather name={ENERGY_ICON[e]} size={13} color={energy === e ? Colors.accent : Colors.textMuted} />
                <Text style={[styles.energyPillText, energy === e && styles.energyPillTextActive]}>
                  {e}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Project selector */}
          {projects.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectScroll}>
              <TouchableOpacity
                style={[styles.projectPill, !selectedProjectId && styles.projectPillActive]}
                onPress={() => setSelectedProjectId(undefined)}
              >
                <Text style={styles.projectPillText}>No project</Text>
              </TouchableOpacity>
              {projects
                .filter((p) => p.status === "active")
                .map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.projectPill, selectedProjectId === p.id && styles.projectPillActive]}
                    onPress={() => setSelectedProjectId(p.id)}
                  >
                    <Text style={styles.projectPillText}>{p.title}</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          )}

          <View style={styles.formActions}>
            <TouchableOpacity onPress={() => setAdding(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveButton} onPress={addTask}>
              <Text style={styles.saveButtonText}>Add Task</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.addButton} onPress={() => setAdding(true)}>
          <Text style={styles.addButtonText}>+ New task</Text>
        </TouchableOpacity>
      )}

      {/* Completed tasks */}
      {done.length > 0 && (
        <>
          <Text style={styles.doneLabel}>COMPLETED</Text>
          {done.slice(0, 10).map((t) => (
            <View key={t.id} style={styles.doneRow}>
              <Feather name="check" size={14} color={Colors.success} />
              <Text style={styles.doneTitle}>{t.title}</Text>
              <Text style={styles.doneMeta}>{formatMinutes(t.estimatedMinutes)}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: "800", letterSpacing: -0.3 },
  subtitle: { color: Colors.textMuted, fontSize: 13, marginTop: 4, marginBottom: 16 },

  // Task card
  taskCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border
  },
  taskHeader: { flexDirection: "row", alignItems: "flex-start" },
  checkbox: { marginTop: 2, marginRight: 12 },
  checkboxInner: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2
  },
  taskInfo: { flex: 1 },
  taskTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: "600" },
  taskMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
    flexWrap: "wrap"
  },
  metaPill: { color: Colors.textMuted, fontSize: 12 },
  metaPillIconRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  difficultyDot: { width: 6, height: 6, borderRadius: 3 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  projectTag: { color: Colors.textMuted, fontSize: 12 },
  deadlineTag: { color: Colors.warning, fontSize: 12 },
  deferredTag: { color: Colors.lowEnergy, fontSize: 12 },
  depTag: { color: Colors.textMuted, fontSize: 12 },

  // Actions
  taskActions: { flexDirection: "row", justifyContent: "flex-end", marginTop: 10 },
  actionButton: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Colors.bgCardAlt
  },
  actionText: { color: Colors.textSecondary, fontSize: 12, fontWeight: "500" },

  // Add form
  addCard: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    padding: 18,
    marginTop: 8,
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
  energyRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  energyPill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: Colors.bgCardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4
  },
  energyPillActive: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  energyPillText: { color: Colors.textSecondary, fontSize: 12, textTransform: "capitalize" },
  energyPillTextActive: { color: Colors.textPrimary, fontWeight: "600" },
  projectScroll: { marginBottom: 10 },
  projectPill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: Colors.bgCardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8
  },
  projectPillActive: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  projectPillText: { color: Colors.textSecondary, fontSize: 12 },
  formActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4
  },
  cancelText: { color: Colors.textMuted, fontSize: 14 },
  saveButton: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20
  },
  saveButtonText: { color: "#fff", fontWeight: "700" },
  addButton: { alignItems: "center", paddingVertical: 14, marginTop: 8 },
  addButtonText: { color: Colors.accent, fontWeight: "700", fontSize: 15 },

  // Completed
  doneLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginTop: 24,
    marginBottom: 10
  },
  doneRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border
  },
  doneTitle: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 14,
    textDecorationLine: "line-through"
  },
  doneMeta: { color: Colors.textMuted, fontSize: 12 }
});
