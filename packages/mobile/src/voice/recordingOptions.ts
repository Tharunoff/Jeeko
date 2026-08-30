import { Platform } from "react-native";
import { IOSOutputFormat, AudioQuality, type RecordingOptions } from "expo-audio";

// The built-in RecordingPresets.HIGH_QUALITY wraps AAC in an .m4a (MPEG-4)
// container on both platforms — but Gemini's "audio/aac" MIME type expects a
// bare AAC stream, not an MP4 container. This preset asks for a raw ADTS AAC
// stream on Android (which genuinely matches audio/aac) and uncompressed
// Linear PCM (.wav) on iOS (matches audio/wav) — the submitted MIME type must
// be picked to match, per platform (see voiceMimeTypeForPlatform below).
// (Proven pattern, reused verbatim from ShowUp_App's mobile/src/utils/voiceRecordingOptions.ts.)
export const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  // Needed so useVoiceSession can auto-stop listening once the user stops
  // talking, instead of waiting for a manual tap or the 30s safety cap.
  isMeteringEnabled: true,
  extension: Platform.OS === "android" ? ".aac" : ".wav",
  sampleRate: 44100,
  numberOfChannels: 2,
  bitRate: 128000,
  android: {
    extension: ".aac",
    outputFormat: "aac_adts",
    audioEncoder: "aac"
  },
  ios: {
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.MAX,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false
  },
  web: {
    mimeType: "audio/webm",
    bitsPerSecond: 128000
  }
};

export function voiceMimeTypeForPlatform(): string {
  return Platform.OS === "android" ? "audio/aac" : "audio/wav";
}
