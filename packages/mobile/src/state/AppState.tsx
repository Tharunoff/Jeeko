import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DataStore, LLMProvider, Message, UserProfile } from "@personalos/core";
import { runAgentLoop } from "@personalos/core";
import { SqliteDataStore } from "../db/sqliteStore";
import { seedSampleData } from "../db/seed";
import { GeminiProvider } from "../llm/GeminiProvider";
import { PA_SYSTEM_PROMPT } from "../llm/systemPrompt";
import { tryOfflineIntent } from "../chat/offlineIntentMatcher";
import { requestNotificationPermissions, scheduleNotifications } from "../notifications/scheduler";

export interface ChatResult {
  text: string;
  source: "offline" | "gemini" | "fallback";
}

export interface ChatInput {
  text?: string;
  audio?: { base64: string; mimeType: string };
}

interface AppStateValue {
  store: DataStore | null;
  user: UserProfile | null;
  ready: boolean;
  /** Bumped after any mutation so screens re-run their engine calculations. */
  version: number;
  refresh: () => void;
  seed: () => Promise<void>;
  /** Send a chat message (text and/or voice) to the PA. Text tries the offline
   * matcher first; voice always needs Gemini since transcription happens there. */
  chat: (input: ChatInput, history: Message[]) => Promise<ChatResult>;
  /** Whether Gemini is configured and available */
  hasGemini: boolean;
}

const AppStateContext = createContext<AppStateValue | null>(null);

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<DataStore | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [hasGemini, setHasGemini] = useState(false);
  const providerRef = useRef<LLMProvider | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let db: SqliteDataStore;
      try {
        db = await SqliteDataStore.open();
        // Touch the DB now so a corrupted file (e.g. a broken web OPFS store from an
        // interrupted write) throws here, before the app is otherwise fully committed to it.
        await db.getPreference("__healthcheck");
      } catch (err) {
        console.warn("Local database failed to open, resetting and retrying:", err);
        await SqliteDataStore.reset().catch(() => {});
        db = await SqliteDataStore.open();
      }
      let existingUser = await db.getUser();
      if (!existingUser) {
        existingUser = {
          id: "local_user",
          name: "You",
          timezone: DEFAULT_TIMEZONE,
          preferredWakeTime: "07:00",
          preferredSleepTime: "23:00",
          productivityPreferences: { maxDeepWorkSession: 90 }
        };
        await db.saveUser(existingUser);
      }
      if (cancelled) return;

      // Check for Gemini API key
      const apiKey = await db.getPreference("gemini_api_key");
      if (apiKey && apiKey.length > 10) {
        providerRef.current = new GeminiProvider({
          apiKey,
          systemInstruction: PA_SYSTEM_PROMPT
        });
        setHasGemini(true);
      }

      setStore(db);
      setUser(existingUser);
      setReady(true);

      // Request notification permissions (best-effort)
      requestNotificationPermissions().catch(() => {});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh Gemini provider when version changes (settings might have changed)
  useEffect(() => {
    if (!store || !ready) return;
    (async () => {
      const apiKey = await store.getPreference("gemini_api_key");
      const offlineOnly = await store.getPreference("offline_only");
      if (apiKey && apiKey.length > 10 && offlineOnly !== "true") {
        providerRef.current = new GeminiProvider({
          apiKey,
          systemInstruction: PA_SYSTEM_PROMPT
        });
        setHasGemini(true);
      } else {
        providerRef.current = null;
        setHasGemini(false);
      }

      // Refresh user profile
      const u = await store.getUser();
      if (u) setUser(u);
    })();
  }, [store, ready, version]);

  // Reschedule notifications whenever the plan changes
  useEffect(() => {
    if (!store || !ready) return;
    scheduleNotifications({ store, now: new Date() }).catch(() => {});
  }, [store, ready, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const seed = useCallback(async () => {
    if (!store || !user) return;
    await seedSampleData(store, user);
    refresh();
  }, [store, user, refresh]);

  const chat = useCallback(
    async (input: ChatInput, history: Message[]): Promise<ChatResult> => {
      if (!store) return { text: "App not ready yet.", source: "fallback" };

      // Voice messages have no text to pattern-match offline — transcription only
      // happens inside the Gemini call itself, so voice always needs Gemini.
      let offlineResult: string | null = null;
      if (input.text && !input.audio) {
        offlineResult = await tryOfflineIntent(input.text, store);
        if (offlineResult) {
          return { text: offlineResult, source: "offline" };
        }
      }

      const provider = providerRef.current;
      const currentUser = user;
      if (provider && currentUser) {
        try {
          const result = await runAgentLoop({
            messages: [
              ...history,
              { role: "user" as const, text: input.text, audio: input.audio }
            ],
            context: { now: new Date(), user: currentUser },
            provider,
            store,
            now: new Date(),
            maxRounds: 6
          });
          // Trigger refresh so screens pick up any state changes the tools made
          refresh();
          return { text: result.text, source: "gemini" };
        } catch (e) {
          console.warn("Gemini error, falling back:", e);
          return {
            text: `I couldn't reach the AI service right now. ${
              offlineResult ??
              'Try rephrasing with something like "what should I do now" or "how much free time do I have today".'
            }`,
            source: "fallback"
          };
        }
      }

      if (input.audio) {
        return {
          text: "Voice needs a Gemini API key configured in Settings — that's what transcribes and understands what you said.",
          source: "fallback"
        };
      }

      // No Gemini configured
      return {
        text: 'This needs a live AI connection to understand — set up your Gemini API key in Settings, or try a command like "what should I do now" or "how much free time do I have".',
        source: "fallback"
      };
    },
    [store, user, refresh]
  );

  const value = useMemo(
    () => ({ store, user, ready, version, refresh, seed, chat, hasGemini }),
    [store, user, ready, version, refresh, seed, chat, hasGemini]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
