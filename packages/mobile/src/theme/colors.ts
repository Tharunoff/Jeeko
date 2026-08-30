/** Jeeko's theme — Apple-inspired dark mode.
 *
 * Background tiers follow Apple's exact dark-mode grays:
 *   - bg          = pure black (root)
 *   - bgCard      = systemGray6 (#1C1C1E) — primary card surface
 *   - bgCardAlt   = systemGray5 (#2C2C2E) — elevated/nested surfaces
 *
 * Text uses rgba-white so it naturally adapts when placed on any tier.
 * Accent (cyan) is reserved for interactive/live elements — not decoration.
 *
 * Cards use shadow-based depth instead of borders. The `separator` color
 * is only for thin dividers inside grouped lists (Apple's inset-grouped
 * pattern), not for wrapping every card. */
export const Colors = {
  // Backgrounds — Apple dark mode tiers
  bg: "#000000",
  bgCard: "#1C1C1E",
  bgCardAlt: "#2C2C2E",
  bgElevated: "#3A3A3C",

  // Separators & dividers (not card borders)
  separator: "rgba(255, 255, 255, 0.08)",
  border: "rgba(255, 255, 255, 0.12)",

  // Text — rgba-white hierarchy
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(235, 235, 245, 0.6)",
  textMuted: "rgba(235, 235, 245, 0.3)",

  // Brand accent — used sparingly
  accent: "#22D3EE",
  accentSoft: "rgba(34, 211, 238, 0.12)",

  // Semantic
  success: "#30D158",
  warning: "#FFD60A",
  danger: "#FF453A",

  // Legacy compat (used by VoiceOrb / energy indicators — don't break the orb)
  deepEnergy: "#818CF8",
  lowEnergy: "#67E8F9"
};

/** Shared shadow style for card elevation — use instead of borderWidth on cards. */
export const CardShadow = {
  shadowColor: "#000",
  shadowOpacity: 0.35,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 6
};

/** Lighter shadow for smaller interactive elements. */
export const SmallShadow = {
  shadowColor: "#000",
  shadowOpacity: 0.25,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 3
};
