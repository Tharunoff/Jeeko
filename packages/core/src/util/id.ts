let counter = 0;

/** Deterministic-enough unique ID for local-first use (no central authority needed). */
export function generateId(prefix = "id"): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${counter}_${rand}`;
}
