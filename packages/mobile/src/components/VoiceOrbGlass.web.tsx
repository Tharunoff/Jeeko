import React from "react";
import Svg, { Defs, Path, RadialGradient, Stop } from "react-native-svg";
import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

type GlassBlobProps = { size: number; colors: [string, string] };

const BLOB_PATH = "M38,89 A48,42 0 1 1 62,89 L38,89 Z";

/** Shown only for the brief moment CanvasKit's WASM is still loading on web — a
 * flat placeholder so there's no empty hole while that resolves, never the
 * thing a user actually looks at. */
function BlobFallback({ size, colors }: { size: number; colors: [string, string] }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="fallbackFill" cx="32%" cy="22%" r="90%">
          <Stop offset="0%" stopColor={colors[0]} stopOpacity={1} />
          <Stop offset="100%" stopColor={colors[1]} stopOpacity={1} />
        </RadialGradient>
      </Defs>
      <Path d={BLOB_PATH} fill="url(#fallbackFill)" />
    </Svg>
  );
}

export function VoiceOrbGlass(props: GlassBlobProps) {
  return (
    <WithSkiaWeb<GlassBlobProps>
      getComponent={() => import("./GlassBlob").then((m) => ({ default: m.GlassBlob }))}
      componentProps={props}
      fallback={<BlobFallback {...props} />}
      // CanvasKit's default wasm lookup resolves relative to the bundle's own
      // path, which in this monorepo's web build is /packages/mobile/... — that
      // 404s (canvaskit.wasm actually sits at the served public/ root) and the
      // dev server's HTML fallback gets fed to WebAssembly.instantiate, which
      // fails loudly. Force the lookup to the real root-absolute path instead.
      opts={{ locateFile: (file: string) => `/${file}` }}
    />
  );
}
