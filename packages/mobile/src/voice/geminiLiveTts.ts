import { File, Paths } from "expo-file-system";
import { liveTtsKeyRotator } from "../llm/apiKeyPool";
import { base64ToBytes, buildWavHeader, computeAmplitudeEnvelope, type SpeechClip } from "./pcmAudio";

// Confirmed empirically against the real API (protocol docs disagreed with
// each other on several fields — see field names below, verified by actually
// connecting): a WebSocket session, one JSON "setup" message, then a text
// turn, then the reply streams back as many small audio/pcm chunks instead of
// one big blob at the end. That streaming-out behavior is the entire point of
// using this over the one-shot REST TTS in geminiTts.ts — audio starts
// arriving (and in a future pass, could start *playing*) well before the full
// reply is done generating, instead of waiting for one complete clip.
const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
// The only model confirmed (via a direct ListModels call against this
// project) to support bidiGenerateContent with native audio output. If this
// ever stops working, check `GET {rest base}/models?key=...` for models
// whose supportedGenerationMethods includes "bidiGenerateContent".
const LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest";
const VOICE_NAME = "Charon";
// Give up waiting for the initial handshake / the whole reply, respectively —
// a hung WebSocket should fail fast into the REST TTS fallback, not hang the
// voice loop indefinitely.
const SETUP_TIMEOUT_MS = 8000;
const TURN_TIMEOUT_MS = 20000;

interface LiveAudioResult {
  pcmChunks: Uint8Array[];
  sampleRate: number;
  channels: number;
}

/** One connection attempt with one key. Resolves the collected audio, or the
 * string "retry" when this key looks quota-exhausted (closed/errored before
 * producing anything) so the caller can rotate to the next key, or null on
 * any other failure (caller falls back to REST TTS, not another Live attempt). */
function attemptLiveSpeech(key: string, text: string): Promise<LiveAudioResult | "retry" | null> {
  return new Promise((resolve) => {
    let settled = false;
    let gotAnyAudio = false;
    const chunks: Uint8Array[] = [];
    let sampleRate = 24000;
    let channels = 1;
    let turnTimer: ReturnType<typeof setTimeout> | null = null;

    const ws = new WebSocket(`${LIVE_WS_URL}?key=${key}`);

    const finish = (result: LiveAudioResult | "retry" | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(setupTimer);
      if (turnTimer) clearTimeout(turnTimer);
      try {
        ws.close();
      } catch {
        // already closing/closed
      }
      resolve(result);
    };

    const setupTimer = setTimeout(() => finish(null), SETUP_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: LIVE_MODEL,
            generationConfig: { responseModalities: ["AUDIO"] },
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } }
          }
        })
      );
    };

    ws.onmessage = (event: any) => {
      let parsed: any;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (parsed.setupComplete) {
        clearTimeout(setupTimer);
        turnTimer = setTimeout(() => finish(gotAnyAudio ? { pcmChunks: chunks, sampleRate, channels } : null), TURN_TIMEOUT_MS);
        ws.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text }] }],
              turnComplete: true
            }
          })
        );
        return;
      }

      const parts = parsed.serverContent?.modelTurn?.parts;
      if (parts) {
        for (const p of parts) {
          if (p.inlineData?.data) {
            const mimeType: string = p.inlineData.mimeType ?? "";
            const rateMatch = mimeType.match(/rate=(\d+)/);
            if (rateMatch) sampleRate = parseInt(rateMatch[1], 10);
            const channelsMatch = mimeType.match(/channels=(\d+)/);
            if (channelsMatch) channels = parseInt(channelsMatch[1], 10);
            chunks.push(base64ToBytes(p.inlineData.data));
            gotAnyAudio = true;
          }
        }
      }

      if (parsed.serverContent?.turnComplete) {
        finish(gotAnyAudio ? { pcmChunks: chunks, sampleRate, channels } : null);
      }
    };

    ws.onerror = () => finish(gotAnyAudio ? { pcmChunks: chunks, sampleRate, channels } : "retry");
    ws.onclose = () => finish(gotAnyAudio ? { pcmChunks: chunks, sampleRate, channels } : "retry");
  });
}

/**
 * Speaks `text` via Gemini's Live API (a WebSocket session) instead of the
 * one-shot REST TTS call — same voice, same output format, but the audio
 * streams back progressively rather than only arriving once the whole clip
 * is done rendering server-side. Returns null if no key is available or every
 * key in the pool fails, in which case callers should fall back to the REST
 * TTS path (geminiTts.ts) rather than staying silent.
 */
export async function synthesizeSpeechLive(text: string): Promise<SpeechClip | null> {
  if (!text.trim()) return null;
  let key = liveTtsKeyRotator.getActiveKey();
  if (!key) return null;

  let result: LiveAudioResult | "retry" | null = null;
  let attempts = 0;
  while (attempts < 8) {
    attempts++;
    result = await attemptLiveSpeech(key, text);
    if (result === "retry") {
      const nextKey = liveTtsKeyRotator.rotateAfterExhaustion(key);
      if (!nextKey) {
        result = null;
        break;
      }
      key = nextKey;
      continue;
    }
    break;
  }

  if (!result || result === "retry") return null;

  const totalLength = result.pcmChunks.reduce((sum, c) => sum + c.length, 0);
  if (totalLength === 0) return null;
  const pcmBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of result.pcmChunks) {
    pcmBytes.set(chunk, offset);
    offset += chunk.length;
  }

  const { envelope, envelopeStepMs } = computeAmplitudeEnvelope(pcmBytes, result.sampleRate, result.channels);
  const header = buildWavHeader(pcmBytes.length, result.sampleRate, result.channels, 16);
  const wavBytes = new Uint8Array(header.length + pcmBytes.length);
  wavBytes.set(header, 0);
  wavBytes.set(pcmBytes, header.length);

  const file = new File(Paths.cache, `jeeko_live_tts_${Date.now()}.wav`);
  file.create({ overwrite: true });
  file.write(wavBytes);
  return { uri: file.uri, envelope, envelopeStepMs };
}
