import { useCallback, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { useAudioRecorder, AudioModule } from "expo-audio";
import { File } from "expo-file-system";
import type { Message } from "@personalos/core";
import { useAppState } from "../state/AppState";
import { VOICE_RECORDING_OPTIONS, voiceMimeTypeForPlatform } from "../voice/recordingOptions";
import { speak, stopSpeaking } from "../voice/speech";

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";

const MIN_RECORDING_MS = 400;
const MAX_RECORDING_MS = 30000;
const RELISTEN_DELAY_MS = 500;
// Metering is in dB (roughly -160 silence to 0 loudest). Anything above this
// counts as "the user is talking"; once that's happened at least once, this
// much continuous quiet auto-stops the recording instead of waiting for the
// 30s safety cap or a manual tap. Tuned conservatively (errs toward waiting
// slightly too long rather than cutting someone off mid-sentence) — may need
// adjusting once heard on a real device's actual mic sensitivity.
const SPEECH_THRESHOLD_DB = -35;
const SILENCE_HOLD_MS = 1400;
export const CAN_RECORD = Platform.OS !== "web";

/**
 * A hands-free voice loop: tap once to start listening, tap again (or just stop
 * talking long enough to hit the safety cap) to send. Once the reply finishes
 * speaking, listening re-arms automatically — no re-opening anything, no manual
 * send — so a back-and-forth feels like one continuous conversation rather than
 * "record a clip, wait, get a clip back." Tapping while it's speaking barges in:
 * cuts the reply off and starts listening immediately.
 */
export function useVoiceSession() {
  const { chat, hasGemini, refresh } = useAppState();
  const [state, setState] = useState<VoiceState>("idle");
  const [sessionActive, setSessionActive] = useState(false);
  const [lastUserText, setLastUserText] = useState<string | null>(null);
  const [lastReplyText, setLastReplyText] = useState<string | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);

  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const historyRef = useRef<Message[]>([]);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxCapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<VoiceState>("idle");
  stateRef.current = state;
  // Silence-detection state for the current recording — reset each time
  // startListening() runs.
  const hasSpokenRef = useRef(false);
  const silenceStartRef = useRef<number | null>(null);

  function clearTimers() {
    if (tickRef.current) clearInterval(tickRef.current);
    if (maxCapRef.current) clearTimeout(maxCapRef.current);
    tickRef.current = null;
    maxCapRef.current = null;
  }

  const startListening = useCallback(async () => {
    if (!hasGemini) {
      Alert.alert("Voice needs Gemini", "Add your Gemini API key in Settings to talk to Jeeko.");
      return;
    }
    if (!CAN_RECORD) {
      Alert.alert("Voice isn't available here", "Try this on a real device build.");
      return;
    }
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Microphone permission needed", "Enable microphone access to talk to Jeeko.");
        return;
      }
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAtRef.current = Date.now();
      hasSpokenRef.current = false;
      silenceStartRef.current = null;
      setRecordingMs(0);
      setState("listening");
      tickRef.current = setInterval(() => {
        if (startedAtRef.current) setRecordingMs(Date.now() - startedAtRef.current);

        // Auto-stop once the user has spoken and then gone quiet for a
        // while — a real conversation, not "hold to talk."
        const metering = recorder.getStatus().metering;
        if (metering === undefined) return;
        const now = Date.now();
        if (metering > SPEECH_THRESHOLD_DB) {
          hasSpokenRef.current = true;
          silenceStartRef.current = null;
        } else if (hasSpokenRef.current) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = now;
          } else if (now - silenceStartRef.current >= SILENCE_HOLD_MS) {
            void stopAndSend();
          }
        }
      }, 100);
      maxCapRef.current = setTimeout(() => {
        if (stateRef.current === "listening") void stopAndSend();
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.warn("Voice recording error:", err);
      setState("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasGemini, recorder]);

  const stopAndSend = useCallback(async () => {
    if (stateRef.current !== "listening") return;
    clearTimers();
    const finalDuration = startedAtRef.current ? Date.now() - startedAtRef.current : 0;

    try {
      await recorder.stop();
    } catch (err) {
      console.warn("Voice stop-recording error:", err);
      setState("idle");
      return;
    }

    if (finalDuration < MIN_RECORDING_MS || !recorder.uri) {
      setState(sessionActive ? "idle" : "idle");
      return;
    }

    setState("thinking");
    try {
      const file = new File(recorder.uri);
      const base64 = await file.base64();
      const result = await chat(
        { audio: { base64, mimeType: voiceMimeTypeForPlatform() } },
        historyRef.current
      );
      historyRef.current = [
        ...historyRef.current,
        { role: "user" as const, text: "(voice message)" },
        { role: "assistant" as const, text: result.text }
      ];
      setLastUserText("Voice message");
      setLastReplyText(result.text);
      refresh();

      if (result.source === "fallback") {
        setState("idle");
        setSessionActive(false);
        return;
      }

      setState("speaking");
      speak(result.text, {
        onDone: () => {
          // Re-arm listening automatically — the continuous-conversation loop —
          // unless the user has ended the session in the meantime.
          setState((current) => {
            if (current !== "speaking") return current;
            return "idle";
          });
          setTimeout(() => {
            if (sessionActive) void startListening();
          }, RELISTEN_DELAY_MS);
        }
      });
    } catch (err) {
      console.warn("Voice submit error:", err);
      setState("idle");
      Alert.alert("Couldn't send voice message", "Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat, recorder, refresh, sessionActive, startListening]);

  /** The single tap handler driving the whole loop. */
  const tapOrb = useCallback(() => {
    if (state === "idle") {
      setSessionActive(true);
      void startListening();
    } else if (state === "listening") {
      void stopAndSend();
    } else if (state === "speaking") {
      // Barge in: cut the reply off and listen immediately.
      stopSpeaking();
      void startListening();
    }
    // "thinking" ignores taps — nothing useful to interrupt mid-flight.
  }, [state, startListening, stopAndSend]);

  const endSession = useCallback(() => {
    setSessionActive(false);
    stopSpeaking();
    clearTimers();
    if (stateRef.current === "listening") {
      recorder.stop().catch(() => {});
    }
    setState("idle");
  }, [recorder]);

  return {
    state,
    sessionActive,
    lastUserText,
    lastReplyText,
    recordingMs,
    tapOrb,
    endSession,
    canRecord: CAN_RECORD
  };
}
