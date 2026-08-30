/** Apple Dynamic Type scale — every text style in the app maps to one of these
 * tokens. Using system fonts (San Francisco on iOS, Roboto on Android) which
 * are already the defaults for React Native.
 *
 * The scale follows Apple's HIG type sizes exactly so the app feels native.
 * Letter-spacing is tighter on large titles (Apple's "display" tightening)
 * and neutral on body sizes. */
export const Typography = {
  /** 34pt — screen-level titles like "This Week", "Goals" */
  largeTitle: {
    fontSize: 34,
    fontWeight: "700" as const,
    letterSpacing: 0.37,
    lineHeight: 41
  },
  /** 28pt — hero emphasis */
  title1: {
    fontSize: 28,
    fontWeight: "700" as const,
    letterSpacing: 0.36,
    lineHeight: 34
  },
  /** 22pt — section titles */
  title2: {
    fontSize: 22,
    fontWeight: "700" as const,
    letterSpacing: 0.35,
    lineHeight: 28
  },
  /** 20pt — card titles */
  title3: {
    fontSize: 20,
    fontWeight: "600" as const,
    letterSpacing: 0.38,
    lineHeight: 25
  },
  /** 17pt semibold — emphasis within body text */
  headline: {
    fontSize: 17,
    fontWeight: "600" as const,
    letterSpacing: -0.41,
    lineHeight: 22
  },
  /** 17pt regular — primary readable text */
  body: {
    fontSize: 17,
    fontWeight: "400" as const,
    letterSpacing: -0.41,
    lineHeight: 22
  },
  /** 16pt — secondary readable text */
  callout: {
    fontSize: 16,
    fontWeight: "400" as const,
    letterSpacing: -0.32,
    lineHeight: 21
  },
  /** 15pt — supporting detail */
  subhead: {
    fontSize: 15,
    fontWeight: "400" as const,
    letterSpacing: -0.24,
    lineHeight: 20
  },
  /** 13pt — timestamps, metadata */
  footnote: {
    fontSize: 13,
    fontWeight: "400" as const,
    letterSpacing: -0.08,
    lineHeight: 18
  },
  /** 12pt — section labels, badges */
  caption1: {
    fontSize: 12,
    fontWeight: "400" as const,
    letterSpacing: 0,
    lineHeight: 16
  },
  /** 11pt — tiny labels */
  caption2: {
    fontSize: 11,
    fontWeight: "400" as const,
    letterSpacing: 0.07,
    lineHeight: 13
  },
  /** 32pt bold — large stat numbers */
  stat: {
    fontSize: 32,
    fontWeight: "800" as const,
    letterSpacing: -1,
    lineHeight: 38
  },
  /** 14pt — stat unit labels */
  statUnit: {
    fontSize: 14,
    fontWeight: "600" as const,
    lineHeight: 18
  },
  /** 12pt bold uppercase — section headers in lists ("PROFILE", "TODAY") */
  sectionHeader: {
    fontSize: 13,
    fontWeight: "400" as const,
    letterSpacing: -0.08,
    lineHeight: 18,
    textTransform: "uppercase" as const
  }
};

/** Gradient presets used across screens */
export const Gradients = {
  accentGlow: ["rgba(34, 211, 238, 0.2)", "rgba(34, 211, 238, 0)"],
  nowCard: ["rgba(34, 211, 238, 0.08)", "rgba(0, 0, 0, 0)"],
  success: ["rgba(48, 209, 88, 0.15)", "rgba(48, 209, 88, 0)"],
  warning: ["rgba(255, 214, 10, 0.15)", "rgba(255, 214, 10, 0)"],
  danger: ["rgba(255, 69, 58, 0.15)", "rgba(255, 69, 58, 0)"],
  cardShine: ["rgba(255,255,255,0.03)", "rgba(255,255,255,0)"]
};
