import React, { useEffect, useRef } from "react";
import { Animated, StyleProp, ViewStyle } from "react-native";

/**
 * Fades + slides a child in once on mount — used for chat bubbles and banners so new
 * content arrives with a soft entrance instead of just popping into place.
 */
export function FadeInUp({
  children,
  style,
  distance = 6,
  duration = 280
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  distance?: number;
  duration?: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration, useNativeDriver: true }).start();
  }, [progress, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] })
            }
          ]
        }
      ]}
    >
      {children}
    </Animated.View>
  );
}
