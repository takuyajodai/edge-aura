/**
 * edge-aura — named palette presets.
 *
 * This module is the single source of truth for stop arrays: engine.ts
 * imports its default from here (NOT the other way around — palettes.ts
 * must never import engine.ts values, or we'd create an import cycle).
 *
 * Each preset is a full hue cycle sampled by arc position around the ring,
 * so the FIRST and LAST stop colors must be identical: the LUT is indexed
 * mod 1 and the ring is a closed loop — mismatched endpoints would show a
 * visible seam where the palette wraps.
 */

/** A palette stop: [position 0..1, [r, g, b]]. */
export type EdgeAuraPaletteStop = [number, [number, number, number]];

/** A full stop array (positions must start at 0 and end at 1). */
export type EdgeAuraPaletteStops = EdgeAuraPaletteStop[];

/** @deprecated Use {@link EdgeAuraPaletteStops}. Alias kept for 0.1.x consumers. */
export type PaletteStops = EdgeAuraPaletteStops;

export const EDGE_AURA_PALETTES = {
  /**
   * Organic mesh gradient — the engine's default. Non-uniform stop spacing
   * and a non-monotonic hue path (a warm knot around the midpoint dissolving
   * into a long cool exhale) so the ring reads as a hand-tuned mesh rather
   * than an evenly-stepped hue wheel.
   */
  opal: [
    [0,    [78,  104, 224]],
    [0.15, [66,  186, 200]],
    [0.30, [138, 120, 232]],
    [0.44, [232, 96,  168]],
    [0.50, [242, 116, 90 ]],
    [0.58, [230, 168, 74 ]],
    [0.86, [86,  196, 150]],
    [1.0,  [78,  104, 224]],
  ],
  /** Cool-tone aurora: green / white / ice blue only — no warm hues. */
  aurora: [
    [0,    [ 52, 211, 153]],  // emerald
    [0.18, [240, 255, 250]],  // near-white mint
    [0.36, [103, 232, 249]],  // ice cyan
    [0.52, [ 56, 189, 248]],  // sky blue
    [0.68, [245, 252, 255]],  // near-white ice
    [0.84, [110, 231, 183]],  // soft green
    [1.0,  [ 52, 211, 153]],  // loop back to emerald
  ],
  /** Warm dusk gradient — coral through gold into violet twilight. */
  sunset: [
    [0,    [255,  94,  98]],  // coral red
    [0.22, [255, 149,  84]],  // warm orange
    [0.42, [255, 200, 110]],  // golden
    [0.60, [233, 130, 175]],  // rose
    [0.80, [142,  92, 205]],  // violet dusk
    [1.0,  [255,  94,  98]],
  ],
  /** Marine blues — deep azure to turquoise, all cool water tones. */
  ocean: [
    [0,    [ 12, 116, 215]],  // deep azure
    [0.25, [  0, 168, 232]],  // bright blue
    [0.50, [ 64, 224, 208]],  // turquoise
    [0.72, [ 26, 188, 230]],  // cyan
    [1.0,  [ 12, 116, 215]],
  ],
  /** Cherry-blossom — sakura pinks alternating with near-white blush. */
  sakura: [
    [0,    [255, 183, 197]],  // sakura pink
    [0.30, [255, 228, 235]],  // near-white blush
    [0.55, [255, 143, 171]],  // coral pink
    [0.80, [255, 235, 240]],  // near-white
    [1.0,  [255, 183, 197]],
  ],
  /** Molten ember — deep crimson with a white-hot flare; dramatic on dark. */
  ember: [
    [0,    [186,  58,  60]],  // deep crimson base
    [0.25, [244,  96,  62]],  // scarlet
    [0.46, [255, 158,  96]],  // white-hot orange peak
    [0.55, [255, 204, 144]],  // flare crest
    [0.68, [232, 122,  82]],  // cooling amber
    [0.88, [164,  64,  82]],  // dark maroon exhale
    [1.0,  [186,  58,  60]],  // loop back to crimson
  ],
  /** Ultraviolet — electric violet on near-black; synthwave. */
  ultraviolet: [
    [0,    [112,  88, 192]],  // deep indigo base
    [0.28, [160, 104, 255]],  // electric violet
    [0.50, [204, 176, 255]],  // lilac flash
    [0.62, [168, 136, 252]],  // violet
    [0.80, [130,  98, 216]],  // deep indigo
    [1.0,  [112,  88, 192]],  // loop back to base
  ],
} satisfies Record<string, EdgeAuraPaletteStops>;

/** Union of preset names — keep in sync automatically via keyof. */
export type EdgeAuraPaletteName = keyof typeof EDGE_AURA_PALETTES;
