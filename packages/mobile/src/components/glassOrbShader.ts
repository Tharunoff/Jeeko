/**
 * The actual glass/water material — a real fragment shader (SkSL, run per-pixel
 * by Skia on the GPU), not hand-painted gradient shapes. It reconstructs a
 * pseudo-3D sphere normal from the 2D silhouette, then does real lighting math:
 * Lambertian shading (light · normal) for the base sphere roundness, a Fresnel
 * term that brightens toward grazing angles (the "rim glow" real glass/water
 * always shows), a reflected "environment" (a simple procedural sky/ground
 * gradient — there's no real scene to refract in a 2D UI, so this fakes what a
 * shiny curved surface would pick up), and two explicitly placed catch-lights
 * (a real photographed liquid surface shows a genuine bright hotspot, which a
 * physically-derived specular term alone washes out at this render size — see
 * the comment below). This is what a real-time "wet" shader is actually made
 * of — light response computed from geometry, not shapes painted to look that
 * way.
 *
 * Coordinate note: `fragCoord` here is in the filled Path's own local
 * authoring space — the same fixed 0–100 box VoiceOrb.tsx's BLOB_PATH is
 * written in — not device pixels, confirmed empirically with a quadrant-color
 * probe (uv.x<0 = left, uv.y<0 = top, standard screen convention). That's why
 * `u_resolution` below is the constant 100, not the orb's pixel `size`.
 */
export const GLASS_ORB_SKSL = `
uniform float3 u_colorA;
uniform float3 u_colorB;

half4 main(float2 fragCoord) {
  float2 uv = (fragCoord / 100.0) * 2.0 - 1.0;
  // The blob silhouette (rx 48 / ry 42 around a center sitting slightly above
  // the box's vertical middle, since the flat "foot" eats into the bottom)
  // doesn't fill the -1..1 square evenly — recenter/rescale so this shader's
  // implied sphere lines up with the actual shape instead of assuming a plain
  // centered circle.
  uv.y = (uv.y - 0.06) / 0.84;
  uv.x = uv.x / 0.96;

  float r = length(uv);
  float z = sqrt(max(0.0, 1.0 - r * r));
  float3 normal = normalize(float3(uv, z));

  // Light source upper-left, matching every other pass this orb has had.
  float3 lightDir = normalize(float3(-0.55, -0.65, 0.6));
  float3 viewDir = float3(0.0, 0.0, 1.0);

  float ndotl = dot(normal, lightDir);
  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.4);

  // Fake environment reflection: a vertical gradient (dark "ground" to bright
  // "sky") sampled along the reflection vector, with visible banding so it
  // reads as light catching moving ripples rather than a flat gradient.
  float3 reflectDir = reflect(-viewDir, normal);
  float envY = reflectDir.y * 0.5 + 0.5;
  float bands = sin(envY * 22.0) * 0.5 + 0.5;
  float bands2 = sin(envY * 9.0 + uv.x * 6.0) * 0.5 + 0.5;
  float3 env = mix(u_colorB, u_colorA, envY);
  env += bands * 0.22 * (1.0 - envY);
  env += bands2 * 0.1;

  float3 base = mix(u_colorB, u_colorA, smoothstep(-0.3, 1.0, ndotl));
  float3 color = mix(base, env, 0.3 + fresnel * 0.4);
  color += fresnel * mix(u_colorA, float3(1.0), 0.4) * 1.0;

  // The physical spec term (normal·halfV) lands in the same region the base
  // shading is already bright, so at this canvas's actual pixel size it just
  // blends in instead of popping. Real catch-lights on liquid are a genuinely
  // separate, near-white hotspot — placing one explicitly (like the reference
  // photo's highlight) is what actually reads as wet rather than merely round.
  float2 glintPos = float2(-0.42, -0.4);
  float glintDist2 = dot(uv - glintPos, uv - glintPos);
  float glintCore = exp(-glintDist2 * 70.0);
  float glintHalo = exp(-glintDist2 * 14.0);
  color += float3(1.0) * glintHalo * 0.55;
  color += float3(1.0) * glintCore * 1.0;

  // A second, dimmer glint lower-right on the body — liquid rarely shows just
  // one catch-light; a small secondary one sells a curved, reflective surface.
  float2 glint2Pos = float2(0.15, 0.35);
  float glint2Dist2 = dot(uv - glint2Pos, uv - glint2Pos);
  color += float3(1.0) * exp(-glint2Dist2 * 90.0) * 0.5;

  return half4(color, 1.0);
}
`;

export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
