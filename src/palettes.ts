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
export type EdgeAuraPaletteStop = [number, number[]];

/** A full stop array (positions must start at 0 and end at 1). */
export type PaletteStops = EdgeAuraPaletteStop[];

export const EDGE_AURA_PALETTES = {
  /** Stock Siri-style mesh gradient — the engine's default. */
  siri: [
    [0,    [33,  212, 154]],
    [0.12, [20,  212, 196]],
    [0.26, [56,  170, 255]],
    [0.40, [139, 92,  246]],
    [0.52, [236, 72,  153]],
    [0.63, [249, 115, 22 ]],
    [0.73, [251, 191, 36 ]],
    [0.85, [74,  222, 128]],
    [1.0,  [33,  212, 154]],
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
  /** Pastel confectionery — soft pinks, peach, lavender, baby blue. */
  candy: [
    [0,    [255, 175, 204]],  // baby pink
    [0.24, [255, 198, 173]],  // peach
    [0.48, [202, 182, 255]],  // lavender
    [0.74, [162, 197, 255]],  // baby blue
    [1.0,  [255, 175, 204]],
  ],
  /** Deep-space purples — indigo through violet and magenta to pink. */
  nebula: [
    [0,    [ 79,  70, 229]],  // indigo
    [0.25, [139,  92, 246]],  // violet
    [0.50, [217,  70, 239]],  // magenta
    [0.75, [236,  72, 153]],  // pink
    [1.0,  [ 79,  70, 229]],
  ],
  /** Cherry-blossom — sakura pinks alternating with near-white blush. */
  sakura: [
    [0,    [255, 183, 197]],  // sakura pink
    [0.30, [255, 228, 235]],  // near-white blush
    [0.55, [255, 143, 171]],  // coral pink
    [0.80, [255, 235, 240]],  // near-white
    [1.0,  [255, 183, 197]],
  ],
} satisfies Record<string, PaletteStops>;

/** Union of preset names — keep in sync automatically via keyof. */
export type EdgeAuraPaletteName = keyof typeof EDGE_AURA_PALETTES;

/**
 * The palette the EDIT MODE edge aura uses (components/editor/EditingAura.tsx).
 * The edit-entry entrance is now the engine's own "kindle" reveal of this very
 * ring, so the entrance and the steady glow draw from the SAME stops by
 * construction — there is no separate activation renderer to keep in sync.
 *
 * Default is the full "siri" rainbow spectrum (Apple-Intelligence look); swap
 * to "aurora" (cool green/ice) here for a calmer single-family glow.
 */
export const EDIT_AURA_PALETTE: EdgeAuraPaletteName = "siri";
