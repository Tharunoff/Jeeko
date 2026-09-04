import * as Speech from "expo-speech";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { synthesizeSpeech } from "./geminiTts";
import { synthesizeSpeechLive } from "./geminiLiveTts";
import type { SpeechClip } from "./pcmAudio";
import { setLiveSpeechAmplitude, resetLiveSpeechAmplitude } from "./speechAmplitude";

let currentPlayer: AudioPlayer | null = null;
let currentAmpInterval: ReturnType<typeof setInterval> | null = null;

function stopAmplitudeTracking() {
  if (currentAmpInterval) {
    clearInterval(currentAmpInterval);
    currentAmpInterval = null;
  }
  resetLiveSpeechAmplitude();
}

let cachedBestVoice: string | undefined = undefined;
let voiceCheckDone = false;
let voiceMode: "cloud" | "device" = "cloud";
let onDeviceAmpInterval: ReturnType<typeof setInterval> | null = null;

export async function getBestNaturalVoice(): Promise<string | undefined> {
  if (voiceCheckDone) return cachedBestVoice;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const englishVoices = voices.filter((v) => v.language.toLowerCase().startsWith("en"));
    const naturalVoice =
      englishVoices.find((v) => /natural|enhanced|network|neural/i.test(v.name) || /natural|enhanced|network|neural/i.test(v.identifier)) ??
      englishVoices.find((v) => (v as any).quality === "Enhanced") ??
      englishVoices.find((v) => /google.*en-us/i.test(v.identifier) || /siri/i.test(v.name)) ??
      englishVoices[0];

    if (naturalVoice) {
      cachedBestVoice = naturalVoice.identifier;
    }
  } catch (err) {
    console.warn("Could not query available voices:", err);
  }
  voiceCheckDone = true;
  return cachedBestVoice;
}

// Eagerly discover best voice on startup
void getBestNaturalVoice();

export function setVoiceEngine(mode: "cloud" | "device"): void {
  voiceMode = mode;
}

export function getVoiceEngine(): "cloud" | "device" {
  return voiceMode;
}

function stopOnDeviceTracking() {
  if (onDeviceAmpInterval) {
    clearInterval(onDeviceAmpInterval);
    onDeviceAmpInterval = null;
  }
  resetLiveSpeechAmplitude();
}

function stopGeminiPlayback() {
  stopAmplitudeTracking();
  stopOnDeviceTracking();
  if (!currentPlayer) return;
  try {
    currentPlayer.pause();
    currentPlayer.remove();
  } catch {
    // player may already be torn down — nothing to clean up
  }
  currentPlayer = null;
}

function speakOnDevice(text: string, callbacks?: { onDone?: () => void; onStart?: () => void }) {
  stopOnDeviceTracking();
  let step = 0;
  Speech.speak(text, {
    voice: cachedBestVoice,
    rate: 1.05,
    pitch: 1.0,
    onStart: () => {
      callbacks?.onStart?.();
      onDeviceAmpInterval = setInterval(() => {
        step = (step + 1) % 12;
        const wave = 0.25 + 0.35 * Math.sin((step / 12) * Math.PI * 2);
        setLiveSpeechAmplitude(wave, 100);
      }, 100);
    },
    onDone: () => {
      stopOnDeviceTracking();
      callbacks?.onDone?.();
    },
    onStopped: () => {
      stopOnDeviceTracking();
      callbacks?.onDone?.();
    },
    onError: () => {
      stopOnDeviceTracking();
      callbacks?.onDone?.();
    }
  });
}

/**
 * Speaks text aloud. If voiceMode is 'device', speaks instantly (<50ms) using
 * the highest-quality natural on-device voice. If 'cloud', uses Gemini's
 * neural studio voice (streaming Live first, REST fallback) and falls back
 * to device if unavailable.
 */
export function speak(text: string, callbacks?: { onDone?: () => void; onStart?: () => void }): void {
  Speech.stop();
  stopGeminiPlayback();
  stopOnDeviceTracking();

  if (voiceMode === "device") {
    speakOnDevice(text, callbacks);
    return;
  }

  void (async () => {
    let clip: SpeechClip | null = await synthesizeSpeechLive(text);
    if (!clip) clip = await synthesizeSpeech(text);
    if (!clip) {
      speakOnDevice(text, callbacks);
      return;
    }

    try {
      const player = createAudioPlayer(clip.uri);
      currentPlayer = player;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        stopAmplitudeTracking();
        try {
          player.remove();
        } catch {
          // already removed
        }
        if (currentPlayer === player) currentPlayer = null;
        callbacks?.onDone?.();
      };
      player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) finish();
      });
      callbacks?.onStart?.();
      player.play();

      if (clip.envelope.length > 0) {
        currentAmpInterval = setInterval(() => {
          const idx = Math.floor((player.currentTime * 1000) / clip.envelopeStepMs);
          setLiveSpeechAmplitude(clip.envelope[idx] ?? 0);
        }, 70);
      }
    } catch (err) {
      console.warn("Gemini TTS playback error, falling back to on-device voice:", err);
      speakOnDevice(text, callbacks);
    }
  })();
}

const FILLER_PHRASES = ["One sec.", "Let me check.", "Give me a moment.", "On it.", "One moment."];

/**
 * Speaks an immediate, on-device-only acknowledgment — no Gemini round trip,
 * so it actually starts within milliseconds rather than waiting on a network
 * call the way speak() does. Meant to fill the silence while a real reply is
 * still being computed (tool calls especially can take a couple seconds),
 * so voice mode doesn't feel dead. The real reply's speak() call stops this
 * automatically when it's ready, same as it would interrupt itself.
 */
export function speakThinkingFiller(): void {
  const phrase = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)];
  Speech.stop();
  stopGeminiPlayback();
  speakOnDevice(phrase);
}

export function stopSpeaking(): void {
  Speech.stop();
  stopGeminiPlayback();
}

export async function isSpeaking(): Promise<boolean> {
  if (currentPlayer) return currentPlayer.playing;
  return Speech.isSpeakingAsync();
}
