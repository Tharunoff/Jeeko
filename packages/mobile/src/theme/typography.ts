/** Design token scale — all text styles flow from here so the app has
 * consistent visual rhythm. Using system fonts for now (Inter via expo-font
 * can be added later without changing any component code). */
export const Typography = {
  hero: {
    fontSize: 28,
    fontWeight: "800" as const,
    letterSpacing: -0.5,
    lineHeight: 34
  },
  title: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: -0.3,
    lineHeight: 28
  },
  subtitle: {
    fontSize: 17,
    fontWeight: "600" as const,
    lineHeight: 22
  },
  body: {
    fontSize: 15,
    fontWeight: "400" as const,
    lineHeight: 21
  },
  bodyBold: {
    fontSize: 15,
    fontWeight: "600" as const,
    lineHeight: 21
  },
  caption: {
    fontSize: 13,
    fontWeight: "500" as const,
    lineHeight: 18
  },
  label: {
    fontSize: 12,
    fontWeight: "700" as const,
    letterSpacing: 1.5,
    lineHeight: 16
  },
  stat: {
    fontSize: 32,
    fontWeight: "800" as const,
    letterSpacing: -1,
    lineHeight: 38
  },
  statUnit: {
    fontSize: 14,
    fontWeight: "600" as const,
    lineHeight: 18
  }
};

/** Gradient presets used across screens */
export const Gradients = {
  accentGlow: ["rgba(99, 102, 241, 0.25)", "rgba(99, 102, 241, 0)"],
  nowCard: ["rgba(99, 102, 241, 0.12)", "rgba(30, 27, 75, 0.05)"],
  success: ["rgba(34, 197, 94, 0.15)", "rgba(34, 197, 94, 0)"],
  warning: ["rgba(245, 158, 11, 0.15)", "rgba(245, 158, 11, 0)"],
  danger: ["rgba(239, 68, 68, 0.15)", "rgba(239, 68, 68, 0)"],
  cardShine: ["rgba(255,255,255,0.04)", "rgba(255,255,255,0)"]
};
