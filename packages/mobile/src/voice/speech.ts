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

function stopGeminiPlayback() {
  stopAmplitudeTracking();
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
  Speech.speak(text, {
    rate: 1.0,
    pitch: 1.0,
    onStart: callbacks?.onStart,
    onDone: callbacks?.onDone,
    onStopped: callbacks?.onDone
  });
}

/**
 * Speaks text aloud. Three-tier fallback: Gemini's Live API first (streams
 * back progressively — see geminiLiveTts.ts — so playback can start sooner
 * than waiting for a full clip), then the one-shot REST TTS if Live fails or
 * has no quota left, then the on-device engine (instant, fully offline) if
 * neither Gemini path works. Jeeko is never silent as long as any tier works.
 * `onDone` fires when playback finishes (or is stopped), which is what lets the
 * voice loop automatically start listening again.
 *
 * While a Gemini clip plays, this also drives `liveSpeechAmplitude` from the
 * clip's real loudness envelope (see pcmAudio.ts) — polling `player.currentTime`
 * against the precomputed envelope is what lets VoiceOrb's aura actually swell
 * and settle with the words being spoken, not just loop on a fixed timer.
 */
export function speak(text: string, callbacks?: { onDone?: () => void; onStart?: () => void }): void {
  Speech.stop();
  stopGeminiPlayback();

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
