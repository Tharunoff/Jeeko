import { File, Paths } from "expo-file-system";
import { ttsKeyRotator } from "../llm/apiKeyPool";
import { base64ToBytes, buildWavHeader, computeAmplitudeEnvelope, type SpeechClip } from "./pcmAudio";

const TTS_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Google retired earlier TTS previews the same way it retired gemini-2.0-flash —
// if this ever 404s, check `GET {TTS_BASE}?key=...` for the current TTS-capable
// model name and swap it here.
const TTS_MODEL = "gemini-3.1-flash-tts-preview";
// One of Gemini's 30 prebuilt voices — "Charon" reads as calm and informative,
// closer to the competent-assistant tone Jeeko is going for than a chirpy one.
const VOICE_NAME = "Charon";

export type { SpeechClip };

export function hasGeminiTts(): boolean {
  return ttsKeyRotator.hasAvailableKey();
}

/**
 * Turns text into a natural, neural-voiced reply via Gemini's TTS model,
 * writes it to a temp WAV file, and computes its real amplitude envelope for
 * the speaking aura to react to. Returns null if TTS isn't configured or the
 * call fails — callers should fall back to the on-device voice in that case
 * rather than staying silent.
 *
 * This is the one-shot REST path — it waits for the whole clip to render
 * before returning anything. geminiLiveTts.ts is the streaming alternative
 * (Live API), preferred when available since audio starts arriving almost
 * immediately instead of only after the full reply is done generating.
 */
export async function synthesizeSpeech(text: string): Promise<SpeechClip | null> {
  if (!text.trim()) return null;
  let key = ttsKeyRotator.getActiveKey();
  if (!key) return null;

  try {
    // Retry across the key pool on quota exhaustion (429) — one attempt per
    // key at most.
    let response: Response;
    let attempts = 0;
    for (;;) {
      attempts++;
      const url = `${TTS_BASE}/${TTS_MODEL}:generateContent?key=${key}`;
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } }
          }
        })
      });
      if (response.status !== 429) break;
      const nextKey = ttsKeyRotator.rotateAfterExhaustion(key);
      if (!nextKey || attempts >= 8) break;
      key = nextKey;
    }

    if (!response.ok) {
      console.warn("Gemini TTS error:", response.status, await response.text().catch(() => ""));
      return null;
    }

    const data = await response.json();
    const part = data.candidates?.[0]?.content?.parts?.[0];
    const base64: string | undefined = part?.inlineData?.data;
    const mimeType: string = part?.inlineData?.mimeType ?? "";
    if (!base64) return null;

    const rateMatch = mimeType.match(/rate=(\d+)/);
    const channelsMatch = mimeType.match(/channels=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const channels = channelsMatch ? parseInt(channelsMatch[1], 10) : 1;

    const pcmBytes = base64ToBytes(base64);
    const { envelope, envelopeStepMs } = computeAmplitudeEnvelope(pcmBytes, sampleRate, channels);
    const header = buildWavHeader(pcmBytes.length, sampleRate, channels, 16);
    const wavBytes = new Uint8Array(header.length + pcmBytes.length);
    wavBytes.set(header, 0);
    wavBytes.set(pcmBytes, header.length);

    const file = new File(Paths.cache, `jeeko_tts_${Date.now()}.wav`);
    file.create({ overwrite: true });
    file.write(wavBytes);
    return { uri: file.uri, envelope, envelopeStepMs };
  } catch (err) {
    console.warn("Gemini TTS error:", err);
    return null;
  }
}
