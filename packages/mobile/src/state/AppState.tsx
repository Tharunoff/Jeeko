import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DataStore, LLMProvider, Message, UserProfile } from "@personalos/core";
import { runAgentLoop } from "@personalos/core";
import { SqliteDataStore } from "../db/sqliteStore";
import { seedSampleData } from "../db/seed";
import { GeminiProvider } from "../llm/GeminiProvider";
import { PA_SYSTEM_PROMPT } from "../llm/systemPrompt";
import { tryOfflineIntent } from "../chat/offlineIntentMatcher";
import { requestNotificationPermissions, scheduleNotifications } from "../notifications/scheduler";
import { DEV_DEFAULT_GEMINI_API_KEYS } from "../config/devDefaults";
import { configureApiKeyPool, hasAnyApiKey, setKeyPoolPersistence, loadPersistedExhaustion } from "../llm/apiKeyPool";
import { createAcademiaTools } from "../academia/academiaTools";

/** When Jeeko's answer is something better shown than said — a whole week's shape,
 * today's block-by-block schedule — the agent loop's tool calls already computed the
 * real data; this just carries the last relevant one out to the chat UI instead of
 * discarding it once the reply text is written. */
export type RichData = { type: "week"; result: any } | { type: "today"; result: any };

export interface ChatResult {
  text: string;
  source: "offline" | "gemini" | "fallback";
  richData?: RichData;
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

const WEEK_TOOLS = new Set(["get_week_schedule", "plan_week"]);
const TODAY_TOOLS = new Set(["get_today_schedule", "plan_day"]);

/** Scans the agent loop's transcript for the most recent week/today-schedule tool
 * result — the LLM already restyled it into prose, but the underlying structured
 * data is what a visual card actually needs. Week wins if both showed up in the same
 * turn, since a week view is the strictly richer thing to show. */
function extractRichData(transcript: Message[]): RichData | undefined {
  let today: unknown;
  let week: unknown;
  for (const m of transcript) {
    if (m.role !== "tool" || !m.toolName) continue;
    if (TODAY_TOOLS.has(m.toolName) && m.toolResult && !(m.toolResult as any).error) today = m.toolResult;
    if (WEEK_TOOLS.has(m.toolName) && m.toolResult && !(m.toolResult as any).error) week = m.toolResult;
  }
  if (week) return { type: "week", result: week };
  if (today) return { type: "today", result: today };
  return undefined;
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

      // Build the key pool — the Settings key (if set) first, then the
      // hardcoded dev/family fallbacks (see config/devDefaults.ts) — so a
      // user-entered key is always preferred but there's still somewhere to
      // rotate to if it runs out of quota mid-session.
      const settingsKey = await db.getPreference("gemini_api_key");
      configureApiKeyPool([settingsKey, ...DEV_DEFAULT_GEMINI_API_KEYS]);
      // Restore which keys were already known exhausted from a previous
      // session (still within today's quota window) so this launch doesn't
      // waste a request re-discovering that, and save future discoveries.
      setKeyPoolPersistence(db);
      await loadPersistedExhaustion(db);
      if (hasAnyApiKey()) {
        providerRef.current = new GeminiProvider({ systemInstruction: PA_SYSTEM_PROMPT });
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
      const settingsKey = await store.getPreference("gemini_api_key");
      const offlineOnly = await store.getPreference("offline_only");
      configureApiKeyPool(offlineOnly === "true" ? [] : [settingsKey, ...DEV_DEFAULT_GEMINI_API_KEYS]);
      if (hasAnyApiKey()) {
        providerRef.current = new GeminiProvider({ systemInstruction: PA_SYSTEM_PROMPT });
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
            maxRounds: 6,
            externalTools: createAcademiaTools(store)
          });
          // Trigger refresh so screens pick up any state changes the tools made
          refresh();
          return { text: result.text, source: "gemini", richData: extractRichData(result.transcript) };
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
