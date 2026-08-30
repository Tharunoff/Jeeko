/**
 * Dev/family fallback keys so Jeeko has a working Gemini connection without
 * going through Settings each install. Used alongside whatever key is saved
 * in the local SQLite `preferences` table (Settings key is always tried
 * first) — apiKeyPool.ts rotates through these when the active one runs out
 * of daily quota for a given model, instead of the app just going silent.
 *
 * These come from `EXPO_PUBLIC_GEMINI_API_KEY_1..5` env vars, not literals —
 * this file is committed to git and has no secrets in it. The actual values
 * live in two places:
 *   - EAS Build: registered as "sensitive"-visibility environment variables
 *     on the "preview" environment (`eas env:list preview` to see them,
 *     `eas env:set preview --name ... --value ... --visibility sensitive` to
 *     add/rotate one). EAS injects them at build time.
 *   - Local dev / web preview: packages/mobile/.env.local (gitignored, never
 *     committed) — same variable names, loaded automatically by Expo.
 * "sensitive" (not "secret") visibility is deliberate: EXPO_PUBLIC_-prefixed
 * vars always get inlined into the compiled JS bundle, so "secret" (server-
 * only) visibility doesn't apply — EAS itself refuses that combination.
 * These keys are exactly as extractable from the built APK as a literal
 * hardcoded string would be; what this setup actually buys is keeping them
 * out of the git repo and its history, not runtime secrecy.
 */
export const DEV_DEFAULT_GEMINI_API_KEYS: string[] = [
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_1,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_2,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_3,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_4,
  process.env.EXPO_PUBLIC_GEMINI_API_KEY_5
].filter((k): k is string => !!k && k.length > 10);
