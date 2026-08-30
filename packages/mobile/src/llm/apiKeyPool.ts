/**
 * A small pool of Gemini API keys tried in order. Google's free-tier quota is
 * scoped per (key, model) — see the 429 body's `quotaDimensions` — so a key
 * that's run out of chat quota for today may still have TTS quota left, and
 * vice versa. That's why there are three independent rotators below sharing
 * the same underlying key list, rather than one rotator marking a whole key
 * dead the moment any one model on it gets rate-limited. (Chat, one-shot REST
 * TTS, and streaming Live TTS are three different models with three separate
 * quota buckets — Live in particular must stay independent of REST TTS so an
 * exhausted Live quota doesn't wrongly block the REST fallback, or vice versa.)
 *
 * Exhaustion is keyed by the literal key string (not array index, which isn't
 * stable if the Settings key changes) and persisted to the local database —
 * see setKeyPoolPersistence/loadPersistedExhaustion — so a key that ran out
 * today doesn't get retried (and fail again) the next time the app opens.
 * Google's free-tier quotas reset daily, so an exhaustion entry expires after
 * EXHAUSTION_TTL_MS and the key becomes eligible again automatically.
 */
const EXHAUSTION_TTL_MS = 24 * 60 * 60 * 1000;

class KeyRotator {
  private keys: string[] = [];
  private activeIndex = 0;
  private exhaustedAt = new Map<string, number>();
  private onChange?: () => void;

  setKeys(keys: string[]): void {
    this.keys = keys;
    this.activeIndex = 0;
    // Drop exhaustion entries for keys no longer in the pool — everything
    // else (restored or freshly discovered) is left alone.
    for (const k of [...this.exhaustedAt.keys()]) {
      if (!keys.includes(k)) this.exhaustedAt.delete(k);
    }
  }

  /** Reload previously-persisted exhaustion timestamps (see loadPersistedExhaustion
   * below) — entries older than the TTL are dropped rather than restored, so a
   * key whose daily quota has plausibly reset by now gets tried again. */
  restoreExhaustion(saved: Record<string, number>): void {
    const now = Date.now();
    for (const [key, at] of Object.entries(saved)) {
      if (now - at < EXHAUSTION_TTL_MS) this.exhaustedAt.set(key, at);
    }
  }

  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  private isExhausted(key: string): boolean {
    const at = this.exhaustedAt.get(key);
    if (at === undefined) return false;
    if (Date.now() - at >= EXHAUSTION_TTL_MS) {
      this.exhaustedAt.delete(key);
      return false;
    }
    return true;
  }

  hasAvailableKey(): boolean {
    return this.keys.some((k) => !this.isExhausted(k));
  }

  getActiveKey(): string | null {
    if (this.keys.length === 0) return null;
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.activeIndex + i) % this.keys.length;
      if (!this.isExhausted(this.keys[idx])) {
        this.activeIndex = idx;
        return this.keys[idx];
      }
    }
    return null;
  }

  /** Call after a 429/RESOURCE_EXHAUSTED response using this key. Returns the
   * next available key for this rotator (chat, REST TTS, or Live TTS), or
   * null if every key in the pool is out of quota for this model right now. */
  rotateAfterExhaustion(exhaustedKey: string): string | null {
    this.exhaustedAt.set(exhaustedKey, Date.now());
    this.onChange?.();
    const idx = this.keys.indexOf(exhaustedKey);
    this.activeIndex = (Math.max(idx, 0) + 1) % Math.max(this.keys.length, 1);
    return this.getActiveKey();
  }

  snapshotExhaustion(): Record<string, number> {
    return Object.fromEntries(this.exhaustedAt);
  }
}

export const chatKeyRotator = new KeyRotator();
export const ttsKeyRotator = new KeyRotator();
export const liveTtsKeyRotator = new KeyRotator();

/** Called once from AppState whenever the configured key set changes — same
 * list feeds all three rotators, they just track exhaustion independently. */
export function configureApiKeyPool(keys: (string | null | undefined)[]): void {
  const deduped = [...new Set(keys.filter((k): k is string => !!k && k.length > 10))];
  chatKeyRotator.setKeys(deduped);
  ttsKeyRotator.setKeys(deduped);
  liveTtsKeyRotator.setKeys(deduped);
}

export function hasAnyApiKey(): boolean {
  return chatKeyRotator.hasAvailableKey() || ttsKeyRotator.hasAvailableKey() || liveTtsKeyRotator.hasAvailableKey();
}

// --------------------------------------------------------------------------
// Persistence — a key's exhaustion needs to survive app restarts, otherwise
// every relaunch wastes a request re-discovering "yep, still out of quota."
// Deliberately depends only on the two methods actually needed (not the full
// DataStore type) so this module doesn't have to import @personalos/core.
// --------------------------------------------------------------------------
interface KeyPoolPersistence {
  getPreference(key: string): Promise<string | undefined>;
  setPreference(key: string, value: string): Promise<void>;
}

const PERSIST_PREF_KEY = "api_key_pool_exhaustion_v1";
let persistTarget: KeyPoolPersistence | null = null;

function persistNow(): void {
  if (!persistTarget) return;
  const snapshot = {
    chat: chatKeyRotator.snapshotExhaustion(),
    tts: ttsKeyRotator.snapshotExhaustion(),
    live: liveTtsKeyRotator.snapshotExhaustion()
  };
  persistTarget.setPreference(PERSIST_PREF_KEY, JSON.stringify(snapshot)).catch(() => {});
}

chatKeyRotator.setOnChange(persistNow);
ttsKeyRotator.setOnChange(persistNow);
liveTtsKeyRotator.setOnChange(persistNow);

/** Call once (e.g. right after configureApiKeyPool on app boot) so future
 * exhaustion discoveries get saved. */
export function setKeyPoolPersistence(store: KeyPoolPersistence | null): void {
  persistTarget = store;
}

/** Call once on app boot, after configureApiKeyPool, to restore whatever was
 * learned about exhausted keys in a previous session (still within the TTL). */
export async function loadPersistedExhaustion(store: KeyPoolPersistence): Promise<void> {
  const raw = await store.getPreference(PERSIST_PREF_KEY);
  if (!raw) return;
  try {
    const snapshot = JSON.parse(raw) as { chat?: Record<string, number>; tts?: Record<string, number>; live?: Record<string, number> };
    chatKeyRotator.restoreExhaustion(snapshot.chat ?? {});
    ttsKeyRotator.restoreExhaustion(snapshot.tts ?? {});
    liveTtsKeyRotator.restoreExhaustion(snapshot.live ?? {});
  } catch {
    // Corrupt or old-format entry — ignore and start fresh rather than crash.
  }
}
