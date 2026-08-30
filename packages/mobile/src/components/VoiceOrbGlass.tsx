// Native: Skia is a real native module here, no async WASM load needed — just
// use the shader component directly. Web has its own VoiceOrbGlass.web.tsx that
// lazy-loads CanvasKit first (Metro picks that file automatically on web).
export { GlassBlob as VoiceOrbGlass } from "./GlassBlob";
