import { Animated } from "react-native";

/**
 * Live 0..1 loudness of whatever Jeeko is currently speaking, updated by
 * speech.ts from a real amplitude envelope computed off the actual Gemini TTS
 * audio — so the "watery flowing" aura genuinely tracks what's being said
 * (louder syllables swell the rings, pauses settle them back down) instead of
 * just looping on a fixed timer regardless of content. Idle/silent = 0.
 * Falls back to sitting at 0 for on-device TTS, which carries no amplitude
 * data — the aura still runs its base rotation loop either way, this only
 * adds the reactive layer on top when real audio data is available.
 */
export const liveSpeechAmplitude = new Animated.Value(0);

export function setLiveSpeechAmplitude(value: number, durationMs = 70): void {
  Animated.timing(liveSpeechAmplitude, {
    toValue: Math.max(0, Math.min(1, value)),
    duration: durationMs,
    useNativeDriver: true
  }).start();
}

export function resetLiveSpeechAmplitude(): void {
  liveSpeechAmplitude.stopAnimation();
  liveSpeechAmplitude.setValue(0);
}
