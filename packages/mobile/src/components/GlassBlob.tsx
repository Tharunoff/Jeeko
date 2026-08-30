import React, { useMemo } from "react";
import { Canvas, Path, Shader, Skia } from "@shopify/react-native-skia";
import { GLASS_ORB_SKSL, hexToRgb01 } from "./glassOrbShader";

// Kept in exact sync with VoiceOrb.tsx's BLOB_PATH/eye paths — this is the real
// shape and face, just painted by a shader instead of flat SVG gradients.
const BLOB_PATH = "M38,89 A48,42 0 1 1 62,89 L38,89 Z";
const EYE_COLOR = "#052430";

/**
 * The real glass/water render: a Skia `<Canvas>` filling the blob's own
 * silhouette with a compiled fragment shader (see glassOrbShader.ts) instead of
 * a stack of gradients — actual per-pixel lighting math, not shapes painted to
 * approximate it. Same 100-unit coordinate space as the old SVG version, scaled
 * to `size` via a transform, so shape and eyes stay pixel-identical.
 */
export function GlassBlob({ size, colors }: { size: number; colors: [string, string] }) {
  // Compiled inside the component (not at module scope) deliberately: on
  // native this file is imported eagerly during app bootstrap (VoiceOrbGlass
  // → VoiceOrb → HomeScreen), well before React's first render — calling into
  // Skia's native bridge that early, before it's guaranteed to be ready, is a
  // real crash risk. useMemo defers the actual native call to first render,
  // by which point the bridge is definitely up; the try/catch means a failed
  // compile degrades to "no orb" instead of crashing the whole app.
  const effect = useMemo(() => {
    try {
      return Skia.RuntimeEffect.Make(GLASS_ORB_SKSL);
    } catch (err) {
      console.warn("Glass orb shader failed to compile:", err);
      return null;
    }
  }, []);

  const uniforms = useMemo(
    () => ({
      u_colorA: hexToRgb01(colors[0]),
      u_colorB: hexToRgb01(colors[1])
    }),
    [colors]
  );

  const scaleTransform = useMemo(() => [{ scale: size / 100 }], [size]);

  if (!effect) return null;

  return (
    <Canvas style={{ width: size, height: size }}>
      <Path path={BLOB_PATH} transform={scaleTransform}>
        <Shader source={effect} uniforms={uniforms} />
      </Path>
      <Path
        path="M32,46 L44,46"
        transform={scaleTransform}
        style="stroke"
        strokeWidth={3.4}
        strokeCap="round"
        color={EYE_COLOR}
      />
      <Path
        path="M56,46 L68,46"
        transform={scaleTransform}
        style="stroke"
        strokeWidth={3.4}
        strokeCap="round"
        color={EYE_COLOR}
      />
    </Canvas>
  );
}
