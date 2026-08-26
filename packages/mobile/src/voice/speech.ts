import * as Speech from "expo-speech";

/** Speaks text aloud, on-device, no network. Stops any in-progress utterance first
 * so replies never overlap. */
export function speak(text: string): void {
  Speech.stop();
  Speech.speak(text, { rate: 1.0, pitch: 1.0 });
}

export function stopSpeaking(): void {
  Speech.stop();
}

export function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}
