import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";

/**
 * A soft breathing glow, absolutely positioned behind whatever it wraps — the
 * "this thing is alive and listening" cue (used behind the NOW card and the chat
 * launcher). Pure RN Animated, no native deps.
 */
export function PulsingGlow({ color, size = 140 }: { color: string; size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1800, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.15] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.5] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.glow,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale }],
          opacity
        }
      ]}
    />
  );
}

const styles = StyleSheet.create({
  glow: {
    position: "absolute"
  }
});
