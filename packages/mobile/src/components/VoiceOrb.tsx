import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import { PressableScale } from "./PressableScale";
import { VoiceOrbGlass } from "./VoiceOrbGlass";
import { SkiaErrorBoundary } from "./SkiaErrorBoundary";
import { liveSpeechAmplitude } from "../voice/speechAmplitude";
import type { VoiceState } from "../hooks/useVoiceSession";

/** Sphere gradient (light source upper-left, darker at the rim) and the color its
 * aura glows in, per state. Idle uses Jeeko's brand color (electric cyan on deep
 * navy); listening is the same family turned up — brighter and faster, not a
 * different hue — so it reads as "activated," not "switched to something else."
 * Thinking/speaking get their own hues since those genuinely are different modes
 * worth telling apart at a glance. */
const STATE_SPHERE: Record<VoiceState, [string, string]> = {
  idle: ["#4DD8EA", "#052430"],
  listening: ["#9CF4FF", "#0A6E88"],
  thinking: ["#CBB6FC", "#4A2A8F"],
  speaking: ["#7EF0C2", "#03724F"]
};
const STATE_GLOW: Record<VoiceState, string> = {
  idle: "#22D3EE",
  listening: "#67E8F9",
  thinking: "#A78BFA",
  speaking: "#34D399"
};
const STATE_TEMPO: Record<VoiceState, number> = {
  idle: 2800,
  listening: 780,
  thinking: 540,
  speaking: 420
};
const STATE_AMPLITUDE: Record<VoiceState, number> = {
  idle: 0.06,
  listening: 0.22,
  thinking: 0.13,
  speaking: 0.19
};
/** A circle filled with a true radial gradient (soft center, fully transparent at the
 * rim) — this is what makes it read as a glow instead of a flat translucent disc. */
function GlowLayer({ size, color, gradId, innerOpacity }: { size: number; color: string; gradId: string; innerOpacity: number }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={gradId} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={innerOpacity} />
          <Stop offset="55%" stopColor={color} stopOpacity={innerOpacity * 0.45} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${gradId})`} />
    </Svg>
  );
}

/** Plain flat-gradient circle — only ever shown if the real Skia glass shader
 * throws on some untested device/GPU (see SkiaErrorBoundary). Not meant to
 * look good, just to mean "Jeeko is still here" instead of a blank crash. */
function OrbFallback({ size, colors }: { size: number; colors: [string, string] }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="orbFallbackFill" cx="32%" cy="22%" r="90%">
          <Stop offset="0%" stopColor={colors[0]} stopOpacity={1} />
          <Stop offset="100%" stopColor={colors[1]} stopOpacity={1} />
        </RadialGradient>
      </Defs>
      <Path d="M38,89 A48,42 0 1 1 62,89 L38,89 Z" fill="url(#orbFallbackFill)" />
    </Svg>
  );
}

/** The spiky radiating burst — only shown while Jeeko is actively listening, the
 * "he's powering up to hear you" moment from the reference art. Built from a
 * generated star polygon rather than a hand-written path so the spike count/ratio
 * is easy to tune. */
function starPoints(points: number, outerR: number, innerR: number): string {
  const step = Math.PI / points;
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    const x = 50 + r * Math.cos(angle);
    const y = 50 + r * Math.sin(angle);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return `${d}Z`;
}
const BURST_PATH = starPoints(10, 49, 30);

function Burst({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="burstFill" cx="50%" cy="50%" r="60%">
          <Stop offset="0%" stopColor={color} stopOpacity={0.55} />
          <Stop offset="100%" stopColor={color} stopOpacity={0.08} />
        </RadialGradient>
      </Defs>
      <Path d={BURST_PATH} fill="url(#burstFill)" />
    </Svg>
  );
}

/** A smooth, undulating ring — sampled as a many-point sine-modulated circle rather
 * than straight spikes — so that rotating it reads as water rippling around the
 * blob, not a mechanical gear turning. */
function wavyRingPath(baseR: number, waves: number, amp: number, phase: number, samples = 64): string {
  let d = "";
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * Math.PI * 2;
    const r = baseR + amp * Math.sin(waves * t + phase);
    const x = 50 + r * Math.cos(t);
    const y = 50 + r * Math.sin(t);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
  }
  return `${d}Z`;
}
const FLOW_PATH_OUTER = wavyRingPath(45, 6, 5, 0);
const FLOW_PATH_INNER = wavyRingPath(40, 8, 4, 1.4);

function FlowRing({ size, color, pathD, gradId, innerOpacity }: { size: number; color: string; pathD: string; gradId: string; innerOpacity: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={gradId} cx="50%" cy="50%" r="55%">
          <Stop offset="0%" stopColor={color} stopOpacity={0} />
          <Stop offset="70%" stopColor={color} stopOpacity={innerOpacity * 0.5} />
          <Stop offset="100%" stopColor={color} stopOpacity={innerOpacity} />
        </RadialGradient>
      </Defs>
      <Path d={pathD} fill={`url(#${gradId})`} />
    </Svg>
  );
}

/**
 * The Home screen's centerpiece — a living gradient slime standing in for "Jeeko is
 * here," not a mic button. It behaves like slime, not a rigid ball: a slow inverse-
 * scaleX/scaleY breathing wobble at rest, a squash-and-bulge on touch, and a springy
 * overshoot back into shape on release — real squash & stretch physics via native-
 * driven transforms. While listening, a spiky aura burst flares up behind it; while
 * speaking, two wavy rings spin in opposite directions like water flowing around it —
 * every other state stays on the plain, stable pulsing glow. One tap starts a
 * hands-free voice loop (see useVoiceSession).
 */
export function VoiceOrb({ state, size = 176, onPress }: { state: VoiceState; size?: number; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const touchFlash = useRef(new Animated.Value(0)).current;
  const burstOpacity = useRef(new Animated.Value(0)).current;
  const burstSpin = useRef(new Animated.Value(0)).current;
  // Watery flowing aura — only visible while speaking; the two wavy rings spin in
  // opposite directions at different speeds so they read as currents swirling
  // around the blob rather than one ring rotating. Idle/listening/thinking stay on
  // the plain pulsing glow below, which is deliberately "stable" by comparison.
  const flowOpacity = useRef(new Animated.Value(0)).current;
  const flowSpin1 = useRef(new Animated.Value(0)).current;
  const flowSpin2 = useRef(new Animated.Value(0)).current;

  // Idle breathing: scaleX and scaleY drift in opposite directions, like a body of
  // liquid gently shifting its own volume — this alone is what makes it read as
  // "soft" rather than "a ball" even before anyone touches it.
  const wobble = useRef(new Animated.Value(0)).current;
  // Touch squash/stretch, layered on top of the idle wobble via Animated.multiply.
  const pressX = useRef(new Animated.Value(1)).current;
  const pressY = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const duration = STATE_TEMPO[state];
    pulse.setValue(0);
    pulse2.setValue(0);

    const loop1 = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration, useNativeDriver: true })
      ])
    );
    const loop2 = Animated.loop(
      Animated.sequence([
        Animated.delay(duration * 0.35),
        Animated.timing(pulse2, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(pulse2, { toValue: 0, duration, useNativeDriver: true })
      ])
    );
    loop1.start();
    loop2.start();

    Animated.timing(burstOpacity, {
      toValue: state === "listening" ? 1 : 0,
      duration: 250,
      useNativeDriver: true
    }).start();
    Animated.timing(flowOpacity, {
      toValue: state === "speaking" ? 1 : 0,
      duration: 250,
      useNativeDriver: true
    }).start();

    return () => {
      loop1.stop();
      loop2.stop();
    };
  }, [state, pulse, pulse2, burstOpacity, flowOpacity]);

  useEffect(() => {
    const wobbleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(wobble, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wobble, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
      ])
    );
    const spinLoop = Animated.loop(
      Animated.timing(burstSpin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true })
    );
    // Kept running continuously (even while invisible) so it's already in motion
    // the instant it fades in on speaking, instead of visibly starting from rest.
    const flowLoop1 = Animated.loop(
      Animated.timing(flowSpin1, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true })
    );
    const flowLoop2 = Animated.loop(
      Animated.timing(flowSpin2, { toValue: 1, duration: 4600, easing: Easing.linear, useNativeDriver: true })
    );
    wobbleLoop.start();
    spinLoop.start();
    flowLoop1.start();
    flowLoop2.start();
    return () => {
      wobbleLoop.stop();
      spinLoop.stop();
      flowLoop1.stop();
      flowLoop2.stop();
    };
  }, [wobble, burstSpin, flowSpin1, flowSpin2]);

  const glowColor = STATE_GLOW[state];
  const amp = STATE_AMPLITUDE[state];

  const ringTransform = (value: Animated.Value, baseScale: number) => ({
    transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [baseScale, baseScale + amp] }) }],
    opacity: value.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] })
  });

  const wobbleX = wobble.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const wobbleY = wobble.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });
  const bodyScaleX = Animated.multiply(wobbleX, pressX);
  const bodyScaleY = Animated.multiply(wobbleY, pressY);
  const spinDeg = burstSpin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const flowDeg1 = flowSpin1.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const flowDeg2 = flowSpin2.interpolate({ inputRange: [0, 1], outputRange: ["360deg", "0deg"] });
  // Real audio loudness (see voice/speechAmplitude.ts), not a fixed loop — the
  // flowing aura genuinely swells with louder words and settles during pauses,
  // instead of just rotating on a timer regardless of what's actually said.
  // Sits at 0 outside "speaking" (and for on-device TTS, which has no envelope
  // data), where the base rotation alone still carries the effect.
  const liveAmpScale = liveSpeechAmplitude.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.32] });

  function handlePressIn() {
    Animated.timing(touchFlash, { toValue: 1, duration: 110, useNativeDriver: true }).start();
    // Squash flat and bulge sideways — like a fingertip pressing into slime.
    Animated.spring(pressY, { toValue: 0.8, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
    Animated.spring(pressX, { toValue: 1.16, useNativeDriver: true, speed: 30, bounciness: 0 }).start();
  }
  function handlePressOut() {
    Animated.timing(touchFlash, { toValue: 0, duration: 500, useNativeDriver: true }).start();
    // Release with real overshoot — bounciness makes it jiggle past round before settling.
    Animated.spring(pressY, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 22 }).start();
    Animated.spring(pressX, { toValue: 1, useNativeDriver: true, speed: 10, bounciness: 22 }).start();
  }

  const auraSize = size * 2.1;
  const midSize = size * 1.5;
  const burstSize = size * 1.9;

  return (
    <PressableScale
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeScale={1}
      haptic="medium"
      style={styles.wrap}
    >
      <View style={[styles.container, { width: auraSize, height: auraSize }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.centered,
            { width: burstSize, height: burstSize },
            { opacity: burstOpacity, transform: [{ rotate: spinDeg }] }
          ]}
        >
          <Burst size={burstSize} color={glowColor} />
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.centered,
            { width: midSize, height: midSize },
            { opacity: flowOpacity, transform: [{ rotate: flowDeg1 }, { scale: liveAmpScale }] }
          ]}
        >
          <FlowRing size={midSize} color={glowColor} pathD={FLOW_PATH_OUTER} gradId="flowOuter" innerOpacity={0.55} />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.centered,
            { width: midSize, height: midSize },
            { opacity: flowOpacity, transform: [{ rotate: flowDeg2 }, { scale: liveAmpScale }] }
          ]}
        >
          <FlowRing size={midSize} color={glowColor} pathD={FLOW_PATH_INNER} gradId="flowInner" innerOpacity={0.4} />
        </Animated.View>

        <Animated.View
          style={[
            styles.centered,
            { width: auraSize, height: auraSize },
            { transform: [{ scaleX: bodyScaleX }, { scaleY: bodyScaleY }] }
          ]}
        >
          <Animated.View style={[styles.centered, { width: auraSize, height: auraSize }, ringTransform(pulse, 0.82)]}>
            <GlowLayer size={auraSize} color={glowColor} gradId="auraOuter" innerOpacity={0.5} />
          </Animated.View>
          <Animated.View style={[styles.centered, { width: midSize, height: midSize }, ringTransform(pulse2, 0.86)]}>
            <GlowLayer size={midSize} color={glowColor} gradId="auraMid" innerOpacity={0.6} />
          </Animated.View>

          <View style={[styles.centered, { width: size, height: size }]}>
            <VoiceOrbGlass size={size} colors={STATE_SPHERE[state]} />
            {/* Instant touch feedback: a bright radial flash on contact, before the
                async recording/permission flow has resolved anything. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.centered,
                { width: size, height: size, opacity: touchFlash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] }) }
              ]}
            >
              <GlowLayer size={size} color="#FFFFFF" gradId="touchFlash" innerOpacity={1} />
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  container: { alignItems: "center", justifyContent: "center" },
  centered: { position: "absolute", alignItems: "center", justifyContent: "center" }
});
