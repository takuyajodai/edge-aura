/**
 * edge-aura — pure aura physics + rendering engine.  Framework-agnostic:
 * no React (or any other library) imports; the only platform dependencies
 * are `HTMLCanvasElement`, `document` (offscreen buffer creation in mkBuf),
 * and `window.innerWidth/Height`.
 *
 * Separation rationale: the physics/draw logic must be testable in isolation
 * (headless canvas, jsdom, or direct __auraEngine calls) without mounting a
 * component tree.  Host adapters (e.g. the React adapter in ./react) are
 * reduced to wiring.
 *
 * Neon rounded-ring model (organic screen-edge glow):
 *   The glow is a rounded-rectangle "neon tube" hugging the viewport edges:
 *   a bright core line plus a soft bloom.  The centerline path is a rounded
 *   rect inset `inset` px from the edges with corner radius `cornerRadius`
 *   (arc centers at (inset+cr, inset+cr) etc.).  Per pixel, t is the distance
 *   to that path (straights: depthFromEdge − inset; corner quadrants:
 *   |p − center| − cr) and alpha = clamp(Ac·G(t,σc) + Ab·G(t,σbloom), 0, 1)
 *   ·intensity — a narrow near-opaque core Gaussian whose thickness σc
 *   undulates smoothly along the ring, plus an ASYMMETRIC bloom: the outward
 *   side stays a tight Gaussian while the inward side is a long-tailed
 *   rational falloff that breathes on slow noise — the inner face dissolves
 *   with no perceptible end (windowed to 0 at `band`).  Amplitude and width
 *   also swell under the tap/burst springs and the per-press key bumps
 *   (a fixed pool of independent springs, each anchored at the bottom-edge
 *   x of its keypress — bumps rise and decay in place, never traveling).
 *   The palette LUT is sampled by arc position s along the path (continuous
 *   around corners: straight lengths + cr·θ for arcs) so the hue cycles
 *   seamlessly around the ring; the core is whitened slightly for neon feel.
 *
 *   Rendering tiles the ring into 8 buffers with NO overlap: 4 straight
 *   strips (top/bottom: (W−2·(inset+cr))×band, left/right: band×(H−2·(inset+cr)),
 *   offset inset+cr along their edge) and 4 CQ×CQ corner buffers.  Each
 *   corner buffer draws only the quarter-disc quadrant (both coordinates
 *   within inset+cr of the screen corner — exactly the region whose nearest
 *   path point lies on the arc); strips own everything else, splitting the
 *   interior along the corner diagonals so no pixel is written twice.
 *   Buffers composite onto the main canvas via drawImage (source-over).
 *   Per-column loops break out as soon as both Gaussians are negligible,
 *   keeping the per-frame cost around 2(W+H)·~30 pixel writes.
 *
 *   Code structure: the four strips and four corners are table-driven — a
 *   per-frame edge-config array (strips) and per-kind lookup tables (corners)
 *   feed shared neonAt / writeNeonPixel routines, so the per-pixel formula
 *   lives in exactly one place.
 *
 * Configuration: every tuning constant is exposed through `EdgeAuraOptions`
 * (all optional; defaults reproduce the original pixel-QA'd appearance
 * exactly).  Derived values (RIM, CQ, ARC) and the palette LUT are computed
 * per instance inside the factory.  The energy springs (burst, hot, and the
 * per-bump key springs) are intentionally NOT configurable — their
 * stiffness/damping pairs are internal tuning coupled to the decay rates.
 */

import {
  EDGE_AURA_PALETTES,
  type EdgeAuraPaletteName,
  type EdgeAuraPaletteStop,
  type EdgeAuraPaletteStops,
} from "./palettes";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type { EdgeAuraPaletteStop, EdgeAuraPaletteStops } from "./palettes";

export interface EdgeAuraGeometryOptions {
  /** Centerline inset from the viewport edges (px). Default 3. */
  inset?: number;
  /**
   * Fade the composited aura to transparent over the topmost N px (0 =
   * off, the default). Browsers that tint their window chrome by sampling
   * the page's top rows (Arc, Safari-style tab tinting) would otherwise
   * mirror the aura's animated colours into the chrome; the glow reaches
   * alpha ~0.9 at row 0 by design. The fade erases rows 0..40% fully and
   * ramps back to untouched by row N, so the visible glow just starts a
   * few px lower — imperceptible in-page, neutral to chrome samplers.
   */
  topEdgeFade?: number;
  /**
   * Radially fade the aura around the two TOP corners over radius N px
   * (0 = off, the default). Complements topEdgeFade: chrome samplers that
   * read the top-corner neighbourhoods (Arc's toolbar shows the left
   * corner's colour at its left end and the right corner's at its right
   * end) would otherwise still see the side glows below the top fade.
   * The OS window's rounded corners clip the very tip anyway, so the
   * in-page cost is minimal.
   */
  topCornerFade?: number;
  /**
   * Corner radius of the rounded-rect centerline (px).  Smaller → tighter
   * corners that hug the window edge more squarely. Default 11.
   */
  cornerRadius?: number;
  /**
   * Strip depth (px) — also the hard end of the inward dissolve.  The inner
   * tail is windowed smoothly to 0 exactly at this depth, so there is never
   * a visible cutoff line. Default 76.
   */
  band?: number;
  /**
   * Core line thickness: σ undulates along the ring within base ± var.
   * Defaults 1.6 / 0.6 → σ ∈ [1.0, 2.2]. Brief excursions to the ~1.0 thin
   * extreme are part of the tuned organic look; values pinned below ~1.3
   * for long stretches (e.g. a small base with var near 0) may show
   * 1px-grid aliasing shimmer.
   */
  coreSigmaBase?: number;
  coreSigmaVar?: number;
  /**
   * Inner-side dissolve: the inward bloom sigma is the outward sigma scaled
   * by (base + var·noise), clamped to innerSigmaMax.  The rational tail
   * fades far more gradually than a Gaussian, so the inner face has no
   * perceptible end. Defaults 1.25 / 0.45 / 17.
   */
  innerSoftBase?: number;
  innerSoftVar?: number;
  innerSigmaMax?: number;
}

export interface EdgeAuraPaletteOptions {
  /**
   * Gradient stops for the ring hue cycle (positions must start at 0 and end
   * at 1).  Default: `opal`'s organic mesh gradient stops.
   */
  stops?: EdgeAuraPaletteStops;
  /**
   * Pastel shift: mix every palette entry toward white at LUT build time —
   * tames raw vividness into a clean, modern tint (0 = original colors).
   * Default 0.35.
   */
  pastel?: number;
  /**
   * Neon touch: how strongly the core line is whitened toward 255. The
   * default is background-dependent — 0.2 on a "light" page, 0.35 on a "dark"
   * one (a hotter core reads better against black). An explicit value always
   * wins over both defaults.
   */
  coreWhiten?: number;
  /**
   * Overall ring translucency — caps the maximum alpha so the page always
   * shows through slightly (1 = fully opaque centerline). Default 0.9.
   */
  ringAlpha?: number;
  /**
   * Perceptual weight normalization: scale the effective ring alpha (and,
   * for very light palettes, reduce pastel) so every palette reads with the
   * same visual weight on a white page regardless of how dark/saturated its
   * stops are. Default true.
   */
  normalize?: boolean;
  /**
   * Target perceptual weight for normalization. Default NORMALIZE_REF
   * (the weight of the stock opal palette at pastel 0.35) on a "light"
   * background, NORMALIZE_REF_DARK on a "dark" one, so the default palette
   * renders identically with normalization on or off. An explicit value
   * always wins over the background-derived default.
   */
  normalizeTarget?: number;
  /**
   * Page background the perceptual normalization equalizes against.
   * "light" (the default) measures palette weight as distance from white
   * (mean of 1 − relativeLuminance); "dark" flips the metric to distance
   * from black (mean relativeLuminance) so palettes read with equal weight
   * on dark pages. Note that `pastel` always mixes stops toward WHITE,
   * which inherently reads stronger on dark backgrounds — that is a
   * stylistic choice left to the user (lower `pastel` for dark pages if
   * you want less of a whitened tint).
   */
  background?: "light" | "dark";
  /**
   * Stop-to-stop colour interpolation space for the LUT (build-time only,
   * zero per-frame cost). "srgb" (the default) lerps raw sRGB channels — fast
   * and byte-identical to previous versions. "oklab" lerps in Oklab (L/a/b),
   * which keeps mid-gradient colours perceptually even and avoids the muddy
   * grey midpoints sRGB produces between complementary stops.
   */
  interpolation?: "srgb" | "oklab";
  /**
   * DARK BACKGROUNDS ONLY (ignored when `background` is "light"). Alpha
   * response curve: the geometric coverage a ∈ [0,1] is remapped to
   * pow(a, darkAlphaGamma) before compositing. Values < 1 lift the faint
   * bloom tail so the glow reads with body on black instead of dissolving
   * into a thin thread; 1.0 disables the curve. Default 0.55, clamped to
   * (0, 1].
   */
  darkAlphaGamma?: number;
  /**
   * DARK BACKGROUNDS ONLY (ignored when `background` is "light"). Oklab
   * chroma multiplier applied to every LUT entry at build time (L preserved,
   * a/b scaled): compensates for colour reading less saturated against black.
   * 1.0 disables the lift. Default 1.25. Applied AFTER perceptual-weight
   * measurement, so it never perturbs normalization.
   */
  darkChroma?: number;
  /**
   * DARK BACKGROUNDS ONLY (hard-ignored when `background` is "light" —
   * "screen"/"plus-lighter" over a white page would erase the glow). When set
   * to a non-default value on a dark background the engine sets the canvas's
   * CSS `mix-blend-mode` so the glow adds onto the page's own colour. Default
   * "source-over" (normal compositing). destroy() restores the inline style.
   */
  blendMode?: "source-over" | "screen" | "plus-lighter";
}

export interface EdgeAuraMotionOptions {
  /**
   * Exponential decay rates (1/s) for tap and key energy: key energy fades
   * faster so the typing column dies quickly once typing stops.
   * Defaults 1.1 / 1.9.
   */
  decay?: number;
  keyDecay?: number;
  /**
   * Shared saturation cap that keeps rapid input bursts from blowing out the
   * bloom. Default 1.5.
   */
  energyCap?: number;
  /** Full palette rotation duration (s) while typing vs idle. Defaults 3 / 8. */
  rotateTypingS?: number;
  rotateIdleS?: number;
  /**
   * Kindle entrance duration (s): how long the reveal wavefront takes to sweep
   * from the click origin all the way around the ring to its far point. After
   * this the ring is fully revealed (env ≡ 1) and indistinguishable from the
   * steady aura. Default 0.85.
   */
  kindleDurS?: number;
  /**
   * Soft width (px) of the kindle reveal wavefront — the envelope ramps from
   * 0 to 1 over this arc-distance behind the front, so the ring kindles in
   * instead of snapping on. Default 90.
   */
  kindleSoftPx?: number;
  /**
   * Slow bounded hue oscillation (degrees, default 10; 0 = off). The palette
   * sample position drifts by ±(hueDriftDeg / 360) of the full ring as a
   * sine of period `hueDriftPeriodS`, so the whole ring breathes through a
   * narrow hue band — the LUT-space analogue of a gentle hue-rotate. Costs
   * one `sin` per frame (not per pixel).
   */
  hueDriftDeg?: number;
  /** Period (s) of the {@link EdgeAuraMotionOptions.hueDriftDeg} oscillation. Default 12. */
  hueDriftPeriodS?: number;
  /**
   * Travelling highlight sweep (default `undefined` = OFF, zero cost, zero
   * pixel change). A raised-cosine window of angular width `arcDeg` (of the
   * full 360° ring) sweeps the perimeter once every `periodS` seconds; within
   * the window the BLOOM amplitude (not the core) swells, scaled by
   * `min + (1 − min)·window`, so a soft crest of light glides around the ring
   * over the static colours. Costs one `cos` per column only while enabled.
   *   - `arcDeg`  angular width of the crest (default 80)
   *   - `periodS` seconds per full lap (default 6)
   *   - `min`     bloom scale outside the crest, 0..1 (default 0.35)
   */
  highlight?: { arcDeg?: number; periodS?: number; min?: number };
}

export interface EdgeAuraInputOptions {
  /**
   * Hotspot Gaussian sigmas (px along the edge): the key bump is tighter
   * than the tap bump so keystrokes read as a localized column.
   * Defaults 90 / 110.
   */
  keySigma?: number;
  tapSigma?: number;
  /** Energy injected per tap / keystroke / save pulse. Defaults 0.8 / 0.9 / 0.45. */
  tapEnergy?: number;
  keyEnergy?: number;
  savedPulseEnergy?: number;
  /**
   * Key x-fraction → bottom-edge position mapping: squeeze into the middle
   * span so the key column never sits inside a corner arc.
   * Defaults 0.08 / 0.84.
   */
  keyXMin?: number;
  keyXSpan?: number;
}

export interface EdgeAuraOptions {
  geometry?: EdgeAuraGeometryOptions;
  palette?: EdgeAuraPaletteOptions;
  motion?: EdgeAuraMotionOptions;
  input?: EdgeAuraInputOptions;
  /**
   * Deterministic seed for the five per-instance noise phases: when set to a
   * finite number, the phases derive from a tiny mulberry32 PRNG instead of
   * Math.random() — for reproducible rendering in tests/QA. The phase range
   * is identical either way. Default: unset (random phases per instance).
   */
  seed?: number;
}

/**
 * Reference perceptual weight for palette normalization: the LUT weight
 * (mean of 1 − relativeLuminance over the 256 entries, post-pastel) of the
 * stock `opal` palette at the default pastel 0.35, computed by running
 * buildPaletteLut + lutPerceptualWeight offline (node, full double
 * precision).  Hardcoded so the default palette's normalization scale is
 * exactly 1.0 — opal renders pixel-identically with normalization on.
 */
export const NORMALIZE_REF = 0.2713835171568625;

/**
 * Dark-background counterpart of NORMALIZE_REF: the DARK perceptual weight
 * (mean relativeLuminance over the 256 entries — distance from black) of the
 * stock `opal` palette at the default pastel 0.35, computed offline the same
 * way NORMALIZE_REF was (node script replicating buildPaletteLut +
 * lutPerceptualWeight, full double precision).  Used as the default
 * normalizeTarget when `palette.background` is "dark", so the default
 * palette's normalization scale is exactly 1.0 there too.
 *
 * Measured on the POST-pastel, PRE-`darkChroma`-lift LUT (default `srgb`
 * interpolation): normalization runs before the Oklab chroma lift, so
 * darkChroma never shifts the weight and this reference stays exact for the
 * stock opal palette regardless of the darkChroma value.
 */
export const NORMALIZE_REF_DARK = 0.7286164828431372;

// ---------------------------------------------------------------------------
// Defaults — the exact original, pixel-QA'd values.
// ---------------------------------------------------------------------------

export const EDGE_AURA_DEFAULTS = {
  geometry: {
    inset: 3,
    cornerRadius: 11,
    topEdgeFade: 0,
    topCornerFade: 0,
    band: 76,
    coreSigmaBase: 1.6,
    coreSigmaVar: 0.6,
    innerSoftBase: 1.25,
    innerSoftVar: 0.45,
    innerSigmaMax: 17,
  },
  palette: {
    stops: EDGE_AURA_PALETTES.opal,
    pastel: 0.35,
    coreWhiten: 0.2,
    ringAlpha: 0.90,
    normalize: true,
    normalizeTarget: NORMALIZE_REF,
    background: "light",
    interpolation: "srgb",
    darkAlphaGamma: 0.55,
    darkChroma: 1.25,
    blendMode: "source-over",
  },
  motion: {
    decay: 1.1,
    keyDecay: 1.9,
    energyCap: 1.5,
    rotateTypingS: 3,
    rotateIdleS: 8,
    kindleDurS: 0.85,
    kindleSoftPx: 90,
    hueDriftDeg: 10,
    hueDriftPeriodS: 12,
  },
  input: {
    keySigma: 90,
    tapSigma: 110,
    tapEnergy: 0.8,
    keyEnergy: 0.9,
    savedPulseEnergy: 0.45,
    keyXMin: 0.08,
    keyXSpan: 0.84,
  },
} as const;

/** Identity helper for authoring typed option objects. */
export function defineEdgeAuraOptions(options: EdgeAuraOptions): EdgeAuraOptions {
  return options;
}

// ---------------------------------------------------------------------------
// Oklab colour helpers (Björn Ottosson's matrices). Build-time only — no
// per-frame cost. Used by "oklab" stop interpolation (C3) and the dark-mode
// chroma lift (C2b). sRGB channels are 0..255.
// ---------------------------------------------------------------------------
function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

// Returns a 0..255 sRGB channel (float, NOT rounded); clamps linear to [0,1]
// first so out-of-gamut Oklab results never feed Math.pow a negative base.
function linearToSrgb255(c: number): number {
  const cc = c <= 0 ? 0 : c >= 1 ? 1 : c;
  const cs = cc <= 0.0031308 ? 12.92 * cc : 1.055 * Math.pow(cc, 1 / 2.4) - 0.055;
  return cs * 255;
}

interface Oklab { L: number; a: number; b: number }

function rgbToOklab(r: number, g: number, b: number): Oklab {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

// Oklab → sRGB, returning 0..255 floats clamped to gamut (NOT rounded).
function oklabToSrgb255(L: number, a: number, b: number): { r: number; g: number; b: number } {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lr =  4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  return { r: linearToSrgb255(lr), g: linearToSrgb255(lg), b: linearToSrgb255(lb) };
}

// ---------------------------------------------------------------------------
// Palette LUT — 256-entry RGB array built per instance from the stops.
// ---------------------------------------------------------------------------
const LUT_SIZE = 256;

// `interpolation` selects the stop-to-stop lerp space. "srgb" is the original
// raw-channel lerp (byte-identical to prior versions); "oklab" lerps L/a/b of
// the two endpoint colours for perceptually even gradients. The pastel mix
// toward white is applied identically in both spaces, after the lerp.
function buildPaletteLut(
  stops: EdgeAuraPaletteStop[],
  pastel: number,
  interpolation: "srgb" | "oklab" = "srgb",
): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * 3);
  const oklab = interpolation === "oklab";
  for (let i = 0; i < LUT_SIZE; i++) {
    const p = i / (LUT_SIZE - 1);
    let si = 0;
    for (let s = 0; s < stops.length - 2; s++) {
      if (p >= stops[s][0] && p < stops[s + 1][0]) { si = s; break; }
      if (s === stops.length - 3) si = stops.length - 2;
    }
    const [t0, from] = stops[si];
    const [t1, to]   = stops[si + 1];
    const f = t1 > t0 ? (p - t0) / (t1 - t0) : 0;
    let rr: number, gg: number, bb: number;
    if (oklab) {
      const c0 = rgbToOklab(from[0], from[1], from[2]);
      const c1 = rgbToOklab(to[0], to[1], to[2]);
      const rgb = oklabToSrgb255(
        c0.L + f * (c1.L - c0.L),
        c0.a + f * (c1.a - c0.a),
        c0.b + f * (c1.b - c0.b),
      );
      rr = rgb.r; gg = rgb.g; bb = rgb.b;
    } else {
      rr = from[0] + f * (to[0] - from[0]);
      gg = from[1] + f * (to[1] - from[1]);
      bb = from[2] + f * (to[2] - from[2]);
    }
    lut[i * 3]     = Math.round(rr + (255 - rr) * pastel);
    lut[i * 3 + 1] = Math.round(gg + (255 - gg) * pastel);
    lut[i * 3 + 2] = Math.round(bb + (255 - bb) * pastel);
  }
  return lut;
}

// Dark-mode Oklab chroma lift (C2b): copy the LUT scaling every entry's a/b by
// `chroma` while preserving L. Applied only on dark backgrounds and AFTER the
// perceptual-weight measurement, so it never shifts normalization.
function liftLutChroma(lut: Uint8Array, chroma: number): Uint8Array {
  const out = new Uint8Array(lut.length);
  for (let i = 0; i < LUT_SIZE; i++) {
    const c = rgbToOklab(lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]);
    const rgb = oklabToSrgb255(c.L, c.a * chroma, c.b * chroma);
    out[i * 3]     = Math.round(rgb.r);
    out[i * 3 + 1] = Math.round(rgb.g);
    out[i * 3 + 2] = Math.round(rgb.b);
  }
  return out;
}

/**
 * Perceptual weight of a built LUT, with relativeLuminance = (0.2126·r +
 * 0.7152·g + 0.0722·b)/255.  On a "light" background the weight is the mean
 * of (1 − relativeLuminance) — distance from white; on a "dark" one the
 * metric flips to mean relativeLuminance — distance from black.
 * Deliberately NOT gamma-decoded — sRGB-space luma is cheap and monotonic
 * in distance-from-the-background, which is all normalization needs.
 */
function lutPerceptualWeight(lut: Uint8Array, dark: boolean): number {
  let sum = 0;
  for (let i = 0; i < LUT_SIZE; i++) {
    const lum = (0.2126 * lut[i * 3] + 0.7152 * lut[i * 3 + 1] + 0.0722 * lut[i * 3 + 2]) / 255;
    sum += dark ? lum : 1 - lum;
  }
  return sum / LUT_SIZE;
}

/**
 * Structural palette validation. A malformed stop array corrupts the LUT
 * silently (NaN colors, wrapped seams), so structural garbage fails loudly
 * at creation time — unlike numeric scalar options, which are merely clamped
 * to safe minimums (a decorative overlay should degrade, not crash, on
 * out-of-range numbers).
 */
function validatePaletteStops(stops: unknown): asserts stops is EdgeAuraPaletteStops {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error("edge-aura: palette stops must be an array of at least 2 entries");
  }
  let prevPos = -Infinity;
  for (let i = 0; i < stops.length; i++) {
    const stop: unknown = stops[i];
    if (!Array.isArray(stop) || stop.length !== 2) {
      throw new Error(`edge-aura: palette stop ${i} must be a [position, [r, g, b]] pair`);
    }
    const pos: unknown = stop[0];
    const color: unknown = stop[1];
    if (typeof pos !== "number" || !Number.isFinite(pos)) {
      throw new Error(`edge-aura: palette stop ${i} position must be a finite number`);
    }
    if (pos < prevPos) {
      throw new Error(`edge-aura: palette stop positions must be non-decreasing (stop ${i})`);
    }
    prevPos = pos;
    if (
      !Array.isArray(color) ||
      color.length !== 3 ||
      !color.every((c) => typeof c === "number" && Number.isFinite(c))
    ) {
      throw new Error(`edge-aura: palette stop ${i} color must be a 3-tuple of finite numbers`);
    }
  }
  if ((stops[0] as [number, unknown])[0] !== 0) {
    throw new Error("edge-aura: first palette stop position must be exactly 0");
  }
  if ((stops[stops.length - 1] as [number, unknown])[0] !== 1) {
    throw new Error("edge-aura: last palette stop position must be exactly 1");
  }
}

/**
 * Tiny deterministic PRNG (mulberry32) backing the `seed` option — 32-bit
 * state, zero dependencies, more than enough quality for five noise phases.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HALF_PI = Math.PI / 2;

// Below this alpha a pixel write is invisible; also the spring threshold
// under which hotspot Gaussians are skipped entirely.
const ALPHA_EPS  = 1 / 255;
const SPRING_EPS = 0.001;

// Anti-aliased width (px) of the outward corner feather: past INSET px on the
// outward side of the centerline the alpha fades to 0 over this distance, so
// corner tiles round off tangent to the screen edges instead of pooling flat
// colour out to the square viewport corner. On straights the outward reach
// never exceeds INSET, so the feather is inert there (see writeNeonPixel).
const CORNER_FEATHER_PX = 1.5;

// Depth (px) over which a near-corner strip column crossfades — WITH DEPTH,
// not across columns — from its own live profile to the shared corner-midpoint
// profile. The window completes (weight 1) exactly at the diagonal-cut depth,
// where the two owning strips meet and must agree; shallower pixels keep the
// column's own live noise, so the bright core/bloom never freezes into a flat
// band. See the corner-continuity block in createAuraEngine.
const CORNER_DEPTH_FADE_PX = 16;

// Column span, adjacent to a corner TILE, over which the depth-crossfade is
// additionally lifted at SHALLOW depths so the strip meets the tile (which
// renders wholly on the midpoint profile) without a boundary step — most
// visible at the TL noise-wrap seam. Only the first few columns are touched;
// a ~10-column shallow lift is imperceptible. Columns past it keep live noise
// at shallow depth (only the deep diagonal-cut region freezes).
const CORNER_TILE_ADJ_COLS = 10;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------
interface Spring1D { x: number; v: number; k: number; c: number }
interface Spring2D { x: number; y: number; vx: number; vy: number; k: number; c: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mkSpring(k: number, c: number): Spring1D {
  return { x: 0, v: 0, k, c };
}

function stepSpring(s: Spring1D, target: number, dt: number): number {
  s.v += (s.k * (target - s.x) - s.c * s.v) * dt;
  s.x += s.v * dt;
  return s.x;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// Hermite smoothstep on a value already normalized to [0,1].
function smoothstep01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

function easeOutCubic(x: number): number {
  const u = 1 - x;
  return 1 - u * u * u;
}

function noise(t: number, p: number): number {
  return (
    0.5 +
    0.27 * Math.sin(0.9  * t + p) +
    0.18 * Math.sin(2.33 * t + p * 1.71) +
    0.05 * Math.sin(5.11 * t + p * 0.39)
  );
}

function projectToEdge(x: number, y: number, W: number, H: number): { x: number; y: number } {
  const dl = x, dr = W - x, dt = y, db = H - y;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) return { x: 0, y };
  if (m === dr) return { x: W, y };
  if (m === dt) return { x, y: 0 };
  return { x, y: H };
}

// Edge ids in clockwise perimeter order. Used to gate the hotspot bumps to a
// single edge (the Gaussians use tangential distance, which is only
// meaningful on the hotspot's own edge).
const TOP = 0, RIGHT = 1, BOTTOM = 2, LEFT = 3;

// ---------------------------------------------------------------------------
// Corner lookup tables, indexed by kind (0 TL, 1 TR, 2 BR, 3 BL).
// ---------------------------------------------------------------------------

// f = clamp((atan2 + offset) / (π/2), 0, 1) is the clockwise fraction along
// the quarter arc; only the atan2 offset differs per corner.
const CORNER_TH_OFFSET = [Math.PI, HALF_PI, 0, -HALF_PI];

// Hotspot gating is inherited from the nearer of the two adjacent straight
// edges, in clockwise [first-half, second-half] order (split at f = 0.5).
const CORNER_EDGES: ReadonlyArray<readonly [number, number]> = [
  [LEFT,   TOP],
  [TOP,    RIGHT],
  [RIGHT,  BOTTOM],
  [BOTTOM, LEFT],
];

// Which direction the drawn quadrant extends from the arc center.
const CORNER_X_NEG = [true, false, false, true];
const CORNER_Y_NEG = [true, true, false, false];

// arcS0 (per-frame arc offsets) is indexed TR, BR, BL, TL in clockwise order;
// this maps corner kind → arcS0 index.
const CORNER_ARC_INDEX = [3, 0, 1, 2];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface AuraEngine {
  /** Advance physics by dtMs milliseconds (rAF-independent). */
  step(dtMs: number): void;
  /** Draw one frame to the canvas using the current physics state. */
  render(): void;
  /** Draw a single low-intensity static frame (for reduced-motion). */
  renderStatic(): void;
  /** Inject tap energy and optionally update the hotspot target. */
  tap(point: { x: number; y: number } | null): void;
  /**
   * Inject keystroke energy as an independent bottom-edge bump. `x` is a
   * 0..1 fraction mapped across the bottom edge (via keyXMin/keyXSpan); the
   * bump is fixed at that position — it rises and decays in place, never
   * traveling.
   */
  key(x: number): void;
  /**
   * Inject a gentle ambient energy pulse (e.g. "a save just succeeded"),
   * capped at energyCap. Defaults to `input.savedPulseEnergy` when no
   * amount is given.
   */
  pulse(energy?: number): void;
  /** @deprecated Use {@link AuraEngine.pulse}. Alias kept for 0.1.x hosts. */
  savedPulse(): void;
  /**
   * Begin the entrance "kindle": the steady ring is revealed by a wavefront
   * expanding in both directions from the arc position nearest (x, y), settling
   * into the exact steady state with zero residual energy. Purely a reveal
   * envelope — injects NO energy. While kindling, per-position alpha is scaled
   * by the wavefront envelope; once complete, every frame is byte-identical to
   * the steady aura. Call once when the effect is activated.
   */
  kindle(x: number, y: number): void;
  /** Switch rotation speed between typing (fast) and idle (slow). */
  setTyping(on: boolean): void;
  /**
   * Swap the ring's palette at runtime. Accepts a preset name (resolved via
   * EDGE_AURA_PALETTES) or a raw stop array (validated like the creation-time
   * option — structural garbage throws). The LUT is rebuilt through the SAME
   * perceptual-normalization pipeline as creation, honoring this instance's
   * normalize / normalizeTarget / pastel / ringAlpha / background settings.
   * With `crossfadeMs` unset or 0 the swap is instant; with a positive value
   * the rendered LUT (and effective ring alpha) blends linearly from the old
   * palette to the new one over that duration, advanced by step() — after the
   * fade every frame is exactly the new palette's steady output.
   * getNormalization() reflects the new (target) palette as soon as the fade
   * starts.
   */
  setPalette(
    palette: EdgeAuraPaletteName | EdgeAuraPaletteStops,
    opts?: { crossfadeMs?: number },
  ): void;
  /**
   * Diagnostic: resolved perceptual-normalization values — the final LUT
   * weight, effective ring alpha, and effective pastel actually used for
   * rendering (equal to the configured ringAlpha/pastel when `normalize`
   * is off).  For QA/dev inspection only; not part of the render contract.
   */
  getNormalization(): { weight: number; effRingAlpha: number; effPastel: number };
  /**
   * Live-tune the effect: deep-merge `partial` section-wise (geometry /
   * palette / motion / input) onto the instance's CURRENT resolved options
   * and re-derive everything affected — the demo sliders build on this.
   *   - geometry changes reallocate the tile buffers and clear the canvas;
   *   - palette / background / interpolation / darkChroma / darkAlphaGamma /
   *     blendMode changes rebuild the LUT, normalization and mix-blend-mode
   *     INSTANTLY (no crossfade — {@link AuraEngine.setPalette} remains the
   *     crossfading path for stops);
   *   - motion / input scalars update in place, honoring the same clamps as
   *     creation.
   * Validation matches creation (structural garbage throws; scalars clamp).
   * `seed` is IGNORED after creation (the noise phases are fixed). An
   * in-flight kindle stays active (its perimeter re-derives); an in-flight
   * palette crossfade is committed to its target first. No-op after destroy().
   */
  updateOptions(partial: EdgeAuraOptions): void;
  /** Re-read viewport dimensions and rebuild strip buffers. */
  resize(): void;
  /** Clear the canvas. (The engine holds no event listeners or timers.) */
  destroy(): void;
}

export function createAuraEngine(
  canvas: HTMLCanvasElement,
  options?: EdgeAuraOptions,
): AuraEngine {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("edge-aura: could not get 2d context");

  // -- Resolve options against defaults (per-instance, MUTABLE: updateOptions
  //    deep-merges partials into these section objects and re-derives) --
  let geo = { ...EDGE_AURA_DEFAULTS.geometry, ...options?.geometry };
  let pal = { ...EDGE_AURA_DEFAULTS.palette,  ...options?.palette };
  let mot = { ...EDGE_AURA_DEFAULTS.motion,   ...options?.motion };
  let inp = { ...EDGE_AURA_DEFAULTS.input,    ...options?.input };

  // Whether the caller pinned the two background-dependent palette scalars
  // explicitly — their value must keep winning over the background-derived
  // default across every updateOptions() call, not just at creation.
  let userSetNormalizeTarget = options?.palette?.normalizeTarget !== undefined;
  let userSetCoreWhiten = options?.palette?.coreWhiten !== undefined;

  // Structurally invalid palettes fail loudly; numeric scalars below are
  // instead CLAMPED to safe minimums — this is a decorative library, so
  // garbage numbers degrade gracefully rather than crash the host.
  validatePaletteStops(pal.stops);

  // Non-finite scalars (NaN/Infinity) would slip through a bare Math.max
  // (Math.max(min, NaN) === NaN) and either crash buffer allocation or
  // silently poison the energy math forever — fall back to the default
  // instead, consistent with the graceful-degradation contract above.
  const clampOpt = (v: number, min: number, fallback: number): number =>
    Number.isFinite(v) ? Math.max(min, v) : fallback;

  const DEF_GEO = EDGE_AURA_DEFAULTS.geometry;
  const DEF_MOT = EDGE_AURA_DEFAULTS.motion;
  const DEF_INP = EDGE_AURA_DEFAULTS.input;

  // ---------------------------------------------------------------------------
  // Resolved config (mutable). Every option-derived scalar below is a plain
  // `let` reassigned by one of the deriveGeometry/deriveInput/deriveMotion/
  // derivePalette functions. Those functions are the SINGLE derivation path —
  // called once at creation and again (per affected section) by updateOptions,
  // so no derivation logic is duplicated. Every hot-loop closure (neonAt,
  // writeNeonPixel, drawStrip, drawCorner, step) reads these lets by reference,
  // so a re-derive is immediately visible to the next frame.
  // ---------------------------------------------------------------------------

  // Geometry: centerline rounded rect inset INSET px from the viewport edges
  // with corner radius CR.  RIM = INSET + CR is the distance from a screen
  // edge to a corner-arc center (and the strip/corner tiling offset).  CQ is
  // the RIM×RIM corner-buffer size; ARC the quarter-arc length.
  let INSET = 0, CR = 0, RIM = 0, BAND = 0, TOP_FADE = 0, TOP_CORNER_FADE = 0;
  let CQ = 0, ARC = 0;
  let CORE_SIGMA_BASE = 0, CORE_SIGMA_VAR = 0;
  let INNER_SOFT_BASE = 0, INNER_SOFT_VAR = 0, INNER_SIGMA_MAX = 0;

  const deriveGeometry = () => {
    INSET = clampOpt(geo.inset, 0, DEF_GEO.inset);
    CR = clampOpt(geo.cornerRadius, 0, DEF_GEO.cornerRadius);
    RIM = INSET + CR;
    BAND = clampOpt(geo.band, 8, DEF_GEO.band);
    TOP_FADE = geo.topEdgeFade ?? 0;
    TOP_CORNER_FADE = geo.topCornerFade ?? 0;
    CQ = RIM;
    ARC = HALF_PI * CR;
    CORE_SIGMA_BASE = geo.coreSigmaBase;
    CORE_SIGMA_VAR = geo.coreSigmaVar;
    INNER_SOFT_BASE = geo.innerSoftBase;
    INNER_SOFT_VAR = geo.innerSoftVar;
    INNER_SIGMA_MAX = clampOpt(geo.innerSigmaMax, 1, DEF_GEO.innerSigmaMax);
  };

  let KEY_SIGMA = 0, TAP_SIGMA = 0;
  let TAP_ENERGY = 0, KEY_ENERGY = 0, SAVED_PULSE_ENERGY = 0;
  let KEY_X_MIN = 0, KEY_X_SPAN = 0;

  const deriveInput = () => {
    KEY_SIGMA = clampOpt(inp.keySigma, 1, DEF_INP.keySigma);
    TAP_SIGMA = clampOpt(inp.tapSigma, 1, DEF_INP.tapSigma);
    TAP_ENERGY = inp.tapEnergy;
    KEY_ENERGY = inp.keyEnergy;
    SAVED_PULSE_ENERGY = inp.savedPulseEnergy;
    KEY_X_MIN = inp.keyXMin;
    KEY_X_SPAN = inp.keyXSpan;
  };

  let ENERGY_CAP = 0, DECAY = 0, KEY_DECAY = 0;
  let ROTATE_TYPING_S = 0, ROTATE_IDLE_S = 0, KINDLE_DUR = 0, KINDLE_SOFT = 0;
  // Organic-motion params (C4). HUE_DRIFT_DEG 0 disables the drift (byte-for-
  // byte no-op). HIGHLIGHT_ON false disables the sweep (zero cost, zero change).
  let HUE_DRIFT_DEG = 0, HUE_DRIFT_PERIOD = 0;
  let HIGHLIGHT_ON = false, HIGHLIGHT_ARC_FRAC = 0, HIGHLIGHT_PERIOD = 0, HIGHLIGHT_MIN = 0;

  const deriveMotion = () => {
    // energyCap must stay strictly positive (it caps every energy injection).
    ENERGY_CAP = clampOpt(mot.energyCap, 1e-3, DEF_MOT.energyCap);
    // Decay rates have no minimum, but a NaN here would make every energy
    // store NaN forever (NaN never decays) — finite-guard to the defaults.
    DECAY = Number.isFinite(mot.decay) ? mot.decay : DEF_MOT.decay;
    KEY_DECAY = Number.isFinite(mot.keyDecay) ? mot.keyDecay : DEF_MOT.keyDecay;
    ROTATE_TYPING_S = clampOpt(mot.rotateTypingS, 0.05, DEF_MOT.rotateTypingS);
    ROTATE_IDLE_S = clampOpt(mot.rotateIdleS, 0.05, DEF_MOT.rotateIdleS);
    KINDLE_DUR = clampOpt(mot.kindleDurS, 0.05, DEF_MOT.kindleDurS);
    // Divisor in the kindle envelope — clamp like the other pixel-scale sigmas.
    KINDLE_SOFT = clampOpt(mot.kindleSoftPx, 1, DEF_MOT.kindleSoftPx);
    // Hue drift (C4a): finite-guard the degrees (0 = off), clamp the period to
    // a sane floor so a 0/negative period can't divide the per-frame sine.
    HUE_DRIFT_DEG = Number.isFinite(mot.hueDriftDeg) ? mot.hueDriftDeg : DEF_MOT.hueDriftDeg;
    HUE_DRIFT_PERIOD = clampOpt(mot.hueDriftPeriodS, 0.05, DEF_MOT.hueDriftPeriodS);
    // Highlight sweep (C4b): a structured object turns it on; anything else is
    // OFF. arcDeg / periodS clamp to positive floors; min clamps to [0,1].
    const hl = mot.highlight;
    HIGHLIGHT_ON = !!hl && typeof hl === "object";
    if (hl && typeof hl === "object") {
      HIGHLIGHT_ARC_FRAC = clampOpt(hl.arcDeg ?? NaN, 1, 80) / 360;
      HIGHLIGHT_PERIOD = clampOpt(hl.periodS ?? NaN, 0.05, 6);
      HIGHLIGHT_MIN = Number.isFinite(hl.min) ? clamp(hl.min as number, 0, 1) : 0.35;
    }
  };

  // -- Perceptual weight normalization --
  // "dark" backgrounds flip the weight metric (distance from black instead
  // of distance from white) and, unless the caller pinned normalizeTarget
  // explicitly, retarget to the reference weight measured with that same dark
  // metric — so the default palette's scale stays exactly 1.0 on either
  // background.  All of these are re-derivable so updateOptions can flip
  // background / interpolation / darkChroma / blendMode at runtime.
  let DARK_BG = false;
  let NORM_TARGET: number = NORMALIZE_REF;
  let CORE_WHITEN: number = EDGE_AURA_DEFAULTS.palette.coreWhiten;
  let INTERPOLATION: "srgb" | "oklab" = "srgb";
  let DARK_ALPHA_GAMMA: number = EDGE_AURA_DEFAULTS.palette.darkAlphaGamma;
  let DARK_CHROMA: number = EDGE_AURA_DEFAULTS.palette.darkChroma;
  let BLEND_MODE: "source-over" | "screen" | "plus-lighter" = "source-over";

  // Dark-mode alpha response LUT: darkAlphaLut[i] = pow(i/255, gamma), indexed
  // by the geometric coverage byte. Refilled by derivePalette (gamma may change
  // on update); read only on dark backgrounds — the light hot path never
  // touches it, and gamma 1 makes it the identity.
  const darkAlphaLut = new Float32Array(256);

  const derivePalette = () => {
    DARK_BG = pal.background === "dark";
    NORM_TARGET = userSetNormalizeTarget
      ? pal.normalizeTarget
      : DARK_BG
        ? NORMALIZE_REF_DARK
        : NORMALIZE_REF;
    // Core whiten: background-dependent default (0.35 on dark, 0.2 on light);
    // an explicit user value wins over both.
    CORE_WHITEN = userSetCoreWhiten
      ? pal.coreWhiten
      : DARK_BG
        ? 0.35
        : EDGE_AURA_DEFAULTS.palette.coreWhiten;
    // Stop interpolation space (build-time only). Anything but "oklab" is the
    // byte-identical "srgb" lerp.
    INTERPOLATION = pal.interpolation === "oklab" ? "oklab" : "srgb";
    // Dark-mode alpha response gamma, clamped to (0, 1]. Non-finite → default.
    DARK_ALPHA_GAMMA = Number.isFinite(pal.darkAlphaGamma)
      ? Math.min(1, Math.max(1e-6, pal.darkAlphaGamma))
      : EDGE_AURA_DEFAULTS.palette.darkAlphaGamma;
    // Dark-mode Oklab chroma lift multiplier (>= 0). Non-finite → default.
    DARK_CHROMA = Number.isFinite(pal.darkChroma)
      ? Math.max(0, pal.darkChroma)
      : EDGE_AURA_DEFAULTS.palette.darkChroma;
    // Optional CSS mix-blend-mode (dark backgrounds only; applied separately).
    BLEND_MODE =
      pal.blendMode === "screen" || pal.blendMode === "plus-lighter"
        ? pal.blendMode
        : "source-over";
    for (let i = 0; i < 256; i++) darkAlphaLut[i] = Math.pow(i / 255, DARK_ALPHA_GAMMA);
  };

  deriveGeometry();
  deriveInput();
  deriveMotion();
  derivePalette();

  // Build the LUT + effective alpha/pastel for a stop array through the
  // shared normalization pipeline — used at creation AND by setPalette, so a
  // runtime palette swap lands on exactly the state a fresh instance with
  // those stops would get.  Heavy (dark/saturated) palettes get their alpha
  // scaled DOWN toward the target weight; light (near-background) palettes
  // get alpha scaled UP, and if the 1.0 alpha cap still isn't enough, pastel
  // is reduced stepwise (LUT rebuilt — 256 entries, negligible) to darken
  // the colors themselves.  Palettes whose raw stops sit near the target
  // may not reach it even at pastel 0 / alpha 1 — best effort is accepted.
  //
  // The pastel step-down is a LIGHT-metric lever only: lowering pastel
  // darkens colors, which raises distance-from-white weight and shrinks
  // alphaScale toward convergence.  Under the "dark" metric the relation
  // inverts (lowering pastel LOWERS luminance weight and GROWS alphaScale —
  // the loop would diverge, crushing the user's pastel to 0 for nothing), so
  // on dark backgrounds the pastel is left untouched and the alpha clamp
  // alone is the best effort.
  const resolvePalette = (stops: EdgeAuraPaletteStops) => {
    let effPastel = pal.pastel;
    let lut = buildPaletteLut(stops, effPastel, INTERPOLATION);
    let weight = lutPerceptualWeight(lut, DARK_BG);
    let effRingAlpha = pal.ringAlpha;
    if (pal.normalize) {
      let alphaScale = NORM_TARGET / weight;
      if (!DARK_BG) {
        for (let i = 0; i < 8 && pal.ringAlpha * alphaScale > 1.0 && effPastel > 0; i++) {
          effPastel = Math.max(0, effPastel - 0.07);
          lut = buildPaletteLut(stops, effPastel, INTERPOLATION);
          weight = lutPerceptualWeight(lut, DARK_BG);
          alphaScale = NORM_TARGET / weight;
        }
      }
      // Dark backgrounds hold a higher alpha floor (0.45 vs 0.3): a heavy
      // palette scaled far down on black would otherwise vanish.
      effRingAlpha = clamp(pal.ringAlpha * alphaScale, DARK_BG ? 0.45 : 0.3, 1.0);
    }
    // Oklab chroma lift is a DARK-only, POST-normalization step: `weight`
    // above is measured on the pre-lift LUT so darkChroma never perturbs
    // normalization (see NORMALIZE_REF_DARK). Light path leaves the LUT as-is.
    if (DARK_BG && DARK_CHROMA !== 1) {
      lut = liftLutChroma(lut, DARK_CHROMA);
    }
    return { lut, weight, effRingAlpha, effPastel };
  };

  // Target palette state — mutable via setPalette / updateOptions.  weight /
  // effRingAlpha / effPastel back getNormalization() and always describe the
  // TARGET palette, even mid-crossfade.
  let paletteLut: Uint8Array = new Uint8Array(LUT_SIZE * 3);
  let weight = 0, effRingAlpha = 0, effPastel = 0;
  // What rendering actually uses: during a crossfade paletteLut points at
  // blendLut and renderRingAlpha lerps between the endpoints; steady-state
  // both equal the target palette's values exactly.
  let renderRingAlpha = 0;

  // Resolve pal.stops through the shared pipeline and adopt it INSTANTLY (no
  // crossfade — setPalette owns the fading path). Used at creation and by
  // updateOptions when a palette-affecting key changes.
  const applyPalette = () => {
    const next = resolvePalette(pal.stops);
    paletteLut = next.lut;
    weight = next.weight;
    effRingAlpha = next.effRingAlpha;
    effPastel = next.effPastel;
    renderRingAlpha = next.effRingAlpha;
  };
  applyPalette();

  // Crossfade state (advanced in step(), dt-driven — never wall-clock).
  // The two scratch LUTs are preallocated once so the per-frame blend never
  // allocates.
  let fadeActive = false;
  let fadeElapsed = 0;
  let fadeDur = 0;
  let fadeFromRingAlpha = 0;
  let fadeToLut = paletteLut;
  let fadeToRingAlpha = effRingAlpha;
  const fadeFromLut = new Uint8Array(LUT_SIZE * 3);
  const blendLut = new Uint8Array(LUT_SIZE * 3);

  // -- Stable per-instance random phases (one per noise stream in neonAt) --
  // A finite `seed` swaps Math.random for a deterministic PRNG so tests/QA
  // can reproduce exact pixels; the phase range (x * 80) is identical.
  const rand =
    typeof options?.seed === "number" && Number.isFinite(options.seed)
      ? mulberry32(options.seed)
      : Math.random;
  const phase = Array.from({ length: 5 }, () => rand() * 80);

  // Full resolution: the scanline renderer is cheap enough to skip a
  // quarter-res downsample, and full-res strips avoid interpolation seams.
  const computeSize = () => ({
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight),
  });

  // -- Offscreen buffers (allocated once per size) --
  // putImageData replaces pixels — alpha 0 included — so each buffer goes
  // through its own offscreen canvas and is composited onto the main canvas
  // with drawImage (source-over).  Strips and corners tile WITHOUT overlap
  // (ownership is resolved per pixel), so compositing never double-draws.
  interface Buf {
    img: ImageData;
    cv: HTMLCanvasElement;
    cx: CanvasRenderingContext2D;
  }
  let stripTop: Buf | null = null;
  let stripBottom: Buf | null = null;
  let stripLeft: Buf | null = null;
  let stripRight: Buf | null = null;
  // Corner buffers in clockwise order: TL, TR, BR, BL.
  let cornerTL: Buf | null = null;
  let cornerTR: Buf | null = null;
  let cornerBR: Buf | null = null;
  let cornerBL: Buf | null = null;

  const mkBuf = (w: number, h: number): Buf | null => {
    if (w < 1 || h < 1) return null;
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const cx = cv.getContext("2d");
    if (!cx) return null;
    return { img: cx.createImageData(w, h), cv, cx };
  };

  // Cached fade gradients (destination-out erasers for the chrome-sampler
  // guards below) — rebuilt in allocBuffers, which runs on every size change,
  // so drawFrame never constructs CanvasGradient objects per frame.
  let topFadeGradient: CanvasGradient | null = null;
  let topCornerFadeL: CanvasGradient | null = null;
  let topCornerFadeR: CanvasGradient | null = null;

  const allocBuffers = () => {
    const W = canvas.width, H = canvas.height;
    stripTop    = mkBuf(W - 2 * RIM, BAND);
    stripBottom = mkBuf(W - 2 * RIM, BAND);
    stripLeft   = mkBuf(BAND, H - 2 * RIM);
    stripRight  = mkBuf(BAND, H - 2 * RIM);
    cornerTL = mkBuf(CQ, CQ);
    cornerTR = mkBuf(CQ, CQ);
    cornerBR = mkBuf(CQ, CQ);
    cornerBL = mkBuf(CQ, CQ);

    // (Re)build the fade gradients for this canvas size: the linear top fade
    // is size-independent (cheap to rebuild anyway); the corner radials
    // anchor at x = 0 and x = W.  Both ramp: fully erased for the inner 40%,
    // untouched beyond the fade distance.
    topFadeGradient = null;
    if (TOP_FADE > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, TOP_FADE);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(0.4, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      topFadeGradient = g;
    }
    topCornerFadeL = null;
    topCornerFadeR = null;
    if (TOP_CORNER_FADE > 0) {
      const mkRadial = (cornerX: number) => {
        const g = ctx.createRadialGradient(cornerX, 0, 0, cornerX, 0, TOP_CORNER_FADE);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(0.4, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        return g;
      };
      topCornerFadeL = mkRadial(0);
      topCornerFadeR = mkRadial(W);
    }
  };

  {
    const { w, h } = computeSize();
    canvas.width = w;
    canvas.height = h;
    allocBuffers();
    ctx.clearRect(0, 0, w, h);
  }

  // Optional additive compositing (C2c): dark backgrounds only. "screen" /
  // "plus-lighter" over a light page would erase the glow, so it is a hard
  // guard on DARK_BG; destroy() restores the inline style. `canvas.style` is
  // always present on real/jsdom/stub canvases, but guard defensively.
  // Re-applied by updateOptions when background / blendMode changes: turning
  // the mode off (or leaving light) clears the inline style we set.
  let blendModeApplied = false;
  const applyBlendMode = () => {
    const shouldApply = DARK_BG && BLEND_MODE !== "source-over";
    if (shouldApply) {
      if (canvas.style) canvas.style.mixBlendMode = BLEND_MODE;
    } else if (blendModeApplied) {
      if (canvas.style) canvas.style.mixBlendMode = "";
    }
    blendModeApplied = shouldApply;
  };
  applyBlendMode();

  // -- Physics state --
  let energy   = 0;
  let angle    = 0;
  let isTyping = false;
  let elapsed  = 0; // wall-clock seconds accumulated via step()

  // Kindle entrance: a reveal wavefront expanding from kindleS0 around the
  // perimeter. kindleActive gates ALL envelope math — when false, neonAt sets
  // np.env = 1 and the output is byte-identical to the steady aura (the whole
  // point of unifying activation with the steady renderer). kindleS0 is the
  // arc-position origin; kindleElapsed advances while active and the kindle
  // completes (deactivates) once it reaches KINDLE_DUR.
  let kindleActive  = false;
  let kindleElapsed = 0;
  let kindleS0      = 0;

  // Internal spring tuning (not exposed as options — coupled to the decay
  // rates; see README "internal tuning").
  const sBurst = mkSpring(46, 10);
  const sHot   = mkSpring(34, 8);

  // 2-D glide spring for the tap hotspot (the tap point projected to its
  // nearest edge).
  const pos: Spring2D = { x: window.innerWidth / 2, y: window.innerHeight, vx: 0, vy: 0, k: 16,  c: 7.5 };

  let tapPoint: { x: number; y: number } | null = null;

  // Independent per-press key bumps: each keypress claims a slot at a fixed
  // bottom-edge x and runs its own envelope — bumps never travel, they rise
  // and die in place.
  const KEY_BUMP_POOL = 5;
  interface KeyBump { tanX: number; energy: number; s: Spring1D }
  const keyBumps: KeyBump[] = Array.from({ length: KEY_BUMP_POOL }, () => ({
    tanX: 0,
    energy: 0,
    s: mkSpring(55, 11),
  }));

  // -------------------------------------------------------------------------
  // Per-frame draw state — closure-level so the hot loops touch no fresh
  // allocations.  Set once per frame by drawFrame / resolveHotspots.
  // -------------------------------------------------------------------------
  let frameIntensity = 1;
  let perimeter = 1;
  let hotEdge = BOTTOM;
  let hotTan  = 0;

  // Organic-motion state, refreshed once per frame in drawFrame (never per
  // column). hueDriftOffset shifts the LUT sample position; highlightCenter /
  // highlightHalf place + size the travelling bloom crest. All read by neonAt.
  let hueDriftOffset = 0;
  let highlightCenter = 0;
  let highlightHalf = 0;

  // Reusable scratch for the neon profile at one arc position; neonAt writes
  // here and the pixel writers read it — zero per-column object churn.
  // coreDen/bloomDenOut/bloomDenIn are the precomputed 2σ² denominators;
  // sbIn is the inward bloom sigma (drives the column reach).
  const np = {
    Ac: 0, Ab: 0, sbIn: 0,
    coreDen: 0, bloomDenOut: 0, bloomDenIn: 0,
    r: 0, g: 0, b: 0,
    // Kindle reveal envelope in [0,1] for the current arc position; 1 when not
    // kindling (steady). writeNeonPixel multiplies the final alpha by this.
    env: 1,
  };

  // Reveal-envelope front position (px of arc-distance from kindleS0 in either
  // direction), computed once per frame in step() from kindleElapsed so neonAt
  // doesn't recompute the easing per arc position. Only read while kindling.
  let kindleFront = 0;

  // -- Corner-continuity profiles (diagonal / wrap seam fix) -----------------
  // The strips split interior pixels along the 45° corner diagonals (see
  // drawStrip's dEnd clamp), and each strip evaluates neonAt at its OWN
  // edge-projected arc position: the two pixels straddling a diagonal sample
  // the noise streams up to ~2·BAND px of path distance apart — and across
  // the s = 0 / s = perimeter wrap at the TL corner, where the streams are
  // fully decorrelated (they are not perimeter-periodic). The resulting
  // amplitude/width step is sub-quantization on light backgrounds but the
  // darkAlphaGamma response lifts deep-bloom alphas several-fold and exposes
  // it as a brightness seam.
  //
  // Fix by construction, in PROFILE space (an arc-position blend cannot work
  // at TL — no s-space path crosses the noise wrap smoothly): once per frame,
  // snap the noise profile at each corner's arc midpoint. The diagonal cut for
  // a near-corner column only lives at DEEP depths — a column at distance c
  // from the corner tile is clipped at depth d ≈ RIM + c (dEnd's diagonal
  // clamp), so shallow pixels (the bright core + inner bloom) are never on the
  // cut. So each blended column keeps its OWN live profile at shallow depth and
  // crossfades — WITH DEPTH — to the shared corner profile over
  // CORNER_DEPTH_FADE_PX px, completing exactly at the cut depth. Both diagonal
  // owners reach weight 1 at that shared depth, so they converge to the SAME
  // profile there and the step vanishes; shallow pixels keep live per-column
  // noise, so the near-corner core/bloom no longer freezes into a flat band
  // (the earlier whole-column freeze read as interference at large band). A
  // small extra shallow lift over the first CORNER_TILE_ADJ_COLS columns closes
  // the tile/strip boundary (the tile renders wholly on the midpoint profile).
  // Corner tiles copy the midpoint profile, which also closes the wrap seam at
  // the TL tile/strip boundary. np.env (kindle reveal) is intentionally NOT
  // blended: it must keep sweeping per arc position and is already circularly
  // continuous across the wrap.
  const cornerNp = [0, 1, 2, 3].map(() => ({
    Ac: 0, coreDen: 0, Ab: 0, bloomDenOut: 0, sbIn: 0, bloomDenIn: 0,
    r: 0, g: 0, b: 0,
  }));

  type CornerProfile = (typeof cornerNp)[number];

  // Scratch holding a strip column's OWN (live) profile, snapshotted from np
  // before a blended column overwrites np per depth — so each depth can lerp
  // between the live profile and the shared corner profile.
  const ownNp: CornerProfile = {
    Ac: 0, coreDen: 0, Ab: 0, bloomDenOut: 0, sbIn: 0, bloomDenIn: 0,
    r: 0, g: 0, b: 0,
  };

  // Snap the four midpoint profiles for this frame. Runs after
  // resolveHotspots (neonAt reads hotEdge/hotTan) and before the tiles draw.
  const snapCornerProfiles = (W: number, H: number, arcS0: number[]) => {
    const md = CR * Math.SQRT1_2; // arc-midpoint offset from the arc center
    for (let kind = 0; kind < 4; kind++) {
      const ccx = CORNER_X_NEG[kind] ? RIM : W - RIM;
      const ccy = CORNER_Y_NEG[kind] ? RIM : H - RIM;
      const mx = ccx + (CORNER_X_NEG[kind] ? -md : md);
      const my = ccy + (CORNER_Y_NEG[kind] ? -md : md);
      // Hotspot gating inherits the corner tile's f = 0.5 convention
      // (edges[1]); both hotspot Gaussians are exponentially small this far
      // from any straight-edge hotspot, so the edge choice is a tie-break,
      // not a visible decision.
      const edgeId = CORNER_EDGES[kind][1];
      const tan = edgeId === TOP || edgeId === BOTTOM ? mx : my;
      neonAt(arcS0[CORNER_ARC_INDEX[kind]] + ARC / 2, edgeId, tan);
      const p = cornerNp[kind];
      p.Ac = np.Ac; p.coreDen = np.coreDen; p.Ab = np.Ab;
      p.bloomDenOut = np.bloomDenOut; p.sbIn = np.sbIn;
      p.bloomDenIn = np.bloomDenIn;
      p.r = np.r; p.g = np.g; p.b = np.b;
    }
  };

  // Snapshot the current np (a column's own live profile) into ownNp.
  const snapOwnNp = () => {
    ownNp.Ac = np.Ac; ownNp.coreDen = np.coreDen; ownNp.Ab = np.Ab;
    ownNp.bloomDenOut = np.bloomDenOut; ownNp.sbIn = np.sbIn;
    ownNp.bloomDenIn = np.bloomDenIn;
    ownNp.r = np.r; ownNp.g = np.g; ownNp.b = np.b;
  };

  // Set np = lerp(ownNp, corner, w) for every field writeNeonPixel reads
  // (np.env is deliberately left alone — the kindle reveal must keep sweeping
  // per arc position). sbIn and bloomDenIn lerp independently — sbIn only
  // drives the integer column reach, so a mid-blend mismatch with 2·sbIn² is
  // confined to a ±1 px cutoff of near-zero alpha.
  const lerpNpToCorner = (p: CornerProfile, w: number) => {
    np.Ac = ownNp.Ac + w * (p.Ac - ownNp.Ac);
    np.coreDen = ownNp.coreDen + w * (p.coreDen - ownNp.coreDen);
    np.Ab = ownNp.Ab + w * (p.Ab - ownNp.Ab);
    np.bloomDenOut = ownNp.bloomDenOut + w * (p.bloomDenOut - ownNp.bloomDenOut);
    np.sbIn = ownNp.sbIn + w * (p.sbIn - ownNp.sbIn);
    np.bloomDenIn = ownNp.bloomDenIn + w * (p.bloomDenIn - ownNp.bloomDenIn);
    np.r = ownNp.r + w * (p.r - ownNp.r);
    np.g = ownNp.g + w * (p.g - ownNp.g);
    np.b = ownNp.b + w * (p.b - ownNp.b);
  };

  // Per-position neon profile parameters, written into np.  s is the
  // clockwise arc position (px) along the centerline path — drives palette +
  // noise phases so both stay continuous around corners; tan is the
  // coordinate along the nearest straight edge used for the hotspot
  // Gaussians.
  const neonAt = (s: number, edgeId: number, tan: number): void => {
    const t = elapsed;
    const burst = sBurst.x;

    // Key bumps live on the bottom edge only: Σ spring × Gaussian over the
    // independent fixed-position bumps.
    let keySum = 0;
    if (edgeId === BOTTOM) {
      for (let i = 0; i < KEY_BUMP_POOL; i++) {
        const b = keyBumps[i];
        if (b.s.x <= SPRING_EPS) continue;
        const d = tan - b.tanX;
        keySum += b.s.x * Math.exp(-(d * d) / (2 * KEY_SIGMA * KEY_SIGMA));
      }
    }
    let hotG = 0;
    if (edgeId === hotEdge && sHot.x > SPRING_EPS) {
      const dHot = tan - hotTan;
      hotG = Math.exp(-(dHot * dHot) / (2 * TAP_SIGMA * TAP_SIGMA));
    }

    // Core amplitude — near-opaque centerline with a faint organic shimmer.
    np.Ac = 0.92 + 0.08 * noise(t * 0.5, s * 0.013 + phase[2]);

    // Core thickness undulates smoothly along the ring (slow noise — the
    // same stream stays continuous through the corner arcs).
    const sc = CORE_SIGMA_BASE + CORE_SIGMA_VAR * (2 * noise(t * 0.4, s * 0.02 + phase[3]) - 1);
    np.coreDen = 2 * sc * sc;

    // Bloom amplitude + width swell with the energy springs.  The rest-state
    // amplitude breathes deep (0.15–0.65) so the half-max line width visibly
    // collapses and swells (~5–10px) instead of hovering near constant.
    np.Ab = clamp(
      0.15 + 0.50 * noise(t * 0.5, s * 0.011 + phase[1]) +
        0.30 * keySum +
        0.25 * sHot.x * hotG +
        0.15 * burst,
      0, 0.85,
    );

    // Travelling highlight (C4b): a raised-cosine crest of arc-width
    // HIGHLIGHT_ARC_FRAC·perimeter, centered at highlightCenter (both set per
    // frame), swells ONLY the bloom amplitude — min outside the crest, full
    // inside. OFF by default: the whole block is skipped, so np.Ab is
    // byte-for-byte unchanged.
    if (HIGHLIGHT_ON) {
      const ds = Math.abs(s - highlightCenter);
      const dCirc = Math.min(ds, perimeter - ds); // circular arc-distance
      const w =
        dCirc < highlightHalf ? 0.5 * (1 + Math.cos((Math.PI * dCirc) / highlightHalf)) : 0;
      np.Ab *= HIGHLIGHT_MIN + (1 - HIGHLIGHT_MIN) * w;
    }
    const sb = clamp(
      4.5 + 5.5 * noise(t * 0.6, s * 0.015 + phase[0]) +
        9 * keySum +
        7 * sHot.x * hotG +
        2 * burst,
      4, 16,
    );
    np.bloomDenOut = 2 * sb * sb;

    // Inward tail: wider and slowly breathing, so the inner face dissolves
    // softly instead of mirroring the tight outer cutoff.
    const sbIn = Math.min(
      INNER_SIGMA_MAX,
      sb * (INNER_SOFT_BASE + INNER_SOFT_VAR * noise(t * 0.45, s * 0.012 + phase[4])),
    );
    np.sbIn = sbIn;
    np.bloomDenIn = 2 * sbIn * sbIn;

    // Hue drift (C4a): a slow per-frame offset (0 when disabled) rotates the
    // palette sample position; adding an exact 0 leaves the byte output intact.
    const p = (((s / perimeter) + angle + hueDriftOffset) % 1 + 1) % 1;
    const ci = Math.min(LUT_SIZE - 1, Math.max(0, Math.round(p * (LUT_SIZE - 1))));
    np.r = paletteLut[ci * 3];
    np.g = paletteLut[ci * 3 + 1];
    np.b = paletteLut[ci * 3 + 2];

    // Kindle reveal envelope. ABSOLUTE INVARIANT: when not kindling, env is
    // exactly 1 (skip the math entirely) so the rendered frame is byte-identical
    // to the steady aura. While kindling, the wavefront has swept to kindleFront
    // (px of arc-distance from kindleS0, computed in step()); a position lights
    // up once the front passes it, ramping over KINDLE_SOFT.
    if (!kindleActive) {
      np.env = 1;
    } else {
      const ds = Math.abs(s - kindleS0);
      const d = Math.min(ds, perimeter - ds); // circular arc-distance
      np.env = smoothstep01((kindleFront - d) / KINDLE_SOFT);
    }
  };

  // Shared per-pixel neon profile: core + bloom Gaussians from np, scaled by
  // frame intensity, core whitened toward 255.  tIn is the signed distance
  // to the centerline with INWARD POSITIVE on every segment (straights:
  // depth − INSET; corners: CR − radialDist) — the bloom picks the wider,
  // slowly-breathing inward denominator on that side, which is what melts
  // the ring's inner face.  On the outward side (tIn < 0) the profile keeps
  // its flat centerline value (t = 0) — without it the Gaussian would fade
  // toward the screen edge and leave a translucent sliver — but the final
  // alpha is multiplied by an OUTWARD FEATHER that stays 1 out to INSET px
  // and then fades to 0 over CORNER_FEATHER_PX. On straights the outward
  // reach never exceeds INSET − 0.5 px (see writeColumn: tIn = d + 0.5 −
  // INSET, min |tIn| = INSET − 0.5 at d = 0), so the feather is EXACTLY 1
  // there and those pixels are byte-identical to the pre-rounding renderer;
  // only corner tiles, whose square region extends past INSET, round off —
  // ending ~INSET px beyond the arc, tangent to both screen edges.
  //
  // On dark backgrounds the geometric coverage is additionally pushed through
  // the darkAlphaLut response curve (pow(coverage, darkAlphaGamma)) before
  // compositing; the light path skips that indirection entirely.
  const writeNeonPixel = (
    data: Uint8ClampedArray,
    idx: number,
    tIn: number,
  ): number => {
    const t = tIn < 0 ? 0 : tIn;
    const tt = t * t;
    // Core is negligible past tt ≈ 40 (exp(−40/5.8) < 0.001) — skipping the
    // exp matters because the long inner tail makes deep pixels the
    // majority of the loop.
    const core = tt < 40 ? np.Ac * Math.exp(-tt / np.coreDen) : 0;
    let bloom: number;
    if (t > 0) {
      // Long-tailed rational falloff: (1 + t²/2σ²)^−1.5, computed as
      // u·√u (no Math.pow).  The quartic window eases it to exactly 0 at
      // BAND depth so the buffer edge never shows as a line.
      const u = 1 + tt / np.bloomDenIn;
      const x = (t + INSET) / BAND;
      const x2 = x * x;
      const win = 1 - x2 * x2;
      bloom = win > 0 ? (np.Ab * win) / (u * Math.sqrt(u)) : 0;
    } else {
      bloom = np.Ab * Math.exp(-tt / np.bloomDenOut);
    }
    // Outward feather: flat to INSET px, then a CORNER_FEATHER_PX fade to 0.
    // Exactly 1 for every straight-edge pixel (|tIn| ≤ INSET − 0.5).
    let outwardFade = 1;
    if (tIn < 0) {
      const aOut = -tIn;
      if (aOut > INSET) {
        outwardFade = 1 - smoothstep01((aOut - INSET) / CORNER_FEATHER_PX);
      }
    }
    const aGeom = Math.min(1, core + bloom);
    const a = DARK_BG
      ? darkAlphaLut[(aGeom * 255) | 0] * frameIntensity * np.env * outwardFade
      : aGeom * frameIntensity * np.env * outwardFade;
    if (a >= ALPHA_EPS) {
      const wm = CORE_WHITEN * core;
      data[idx]     = np.r + (255 - np.r) * wm;
      data[idx + 1] = np.g + (255 - np.g) * wm;
      data[idx + 2] = np.b + (255 - np.b) * wm;
      data[idx + 3] = a * 255;
    }
    return a;
  };

  // Write one inward column of the neon profile (current np) into a strip
  // buffer.  base/strideBytes encode the edge-specific pixel layout; depth d
  // runs from the screen edge inward.  Breaks out as soon as t is past the
  // centerline and both Gaussians are negligible.
  const writeColumn = (
    data: Uint8ClampedArray,
    base: number,
    strideBytes: number,
    dEnd: number,
  ) => {
    let idx = base;
    for (let d = 0; d < dEnd; d++, idx += strideBytes) {
      const tIn = d + 0.5 - INSET;
      const a = writeNeonPixel(data, idx, tIn);
      if (a < ALPHA_EPS && tIn > 0) break; // both terms only shrink from here on
    }
  };

  // Near-corner variant: crossfade the column's OWN profile (already in np,
  // snapshotted here) to the shared corner profile WITH DEPTH. The depth ramp
  // completes (weight 1) at the diagonal cut depth `diagCut` — the deepest
  // pixel this column draws before the diagonal hands the rest to the adjacent
  // strip — so both owning strips agree there and the seam nulls; shallower
  // pixels stay on the live per-column profile (no frozen band). `wColFloor`
  // is a constant per-column shallow lift (>0 only for the first few columns
  // next to the corner tile) that also pulls those shallow pixels toward the
  // corner profile so the strip meets the tile without a step. The extra
  // per-pixel math is confined to near-corner columns; mid-edge columns take
  // the plain writeColumn path and stay byte-identical.
  const writeColumnBlend = (
    data: Uint8ClampedArray,
    base: number,
    strideBytes: number,
    dEnd: number,
    corner: CornerProfile,
    diagCut: number,
    wColFloor: number,
  ) => {
    snapOwnNp();
    // Ramp reaches weight 1 at the deepest drawn diagonal pixel (dEnd − 1 when
    // the diagonal clips, i.e. diagCut − 1), starting CORNER_DEPTH_FADE_PX px
    // shallower.
    const dLo = diagCut - 1 - CORNER_DEPTH_FADE_PX;
    let idx = base;
    // No early break here: unlike a single profile, the crossfade makes alpha
    // NON-monotonic in depth (the column's own bloom fades, then the corner
    // profile rises to the shared cut value), so a dip below ε mid-crossfade
    // does not mean the tail is done — breaking would clip the deep corner
    // tail and re-open the ownership seam. dEnd already bounds the loop by the
    // corner reach / diagonal clamp, and blended columns are corner-local.
    for (let d = 0; d < dEnd; d++, idx += strideBytes) {
      const wDepth = smoothstep01((d - dLo) / CORNER_DEPTH_FADE_PX);
      lerpNpToCorner(corner, wColFloor > wDepth ? wColFloor : wDepth);
      writeNeonPixel(data, idx, d + 0.5 - INSET);
    }
  };

  // Bloom reach (px from the screen edge) for the current inward sigma.
  // The rational tail stays visible to roughly 7σ (vs 3σ for a Gaussian);
  // the early-break in writeColumn trims whatever ends sooner.
  const reach = (sbIn: number) => Math.min(BAND, Math.ceil(INSET + 7 * sbIn));

  // -------------------------------------------------------------------------
  // drawFrame stages
  // -------------------------------------------------------------------------

  // Resolve which edge the tap hotspot currently lives on, plus its
  // tangential coordinate on that edge — the tap bump only applies there.
  const resolveHotspots = (W: number, H: number) => {
    const proj = projectToEdge(pos.x, pos.y, W, H);
    if (proj.y === 0)      { hotEdge = TOP;    hotTan = proj.x; }
    else if (proj.x === W) { hotEdge = RIGHT;  hotTan = proj.y; }
    else if (proj.y === H) { hotEdge = BOTTOM; hotTan = proj.x; }
    else                   { hotEdge = LEFT;   hotTan = proj.y; }
  };

  // One strip-drawing pass, parameterized per edge:
  //   s = sBase + sDir·(g + 0.5)        — clockwise arc position
  //   own = min(g, limit − 1 − g) + ownBias — corner-diagonal ownership clamp
  //     (horizontal strips win ties on the diagonals: bias 1 vs 0)
  //   base = base0 + i·basePerI, stride — edge-specific pixel layout
  interface StripCfg {
    buf: Buf | null;
    edgeId: number;
    sBase: number;
    sDir: 1 | -1;
    limit: number;
    ownBias: 0 | 1;
    base0: number;
    basePerI: number;
    strideBytes: number;
    // Corner kinds (0 TL, 1 TR, 2 BR, 3 BL) adjacent to column i = 0 and
    // i = count − 1, for the corner-continuity crossfade.
    startCorner: number;
    endCorner: number;
  }

  const drawStrip = (cfg: StripCfg) => {
    const buf = cfg.buf;
    if (!buf) return;
    const data = buf.img.data;
    data.fill(0);
    const count = cfg.edgeId === TOP || cfg.edgeId === BOTTOM ? buf.cv.width : buf.cv.height;
    for (let i = 0; i < count; i++) {
      const g = RIM + i; // global coordinate along the edge
      neonAt(cfg.sBase + cfg.sDir * (g + 0.5), cfg.edgeId, g + 0.5);
      // Diagonal ownership clamp: this column is handed to the adjacent strip
      // past `diag`; the nearer corner (start when i ≤ iEnd, else end) owns it.
      const iEnd = count - 1 - i; // column distance from the far corner
      const diag = Math.min(g, cfg.limit - 1 - g) + cfg.ownBias;
      const base = cfg.base0 + i * cfg.basePerI;
      // The diagonal cut only lands within the visible band for near-corner
      // columns (diag < BAND); those crossfade to the shared corner profile at
      // depth, so the seam nulls without freezing the shallow core/bloom.
      // Everything else takes the plain path and is byte-identical to before.
      if (diag < BAND) {
        const nearStart = i <= iEnd;
        const corner = cornerNp[nearStart ? cfg.startCorner : cfg.endCorner];
        const colDist = nearStart ? i : iEnd;
        // Clip the deep tail by the CORNER profile's reach, not the column's
        // own: pixels near the diagonal cut use the corner profile, so adjacent
        // columns owning the same corner must share the same deepest drawn
        // depth — otherwise one strip draws a faint tail pixel its neighbour
        // clips, re-opening a ±1 px seam at the ownership boundary.
        const dEnd = Math.min(reach(corner.sbIn), diag);
        // Shallow tile-adjacency lift over the first CORNER_TILE_ADJ_COLS
        // columns (fades to 0), so the strip meets the midpoint-profile tile
        // without a boundary step.
        const wColFloor =
          colDist < CORNER_TILE_ADJ_COLS
            ? 1 - smoothstep01(colDist / CORNER_TILE_ADJ_COLS)
            : 0;
        writeColumnBlend(data, base, cfg.strideBytes, dEnd, corner, diag, wColFloor);
      } else {
        writeColumn(data, base, cfg.strideBytes, Math.min(reach(np.sbIn), diag));
      }
    }
    buf.cx.putImageData(buf.img, 0, 0);
  };

  const drawStrips = (
    W: number, H: number,
    sRight0: number, sBottom0: number, sLeft0: number,
  ) => {
    // Byte layout derives from each strip's OWN buffer dimensions — never a
    // sibling's — so a change to one allocation can never silently corrupt
    // another strip's indexing. (Top/bottom widths are equal today, as are
    // left/right; that is an allocation detail, not a layout contract.)
    const topW   = stripTop    ? stripTop.cv.width     : 0;
    const botW   = stripBottom ? stripBottom.cv.width  : 0;
    const botH   = stripBottom ? stripBottom.cv.height : 0;
    const leftW  = stripLeft   ? stripLeft.cv.width    : 0;
    const rightW = stripRight  ? stripRight.cv.width   : 0;
    // Clockwise s direction: top and right run with increasing coordinate,
    // bottom and left run against it.
    const strips: StripCfg[] = [
      { buf: stripTop,    edgeId: TOP,    sBase: -RIM,               sDir:  1, limit: W, ownBias: 1,
        base0: 0,                    basePerI: 4,          strideBytes:  topW * 4,
        startCorner: 0, endCorner: 1 },
      { buf: stripBottom, edgeId: BOTTOM, sBase: sBottom0 + W - RIM, sDir: -1, limit: W, ownBias: 1,
        base0: (botH - 1) * botW * 4, basePerI: 4,         strideBytes: -botW * 4,
        startCorner: 3, endCorner: 2 },
      { buf: stripLeft,   edgeId: LEFT,   sBase: sLeft0 + H - RIM,   sDir: -1, limit: H, ownBias: 0,
        base0: 0,                    basePerI: leftW * 4,  strideBytes:  4,
        startCorner: 0, endCorner: 3 },
      { buf: stripRight,  edgeId: RIGHT,  sBase: sRight0 - RIM,      sDir:  1, limit: H, ownBias: 0,
        base0: (rightW - 1) * 4,     basePerI: rightW * 4, strideBytes: -4,
        startCorner: 1, endCorner: 2 },
    ];
    for (const cfg of strips) drawStrip(cfg);
  };

  // Each corner draws ONLY the RIM×RIM quadrant whose pixels project onto
  // the arc (both coordinates within RIM of the screen corner); everything
  // else stays transparent and is owned by the strips.  t is the radial
  // distance to the arc, s = arcStart + CR·θ keeps palette/noise continuous,
  // and hotspot gating is inherited from the nearer of the two adjacent
  // straight edges (split at the arc midpoint f = 0.5).
  const drawCorner = (
    buf: Buf | null,
    ox: number, oy: number,   // buffer placement on the main canvas
    ccx: number, ccy: number, // arc center (global)
    kind: number,             // 0 TL, 1 TR, 2 BR, 3 BL
    arcS0: number[],
  ) => {
    if (!buf) return;
    const data = buf.img.data;
    data.fill(0);
    const px0 = CORNER_X_NEG[kind] ? ccx - RIM : ccx;
    const py0 = CORNER_Y_NEG[kind] ? ccy - RIM : ccy;
    const s0 = arcS0[CORNER_ARC_INDEX[kind]];
    const thOff = CORNER_TH_OFFSET[kind];
    const edges = CORNER_EDGES[kind];
    // Corner continuity: the whole tile renders with the arc-midpoint noise
    // profile (the natural variation across a quarter arc is sub-quantization
    // anyway), which matches the w = 1 span of both adjacent strips at the
    // tile boundaries — including across the s = 0 noise wrap at TL. Only
    // np.env still varies per pixel, so neonAt is needed only while kindling.
    const p = cornerNp[kind];

    for (let py = py0; py < py0 + RIM; py++) {
      for (let px = px0; px < px0 + RIM; px++) {
        const dx = px + 0.5 - ccx;
        const dy = py + 0.5 - ccy;
        // Inward-positive signed distance: pixels closer to the arc CENTER
        // than CR are on the screen-interior side of the centerline.
        const tIn = CR - Math.hypot(dx, dy);

        // Early skip: beyond the outward feather (radialDist > CR + INSET +
        // CORNER_FEATHER_PX, i.e. tIn < −(INSET + feather)) the feather has
        // already reached 0 — nothing to write, and a perf win on the square
        // corner region the rounded glow no longer fills.
        if (tIn < -(INSET + CORNER_FEATHER_PX)) continue;

        if (kindleActive) {
          // Clockwise fraction along this quarter arc (0..1) — only the
          // reveal envelope consumes the arc position now.
          const f = clamp((Math.atan2(dy, dx) + thOff) / HALF_PI, 0, 1);
          const edgeId = f < 0.5 ? edges[0] : edges[1];
          const tan = (edgeId === TOP || edgeId === BOTTOM) ? px + 0.5 : py + 0.5;
          neonAt(s0 + f * ARC, edgeId, tan); // sets np.env for this pixel
        } else {
          np.env = 1;
        }
        np.Ac = p.Ac; np.coreDen = p.coreDen; np.Ab = p.Ab;
        np.bloomDenOut = p.bloomDenOut; np.sbIn = p.sbIn;
        np.bloomDenIn = p.bloomDenIn;
        np.r = p.r; np.g = p.g; np.b = p.b;

        const idx = ((py - oy) * CQ + (px - ox)) * 4;
        writeNeonPixel(data, idx, tIn);
      }
    }
    buf.cx.putImageData(buf.img, 0, 0);
  };

  const drawCorners = (W: number, H: number, arcS0: number[]) => {
    drawCorner(cornerTL, 0,      0,      RIM,     RIM,     0, arcS0);
    drawCorner(cornerTR, W - CQ, 0,      W - RIM, RIM,     1, arcS0);
    drawCorner(cornerBR, W - CQ, H - CQ, W - RIM, H - RIM, 2, arcS0);
    drawCorner(cornerBL, 0,      H - CQ, RIM,     H - RIM, 3, arcS0);
  };

  // Composite: tiles are pixel-disjoint, so source-over never double-draws.
  const composite = (W: number, H: number) => {
    ctx.clearRect(0, 0, W, H);
    if (stripTop)    ctx.drawImage(stripTop.cv,    RIM, 0);
    if (stripBottom) ctx.drawImage(stripBottom.cv, RIM, H - BAND);
    if (stripLeft)   ctx.drawImage(stripLeft.cv,   0, RIM);
    if (stripRight)  ctx.drawImage(stripRight.cv,  W - BAND, RIM);
    if (cornerTL) ctx.drawImage(cornerTL.cv, 0, 0);
    if (cornerTR) ctx.drawImage(cornerTR.cv, W - CQ, 0);
    if (cornerBR) ctx.drawImage(cornerBR.cv, W - CQ, H - CQ);
    if (cornerBL) ctx.drawImage(cornerBL.cv, 0, H - CQ);
  };

  // Internal draw (shared by render and renderStatic).
  const drawFrame = (intensity: number) => {
    // Self-heal: if the viewport changed while the canvas was off-screen,
    // fix the backing store (and buffers) here.
    const { w: wantW, h: wantH } = computeSize();
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width  = wantW;
      canvas.height = wantH;
      allocBuffers();
      ctx.clearRect(0, 0, wantW, wantH);
    }

    const W = canvas.width, H = canvas.height;
    const LT = W - 2 * RIM; // top/bottom straight length
    const LH = H - 2 * RIM; // left/right straight length

    frameIntensity = intensity * renderRingAlpha;
    perimeter = Math.max(1, 2 * LT + 2 * LH + 4 * ARC);

    // Organic motion (C4), computed once per frame — one sin for the hue
    // drift, plus the crest placement for the highlight. Both stay exactly
    // inert (offset 0 / block skipped in neonAt) when their option is off.
    hueDriftOffset =
      HUE_DRIFT_DEG !== 0
        ? (HUE_DRIFT_DEG / 360) * Math.sin((2 * Math.PI * elapsed) / HUE_DRIFT_PERIOD)
        : 0;
    if (HIGHLIGHT_ON) {
      highlightCenter = ((elapsed / HIGHLIGHT_PERIOD) % 1) * perimeter;
      highlightHalf = (HIGHLIGHT_ARC_FRAC * perimeter) / 2;
    }

    // Arc-position offsets of the path segments (clockwise from the start of
    // the top straight at (RIM, INSET)).
    const sRight0  = LT + ARC;
    const sBottom0 = LT + 2 * ARC + LH;
    const sLeft0   = 2 * LT + 3 * ARC + LH;
    const arcS0 = [LT, LT + ARC + LH, 2 * LT + 2 * ARC + LH, 2 * LT + 3 * ARC + 2 * LH]; // TR, BR, BL, TL

    resolveHotspots(W, H);
    snapCornerProfiles(W, H, arcS0); // after hotspots — neonAt reads hotEdge
    drawStrips(W, H, sRight0, sBottom0, sLeft0);
    drawCorners(W, H, arcS0);
    composite(W, H);

    // Chrome-sampler guard: erase the topmost rows so browsers that tint
    // their window chrome from the page's top pixels (Arc, Safari-style)
    // see neutral canvas instead of the animated glow. Fully erased for the
    // first 40% of the strip, ramping to untouched at TOP_FADE px.
    // (Gradients are cached — built in allocBuffers on every size change.)
    if (topFadeGradient) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = topFadeGradient;
      ctx.fillRect(0, 0, W, TOP_FADE);
      ctx.restore();
    }

    // Same guard for the top-corner neighbourhoods: chrome samplers show the
    // left corner's colour at the toolbar's left end and the right corner's
    // at its right end, and the side glows below TOP_FADE would otherwise
    // still feed them. Radial: fully erased for the inner 40%, untouched
    // beyond TOP_CORNER_FADE px from the corner point.
    if (topCornerFadeL && topCornerFadeR) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = topCornerFadeL;
      ctx.fillRect(0, 0, TOP_CORNER_FADE, TOP_CORNER_FADE);
      ctx.fillStyle = topCornerFadeR;
      ctx.fillRect(W - TOP_CORNER_FADE, 0, TOP_CORNER_FADE, TOP_CORNER_FADE);
      ctx.restore();
    }
  };

  // Map a viewport point to its clockwise arc position s on the centerline
  // path, using the SAME segment offsets drawFrame uses (top straight starts
  // at s=0 / x=RIM, clockwise through TR/right/BR/bottom/BL/left/TL). The point
  // is projected to its nearest edge, then placed along that straight; the
  // tangential coordinate is clamped into the straight span so a click that
  // projects near a corner lands at the straight's end (corner precision isn't
  // critical — kindle origins are continuous and approximate is acceptable).
  const arcPosFromPoint = (x: number, y: number, W: number, H: number): number => {
    const LT = W - 2 * RIM;
    const LH = H - 2 * RIM;
    const ARCk = HALF_PI * CR;
    const sRight0  = LT + ARCk;
    const sBottom0 = LT + 2 * ARCk + LH;
    const sLeft0   = 2 * LT + 3 * ARCk + LH;
    const proj = projectToEdge(x, y, W, H);
    if (proj.y === 0)      return clamp(proj.x - RIM, 0, LT);                 // TOP
    if (proj.x === W)      return sRight0 + clamp(proj.y - RIM, 0, LH);       // RIGHT
    if (proj.y === H)      return sBottom0 + clamp(W - RIM - proj.x, 0, LT);  // BOTTOM
    return sLeft0 + clamp(H - RIM - proj.y, 0, LH);                           // LEFT
  };

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------
  // Defense in depth: after destroy(), step/render/renderStatic become no-ops
  // so a stray host callback (e.g. an orphan rAF tick) can never draw into a
  // cleared canvas.
  let destroyed = false;

  const engine: AuraEngine = {
    step(dtMs: number) {
      if (destroyed) return;
      // Clamp dt to [0, 50ms]: negative and NaN dtMs (host clock glitches,
      // first-frame deltas) become 0 instead of corrupting the springs.
      const dt = Math.min(0.05, Math.max(0, dtMs / 1000) || 0);
      elapsed += dt;

      // Advance the palette crossfade: lerp the LUT bytes + ring alpha from
      // the fade-start snapshot toward the target.  On completion adopt the
      // target state exactly, so steady frames are byte-identical to a fresh
      // instance created with the new stops.
      if (fadeActive) {
        fadeElapsed += dt;
        const f = fadeElapsed / fadeDur;
        if (f >= 1) {
          fadeActive = false;
          paletteLut = fadeToLut;
          renderRingAlpha = fadeToRingAlpha;
        } else {
          for (let i = 0; i < LUT_SIZE * 3; i++) {
            blendLut[i] = Math.round(fadeFromLut[i] + f * (fadeToLut[i] - fadeFromLut[i]));
          }
          renderRingAlpha = fadeFromRingAlpha + f * (fadeToRingAlpha - fadeFromRingAlpha);
        }
      }

      // Advance the kindle reveal. progress eases to 1; the wavefront travels
      // to perimeter/2 + SOFT so the far point (max arc-distance = perimeter/2)
      // is fully revealed at completion. When done, deactivate — every
      // subsequent frame is the unmodified steady aura (env ≡ 1).
      if (kindleActive) {
        kindleElapsed += dt;
        if (kindleElapsed >= KINDLE_DUR) {
          kindleActive = false;
          kindleFront = 0;
        } else {
          const progress = easeOutCubic(kindleElapsed / KINDLE_DUR);
          kindleFront = progress * (perimeter / 2 + KINDLE_SOFT);
        }
      }

      // Exponential decay for all energy stores.
      energy *= Math.exp(-dt * DECAY);

      stepSpring(sBurst, energy * 0.55, dt);
      stepSpring(sHot,   energy,        dt);

      // Independent key bumps: each decays and springs in place.
      const keyDecayF = Math.exp(-dt * KEY_DECAY);
      for (let i = 0; i < KEY_BUMP_POOL; i++) {
        const b = keyBumps[i];
        b.energy *= keyDecayF;
        stepSpring(b.s, b.energy, dt);
      }

      // Tap hotspot glide.
      if (tapPoint) {
        const W = window.innerWidth, H = window.innerHeight;
        const tgt = projectToEdge(tapPoint.x, tapPoint.y, W, H);
        pos.vx += (pos.k * (tgt.x - pos.x) - pos.c * pos.vx) * dt;
        pos.vy += (pos.k * (tgt.y - pos.y) - pos.c * pos.vy) * dt;
        pos.x  += pos.vx * dt;
        pos.y  += pos.vy * dt;
      }

      const duration = isTyping ? ROTATE_TYPING_S : ROTATE_IDLE_S;
      angle += dt / duration;
    },

    render() {
      if (destroyed) return;
      drawFrame(1);
    },

    renderStatic() {
      if (destroyed) return;
      // Springs are all zero before any input, so the bumps vanish on their
      // own — only the ambient ring remains, dimmed for reduced-motion.
      drawFrame(0.6);
    },

    tap(point) {
      if (point) tapPoint = point;
      energy = Math.min(energy + TAP_ENERGY, ENERGY_CAP);
    },

    key(x) {
      // The pixel position is fixed at press time: bumps never travel.
      const tanX = (KEY_X_MIN + KEY_X_SPAN * x) * window.innerWidth;

      // Reinforce a live bump at (nearly) the same position — repeated
      // same-key presses pump one bump instead of consuming the pool.
      for (let i = 0; i < KEY_BUMP_POOL; i++) {
        const b = keyBumps[i];
        if (b.energy > 0.05 && Math.abs(tanX - b.tanX) < KEY_SIGMA * 0.5) {
          b.tanX = tanX;
          b.energy = Math.min(b.energy + KEY_ENERGY, ENERGY_CAP);
          return;
        }
      }

      // Otherwise claim the quietest slot (least energy + spring value); its
      // spring rises from its current value (~0 for a stale slot).
      let slot = keyBumps[0];
      let best = slot.energy + slot.s.x;
      for (let i = 1; i < KEY_BUMP_POOL; i++) {
        const b = keyBumps[i];
        const score = b.energy + b.s.x;
        if (score < best) { best = score; slot = b; }
      }
      slot.tanX = tanX;
      slot.energy = Math.min(KEY_ENERGY, ENERGY_CAP);
    },

    pulse(amount?: number) {
      // Non-finite input would poison the shared energy store (NaN never
      // decays) — degrade to the default pulse energy instead.
      const e = Number.isFinite(amount) ? Math.max(0, amount!) : SAVED_PULSE_ENERGY;
      energy = Math.min(energy + e, ENERGY_CAP);
    },

    savedPulse() {
      // Deprecated alias — see the interface doc.
      engine.pulse();
    },

    kindle(x, y) {
      const W = canvas.width, H = canvas.height;
      // Seed perimeter now so the first step()'s front is computed against the
      // correct path length even before the first render sets it.
      const LT = W - 2 * RIM;
      const LH = H - 2 * RIM;
      perimeter = Math.max(1, 2 * LT + 2 * LH + 4 * ARC);
      kindleS0 = arcPosFromPoint(x, y, W, H);
      kindleElapsed = 0;
      kindleFront = 0;
      kindleActive = true;
    },

    setTyping(on) {
      isTyping = on;
    },

    setPalette(palette, opts) {
      if (destroyed) return;

      let stops: EdgeAuraPaletteStops;
      if (typeof palette === "string") {
        const preset = EDGE_AURA_PALETTES[palette];
        if (!preset) {
          throw new Error(`edge-aura: unknown palette preset "${palette}"`);
        }
        stops = preset;
      } else {
        validatePaletteStops(palette);
        stops = palette;
      }

      // Record the newly selected stops as the instance's resolved palette so a
      // later updateOptions({ palette }) rebuilds the LUT from the palette that
      // is actually on screen — not the creation-time stops. Without this,
      // applyPalette()->resolvePalette(pal.stops) would silently revert the ring
      // to its original palette on any palette-section update (C5).
      // Record the newly selected stops as the instance's resolved palette so a
      // later updateOptions({ palette }) rebuilds the LUT from the palette that
      // is actually on screen — not the creation-time stops. Without this,
      // applyPalette()->resolvePalette(pal.stops) would silently revert the ring
      // to its original palette on any palette-section update (C5).
      pal = { ...pal, stops };

      // Same pipeline as creation — the target state is exactly what a
      // fresh instance with these stops (and this instance's palette
      // settings) would compute.
      const next = resolvePalette(stops);
      weight = next.weight;
      effRingAlpha = next.effRingAlpha;
      effPastel = next.effPastel;
      fadeToLut = next.lut;
      fadeToRingAlpha = next.effRingAlpha;

      const crossfadeMs = opts?.crossfadeMs;
      if (typeof crossfadeMs === "number" && Number.isFinite(crossfadeMs) && crossfadeMs > 0) {
        // Snapshot whatever is currently rendered — mid-fade included — as
        // the blend origin, then point rendering at the scratch LUT.  The
        // scratch starts as an exact copy of the snapshot, so a render
        // before the first step() (f = 0) shows no pop.
        fadeFromLut.set(paletteLut);
        fadeFromRingAlpha = renderRingAlpha;
        blendLut.set(fadeFromLut);
        paletteLut = blendLut;
        fadeElapsed = 0;
        fadeDur = crossfadeMs / 1000;
        fadeActive = true;
      } else {
        fadeActive = false;
        paletteLut = next.lut;
        renderRingAlpha = next.effRingAlpha;
      }
    },

    getNormalization() {
      return { weight, effRingAlpha, effPastel };
    },

    updateOptions(partial) {
      if (destroyed || !partial) return;

      // Commit any in-flight palette crossfade to its target first (cancel the
      // fade, jump to the target LUT) so a re-derive never leaves the
      // half-blended scratch LUT in play. weight/effRingAlpha/effPastel already
      // describe that target (setPalette set them when the fade began).
      if (fadeActive) {
        fadeActive = false;
        paletteLut = fadeToLut;
        renderRingAlpha = fadeToRingAlpha;
      }

      // Geometry: re-derive, then reallocate the tile buffers and clear the
      // canvas — buffer sizes and the fade gradients all depend on the derived
      // RIM / BAND / CQ / TOP_FADE consts. An in-flight kindle is left active;
      // its perimeter re-derives naturally on the next frame from the new ARC.
      if (partial.geometry) {
        geo = { ...geo, ...partial.geometry };
        deriveGeometry();
        allocBuffers();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      // Input / motion: plain scalar re-derive under the same clamps as
      // creation (no buffers or LUT touched).
      if (partial.input) {
        inp = { ...inp, ...partial.input };
        deriveInput();
      }
      if (partial.motion) {
        mot = { ...mot, ...partial.motion };
        deriveMotion();
      }

      // Palette: validate incoming stops exactly like creation, remember any
      // explicit pins (they must keep winning across updates), then re-derive
      // the scalars, rebuild the LUT + normalization INSTANTLY, and re-apply
      // the mix-blend-mode. setPalette remains the only crossfading path.
      if (partial.palette) {
        if (partial.palette.stops !== undefined) validatePaletteStops(partial.palette.stops);
        if (partial.palette.normalizeTarget !== undefined) userSetNormalizeTarget = true;
        if (partial.palette.coreWhiten !== undefined) userSetCoreWhiten = true;
        pal = { ...pal, ...partial.palette };
        derivePalette();
        applyPalette();
        applyBlendMode();
      }
      // `seed` is intentionally ignored after creation — the noise phases are
      // fixed for the instance's lifetime.
    },

    resize() {
      const { w, h } = computeSize();
      canvas.width  = w;
      canvas.height = h;
      allocBuffers();
      ctx.clearRect(0, 0, w, h);
    },

    destroy() {
      destroyed = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Restore the inline style if we set a mix-blend-mode at creation.
      if (blendModeApplied && canvas.style) canvas.style.mixBlendMode = "";
    },
  };

  // Dev-only QA probes (not part of the public AuraEngine contract): introspect
  // and force the kindle reveal state so the env≡1 invariant can be proven with
  // phase-stable, same-instance, same-elapsed A/B captures via __auraEngine.
  //
  // The env check is inlined at the use site (never hoisted into a module
  // const): with the condition ending in the textual `process.env.NODE_ENV`
  // comparison, a bundler `define` of NODE_ENV="production" makes the whole
  // condition statically falsy, so minifiers drop this entire block from
  // production bundles. The `typeof` guard keeps it crash-safe in unbundled
  // browsers where `process` is undefined.
  if (
    typeof process !== "undefined" &&
    !!process.env &&
    process.env.NODE_ENV !== "production"
  ) {
    const probes = engine as unknown as {
      __kindleState: () => unknown;
      __setKindle: (active: boolean, front: number) => void;
    };
    probes.__kindleState = () => ({
      active: kindleActive, elapsed: kindleElapsed, s0: kindleS0,
      front: kindleFront, dur: KINDLE_DUR, soft: KINDLE_SOFT, perimeter,
    });
    probes.__setKindle = (active: boolean, front: number) => {
      kindleActive = active;
      kindleFront = front;
    };
  }

  return engine;
}
