/**
 * Shared raw-PCM helpers used by both TTS paths (the REST one-shot call in
 * geminiTts.ts and the streaming Live API session in geminiLiveTts.ts) — same
 * decode/WAV-wrap/amplitude-envelope logic either way, since both ultimately
 * hand back 16-bit linear PCM that needs the same treatment before it's
 * playable or usable for the aura's reactive amplitude.
 */

/** Streaming base64 → bytes decoder. Not using a global `atob` since availability
 * varies across Hermes/web targets — this is a self-contained, dependency-free
 * implementation that just skips anything that isn't a base64 character
 * (padding, whitespace), so it doesn't care about exact padding placement. */
export function base64ToBytes(base64: string): Uint8Array {
  const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_CHARS.length; i++) lookup[B64_CHARS.charCodeAt(i)] = i;

  let outputLength = Math.floor((base64.length * 3) / 4);
  if (base64.endsWith("==")) outputLength -= 2;
  else if (base64.endsWith("=")) outputLength -= 1;

  const bytes = new Uint8Array(Math.max(0, outputLength));
  let byteIndex = 0;
  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < base64.length; i++) {
    const value = lookup[base64.charCodeAt(i)];
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[byteIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

/** Gemini's TTS returns headerless raw PCM (audio/l16 — 16-bit linear PCM) —
 * players need a real container to know the sample rate/format, so this wraps
 * it in a standard 44-byte WAV header before it ever touches disk. */
export function buildWavHeader(pcmLength: number, sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) header[offset + i] = str.charCodeAt(i);
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcmLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, pcmLength, true);

  return header;
}

/** Real loudness envelope of the actual audio, not a guess — RMS amplitude of
 * the (first-channel) PCM samples over fixed windows, normalized to the
 * clip's own peak so quiet and loud replies both use the full 0..1 range.
 * This is what lets the speaking aura's motion genuinely track what Jeeko is
 * saying instead of just looping on a timer. */
export function computeAmplitudeEnvelope(
  pcmBytes: Uint8Array,
  sampleRate: number,
  channels: number,
  windowMs = 60
): { envelope: number[]; envelopeStepMs: number } {
  const bytesPerSample = 2; // 16-bit linear PCM
  const frameBytes = bytesPerSample * channels;
  const totalFrames = Math.floor(pcmBytes.length / frameBytes);
  const framesPerWindow = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

  const envelope: number[] = [];
  for (let start = 0; start < totalFrames; start += framesPerWindow) {
    const end = Math.min(start + framesPerWindow, totalFrames);
    let sumSquares = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const byteOffset = i * frameBytes;
      if (byteOffset + 1 >= pcmBytes.length) break;
      const sample = view.getInt16(byteOffset, true) / 32768;
      sumSquares += sample * sample;
      count++;
    }
    envelope.push(count > 0 ? Math.sqrt(sumSquares / count) : 0);
  }

  const peak = envelope.reduce((m, v) => Math.max(m, v), 0.0001);
  return { envelope: envelope.map((v) => Math.min(1, v / peak)), envelopeStepMs: windowMs };
}

export interface SpeechClip {
  uri: string;
  /** Normalized 0..1 RMS loudness per `envelopeStepMs`-long window. */
  envelope: number[];
  envelopeStepMs: number;
}
