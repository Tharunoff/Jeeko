import React, { useRef, useState } from "react";
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAudioRecorder, AudioModule } from "expo-audio";
import { File } from "expo-file-system";
import type { Message } from "@personalos/core";
import { useAppState, type RichData } from "../state/AppState";
import { Colors, CardShadow, SmallShadow } from "../theme/colors";
import { VOICE_RECORDING_OPTIONS, voiceMimeTypeForPlatform } from "../voice/recordingOptions";
import { speak, stopSpeaking } from "../voice/speech";
import { PressableScale } from "../components/PressableScale";
import { FadeInUp } from "../components/FadeInUp";
import { VoiceOrb } from "../components/VoiceOrb";
import { WeekMiniCard } from "../components/WeekMiniCard";
import { TodayMiniCard } from "../components/TodayMiniCard";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: "offline" | "gemini" | "fallback";
  wasVoice?: boolean;
  richData?: RichData;
}

const SUGGESTION_CHIPS = [
  "What should I do now?",
  "How much free time today?",
  "Can I finish my project?",
  "I'm tired",
  "Plan my week"
];

// Below this, a hold is treated as an accidental tap and discarded rather than
// sending a near-silent blip of audio.
const MIN_RECORDING_MS = 400;
const CAN_RECORD = Platform.OS !== "web"; // web mic/recording support is unreliable across browsers; native only for now

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ChatScreen({ onClose }: { onClose: () => void }) {
  const { chat, hasGemini, refresh, store, user } = useAppState();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: hasGemini
        ? "I'm Jeeko. Ask me anything, or hold the mic to talk — I'll calculate real answers from your actual schedule and priorities."
        : "I'm running in offline mode. I can handle common commands like \"what should I do now\", \"how much free time today\", or \"can I finish X\". Set up a Gemini API key in Settings for full natural-language support and voice."
    }
  ]);
  const [history] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const dotAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Always call the hook (Rules of Hooks) — CAN_RECORD only gates whether we ever
  // actually start/stop it, since expo-audio's web recording support is unreliable.
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const startedAtRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function startDotAnimation() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(dotAnim, { toValue: 0, duration: 600, useNativeDriver: true })
      ])
    ).start();
  }

  function stopDotAnimation() {
    dotAnim.stopAnimation();
    dotAnim.setValue(0);
  }

  function startPulse() {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true })
      ])
    ).start();
  }

  function stopPulse() {
    pulseAnim.stopAnimation();
    pulseAnim.setValue(1);
  }

  async function runChat(chatInput: { text?: string; audio?: { base64: string; mimeType: string } }, userMsg: ChatMessage) {
    stopSpeaking();
    setSending(true);
    startDotAnimation();
    setMessages((m) => [...m, userMsg]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const result = await chat(chatInput, history);
      const assistantMsg: ChatMessage = {
        id: `a_${Date.now()}`,
        role: "assistant",
        text: result.text,
        source: result.source,
        richData: result.richData
      };
      setMessages((m) => [...m, assistantMsg]);

      // Add to LLM history for multi-turn context. Voice turns are represented by a
      // lightweight placeholder rather than re-sending audio bytes on every follow-up.
      history.push({ role: "user" as const, text: chatInput.text ?? "(voice message)" });
      history.push({ role: "assistant" as const, text: result.text });

      // Spoken replies for voice-in, voice-out — the point of holding the mic.
      if (userMsg.wasVoice && result.source !== "fallback") {
        speak(result.text);
      }

      refresh();
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: `e_${Date.now()}`,
          role: "assistant",
          text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}`
        }
      ]);
    } finally {
      setSending(false);
      stopDotAnimation();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  async function send(text?: string) {
    const msgText = (text ?? input).trim();
    if (!msgText || sending || isRecording) return;
    setInput("");
    await runChat({ text: msgText }, { id: `u_${Date.now()}`, role: "user", text: msgText });
  }

  async function startRecording() {
    if (!CAN_RECORD || sending) return;
    if (!hasGemini) {
      Alert.alert("Voice needs Gemini", "Add your Gemini API key in Settings to talk to Jeeko.");
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
      setRecordingMs(0);
      setIsRecording(true);
      startPulse();
      tickRef.current = setInterval(() => {
        if (startedAtRef.current) setRecordingMs(Date.now() - startedAtRef.current);
      }, 200);
    } catch (err) {
      console.warn("Voice recording error:", err);
      setIsRecording(false);
    }
  }

  async function finishRecording() {
    if (!CAN_RECORD || !isRecording) return;
    if (tickRef.current) clearInterval(tickRef.current);
    const finalDuration = startedAtRef.current ? Date.now() - startedAtRef.current : 0;
    setIsRecording(false);
    stopPulse();

    try {
      await recorder.stop();
    } catch (err) {
      console.warn("Voice stop-recording error:", err);
      return;
    }

    if (finalDuration < MIN_RECORDING_MS || !recorder.uri) return;

    try {
      const file = new File(recorder.uri);
      const base64 = await file.base64();
      await runChat(
        { audio: { base64, mimeType: voiceMimeTypeForPlatform() } },
        { id: `u_${Date.now()}`, role: "user", text: "Voice message", wasVoice: true }
      );
    } catch (err) {
      console.warn("Voice submit error:", err);
      Alert.alert("Couldn't send voice message", "Please try again.");
    }
  }

  function handleClose() {
    stopSpeaking();
    onClose();
  }

  // Jeeko shrinks down to a small avatar hovering over the input whenever the
  // latest thing he said came with a visual (a week view, today's schedule) —
  // a quiet signal that there's something to look at, not just read. Tapping
  // him reads that reply back out loud.
  const lastMessage = messages[messages.length - 1];
  const miniJeekoMessage =
    lastMessage?.role === "assistant" && lastMessage.richData ? lastMessage : undefined;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Jeeko</Text>
          <View style={styles.headerSubRow}>
            <View style={[styles.statusDot, { backgroundColor: hasGemini ? Colors.success : Colors.warning }]} />
            <Text style={styles.headerSub}>{hasGemini ? "AI connected" : "Offline mode"}</Text>
          </View>
        </View>
        <PressableScale onPress={handleClose} style={styles.closeButton} haptic="light">
          <Feather name="x" size={16} color={Colors.textSecondary} />
        </PressableScale>
      </View>

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.map((m) => (
          <FadeInUp
            key={m.id}
            style={[
              styles.bubble,
              m.role === "user" ? styles.bubbleUser : styles.bubbleAssistant
            ]}
          >
            <View style={styles.bubbleContentRow}>
              {m.wasVoice && (
                <Feather name="mic" size={13} color="rgba(255,255,255,0.8)" style={{ marginRight: 6, marginTop: 3 }} />
              )}
              <Text style={[styles.bubbleText, m.role === "user" && styles.bubbleTextUser]}>{m.text}</Text>
            </View>
            {m.richData?.type === "week" && <WeekMiniCard result={m.richData.result} />}
            {m.richData?.type === "today" && store && user && (
              <TodayMiniCard result={m.richData.result} store={store} timezone={user.timezone} />
            )}
            <View style={styles.bubbleFooterRow}>
              {m.source && m.role === "assistant" && (
                <Text style={styles.sourceTag}>
                  {m.source === "gemini" ? "via AI" : m.source === "offline" ? "local engine" : ""}
                </Text>
              )}
              {m.role === "assistant" && (
                <PressableScale onPress={() => speak(m.text)} hitSlop={8} haptic="light" activeScale={0.85}>
                  <Feather name="volume-2" size={13} color={Colors.textMuted} />
                </PressableScale>
              )}
            </View>
          </FadeInUp>
        ))}

        {/* Typing indicator */}
        {sending && (
          <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
            <Animated.View style={[styles.dot, { opacity: dotAnim }]} />
            <Animated.View
              style={[
                styles.dot,
                {
                  opacity: dotAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 1]
                  })
                }
              ]}
            />
            <Animated.View
              style={[
                styles.dot,
                {
                  opacity: dotAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.6, 1]
                  })
                }
              ]}
            />
            <Text style={styles.thinkingText}>Thinking…</Text>
          </View>
        )}
      </ScrollView>

      {/* Suggestion chips */}
      {messages.length <= 2 && !sending && !isRecording && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
        >
          {SUGGESTION_CHIPS.map((chip) => (
            <PressableScale
              key={chip}
              style={styles.chip}
              onPress={() => send(chip)}
              haptic="selection"
              activeScale={0.95}
            >
              <Text style={styles.chipText}>{chip}</Text>
            </PressableScale>
          ))}
        </ScrollView>
      )}

      {/* Miniature Jeeko — hovers above the input when the last reply came with
          something visual, so it's clear there's more than just the text. */}
      {miniJeekoMessage && !isRecording && (
        <FadeInUp key={miniJeekoMessage.id} style={styles.miniJeeko}>
          <VoiceOrb state="idle" size={40} onPress={() => speak(miniJeekoMessage.text)} />
        </FadeInUp>
      )}

      {/* Input */}
      {isRecording ? (
        <View style={styles.recordingRow}>
          <Animated.View style={[styles.recordingDot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={styles.recordingText}>Listening… {formatDuration(recordingMs)}</Text>
          <Text style={styles.recordingHint}>Release to send</Text>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Tell Jeeko what's happening…"
            placeholderTextColor={Colors.textMuted}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send()}
            returnKeyType="send"
            editable={!sending}
            multiline
          />
          {input.trim() ? (
            <PressableScale
              style={[styles.sendButton, sending && { opacity: 0.4 }]}
              onPress={() => send()}
              disabled={sending}
              haptic="medium"
            >
              <Feather name="arrow-up" size={18} color="#fff" />
            </PressableScale>
          ) : CAN_RECORD ? (
            <PressableScale
              style={[
                styles.sendButton,
                !hasGemini && styles.micButtonDisabled,
                isRecording && styles.micButtonPressed
              ]}
              onPressIn={startRecording}
              onPressOut={finishRecording}
              disabled={sending}
              haptic="medium"
              activeScale={0.88}
            >
              <Feather name="mic" size={18} color="#fff" />
            </PressableScale>
          ) : (
            <View style={[styles.sendButton, { opacity: 0.3 }]}>
              <Feather name="mic-off" size={18} color="#fff" />
            </View>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 54,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.separator,
    backgroundColor: Colors.bgCard
  },
  headerCenter: { flex: 1 },
  headerTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: "600", letterSpacing: -0.4 },
  headerSubRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  headerSub: { color: Colors.textMuted, fontSize: 12 },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.bgCardAlt,
    alignItems: "center",
    justifyContent: "center"
  },
  messages: { flex: 1 },
  bubble: {
    borderRadius: 20,
    padding: 14,
    marginBottom: 10,
    maxWidth: "85%"
  },
  bubbleUser: {
    backgroundColor: Colors.accent,
    alignSelf: "flex-end",
    borderBottomRightRadius: 6
  },
  bubbleAssistant: {
    backgroundColor: Colors.bgCard,
    alignSelf: "flex-start",
    borderBottomLeftRadius: 6,
    ...SmallShadow
  },
  bubbleContentRow: { flexDirection: "row" },
  bubbleText: { flex: 1, color: Colors.textPrimary, fontSize: 16, lineHeight: 22 },
  bubbleTextUser: { color: "#fff" },
  bubbleFooterRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  sourceTag: {
    color: Colors.textMuted,
    fontSize: 11,
    fontStyle: "italic"
  },
  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 14
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent
  },
  thinkingText: {
    color: Colors.textMuted,
    fontSize: 14,
    marginLeft: 8
  },
  chipsScroll: {
    maxHeight: 54,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.separator
  },
  chip: {
    backgroundColor: Colors.bgCard,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginVertical: 8
  },
  chipText: { color: Colors.textSecondary, fontSize: 14 },
  inputRow: {
    flexDirection: "row",
    padding: 12,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.separator,
    backgroundColor: Colors.bgCard
  },
  miniJeeko: {
    position: "absolute",
    right: 14,
    bottom: 72,
    zIndex: 20,
    shadowColor: Colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6
  },
  input: {
    flex: 1,
    backgroundColor: Colors.bgCardAlt,
    color: Colors.textPrimary,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
    fontSize: 16,
    maxHeight: 100
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-end"
  },
  micButtonPressed: { backgroundColor: Colors.danger },
  micButtonDisabled: { backgroundColor: Colors.bgCardAlt },

  // Recording state
  recordingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.separator,
    backgroundColor: Colors.bgCard
  },
  recordingDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.danger },
  recordingText: { color: Colors.textPrimary, fontSize: 16, fontWeight: "600" },
  recordingHint: { flex: 1, color: Colors.textMuted, fontSize: 14, textAlign: "right" }
});
