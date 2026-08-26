import { useEffect, useState } from "react";
import { executeTool, type CapacityBreakdown, type DecisionLog, type NextActionResult, type PlannedBlock, type Task } from "@personalos/core";
import { useAppState } from "../state/AppState";

export interface TodayData {
  loading: boolean;
  capacity: CapacityBreakdown | null;
  blocks: PlannedBlock[];
  unscheduledTaskIds: string[];
  decisions: DecisionLog[];
  nextAction: NextActionResult | null;
  tasks: Task[];
}

const EMPTY: TodayData = {
  loading: true,
  capacity: null,
  blocks: [],
  unscheduledTaskIds: [],
  decisions: [],
  nextAction: null,
  tasks: []
};

/** Runs the same tool calls the chat assistant would use ("get_today_schedule",
 * "get_next_action") so the Home screen and the assistant can never disagree about
 * what today looks like. */
export function useToday(energyState?: "low" | "medium" | "high"): TodayData {
  const { store, ready, version } = useAppState();
  const [data, setData] = useState<TodayData>(EMPTY);

  useEffect(() => {
    if (!store || !ready) return;
    let cancelled = false;
    setData((d) => ({ ...d, loading: true }));
    (async () => {
      const now = new Date();
      const schedule = (await executeTool("get_today_schedule", {}, { store, now })) as any;
      const nextAction = (await executeTool("get_next_action", { energyState }, { store, now })) as NextActionResult;
      const tasks = await store.listTasks();
      if (cancelled) return;
      setData({
        loading: false,
        capacity: schedule.capacity,
        blocks: schedule.blocks,
        unscheduledTaskIds: schedule.unscheduledTaskIds,
        decisions: schedule.decisions,
        nextAction,
        tasks
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, ready, version, energyState]);

  return data;
}
