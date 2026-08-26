/**
 * Weights for combining PriorityScore's normalized [0,1] components into a
 * single finalScore. Isolated here (not inline in priorityEngine.ts) so the
 * scoring model can be swapped or tuned without touching the algorithm that
 * computes each component.
 *
 * Rationale for the starting values (not arbitrary — chosen to match the
 * spec's stated ordering: "critical + immediate deadline" outranks
 * "important + distant deadline" outranks "admin/no-deadline work"):
 *   - deadlinePressure (0.30) and importance (0.25) dominate, together >50%,
 *     because the spec's #1 and #3 priority rules are deadline- and
 *     importance-driven.
 *   - dependencyImpact (0.15) matters because unblocking downstream work is
 *     explicitly called out (spec rule #2, "tasks blocking other work").
 *   - goalAlignment (0.15) keeps long-term goals competitive against urgent
 *     but low-value noise, without letting it override real deadlines.
 *   - consequenceOfDelay (0.10) is a secondary signal derived from slack
 *     simulation; kept smaller because it's already partially captured by
 *     deadlinePressure.
 *   - effortPenalty (0.05) is a small tie-breaker only — large low-value
 *     tasks should not casually crowd out several smaller high-value ones,
 *     but effort must never dominate deadline/importance.
 */
export interface PriorityWeights {
  deadlinePressure: number;
  importance: number;
  goalAlignment: number;
  dependencyImpact: number;
  consequenceOfDelay: number;
  effortPenalty: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  deadlinePressure: 0.3,
  importance: 0.25,
  goalAlignment: 0.15,
  dependencyImpact: 0.15,
  consequenceOfDelay: 0.1,
  effortPenalty: 0.05
};

const WEIGHT_SUM = Object.values(DEFAULT_PRIORITY_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`DEFAULT_PRIORITY_WEIGHTS must sum to 1, got ${WEIGHT_SUM}`);
}
