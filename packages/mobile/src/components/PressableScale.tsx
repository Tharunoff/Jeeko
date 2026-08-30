import React, { useRef } from "react";
import { Animated, Platform, Pressable, StyleProp, StyleSheet, ViewStyle, PressableProps } from "react-native";
import * as Haptics from "expo-haptics";

interface PressableScaleProps extends Omit<PressableProps, "style"> {
  style?: StyleProp<ViewStyle>;
  /** Scale factor while pressed. 0.96 is a subtle "settle", 0.9 is a firmer press. */
  activeScale?: number;
  /** Haptic tap on press-in. Off by default for tiny/frequent controls (e.g. text input focus). */
  haptic?: "light" | "medium" | "selection" | "none";
  children?: React.ReactNode;
}

/** Properties that only matter for how the wrapper arranges its OWN children (an
 * icon next to a text label, say) — as opposed to sizing/painting properties like
 * width, background, border, padding, which must live on exactly one layer or they
 * double-paint. Picked out of `style` and mirrored onto the inner Animated.View;
 * everything else stays solely on the Pressable. */
const ARRANGEMENT_KEYS = ["flexDirection", "alignItems", "justifyContent", "flexWrap", "gap", "rowGap", "columnGap"] as const;

function pickArrangementStyle(style?: StyleProp<ViewStyle>): ViewStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of ARRANGEMENT_KEYS) {
    if (flat[key] !== undefined) picked[key] = flat[key];
  }
  return picked as ViewStyle;
}

/**
 * Drop-in replacement for TouchableOpacity with a spring-back scale animation and
 * optional haptic feedback — the two things that make buttons feel "alive" instead of
 * flat. No new native dependency: built on RN's own Animated + the haptics module
 * already in the project, so it works in the current build without a rebuild.
 */
export function PressableScale({
  style,
  activeScale = 0.96,
  haptic = "light",
  onPressIn,
  onPressOut,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useRef(new Animated.Value(1)).current;

  return (
    // `style` (sizing: flex/width/height/margin; painting: background/border/padding)
    // lives on the Pressable — it's both the real flex item siblings lay out around
    // AND the only layer that should ever paint a background/border, or a solid
    // button (e.g. a circular icon button) double-paints its fill and ring.
    // Only the ARRANGEMENT subset (flexDirection/align/justify/gap) is mirrored onto
    // the inner Animated.View, since that view is what actually parents `children` —
    // without it, an icon+text row silently falls back to RN's default column stack
    // (the Pressable's one and only child has nothing to arrange a row *of*).
    <Pressable
      style={style}
      onPressIn={(e) => {
        Animated.spring(scale, {
          toValue: activeScale,
          useNativeDriver: true,
          speed: 50,
          bounciness: 4
        }).start();
        if (haptic !== "none" && Platform.OS !== "web") {
          if (haptic === "selection") Haptics.selectionAsync().catch(() => {});
          else Haptics.impactAsync(haptic === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 40,
          bounciness: 6
        }).start();
        onPressOut?.(e);
      }}
      {...rest}
    >
      <Animated.View style={[pickArrangementStyle(style), { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
