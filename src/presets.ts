/**
 * edge-aura — appearance presets.
 *
 * Each preset is a plain `EdgeAuraOptions` bundle built ONLY from public
 * options (no hidden engine knobs), so presets are starting points to
 * spread-and-override:
 *
 *   createAuraEngine(canvas, {
 *     ...EDGE_AURA_PRESETS.subtle,
 *     palette: { ...EDGE_AURA_PRESETS.subtle.palette, stops: EDGE_AURA_PALETTES.ocean },
 *   });
 *
 * This module must never import engine.ts VALUES (only types) — presets are
 * data, and keeping them value-independent avoids any load-order coupling.
 */

import type { EdgeAuraOptions } from "./engine";

export const EDGE_AURA_PRESETS = {
  /** Quieter presence: translucent, heavily pastelled, gentle input response. */
  subtle: {
    palette: { ringAlpha: 0.55, pastel: 0.5 },
    input: { tapEnergy: 0.5, keyEnergy: 0.55, savedPulseEnergy: 0.3, tapSigma: 90, keySigma: 70 },
  },
  /** Punchier: near-raw colors, fully opaque core (normalization off so alpha stays 1.0), bigger input swells, wider band. */
  vivid: {
    geometry: { band: 88 },
    // normalize: false is deliberate — with it on, the default target would
    // scale the low-pastel (heavy) LUT's alpha DOWN below the stock 0.9,
    // making "vivid" visibly MORE translucent than the default.
    palette: { pastel: 0.12, ringAlpha: 1.0, normalize: false },
    input: { tapEnergy: 1.1, keyEnergy: 1.2 },
  },
  /** Slow ambient drift that barely reacts to input — a living picture frame. */
  calm: {
    motion: { rotateIdleS: 14, rotateTypingS: 6, decay: 0.7 },
    input: { tapEnergy: 0.35, keyEnergy: 0.4, savedPulseEnergy: 0.2 },
  },
  /** Delicate thin line: shallow band, tight inner dissolve, steadier core width. */
  thin: {
    geometry: { band: 44, innerSigmaMax: 9, coreSigmaVar: 0.25 },
  },
} satisfies Record<string, EdgeAuraOptions>;

/** Union of appearance-preset names — stays in sync via keyof. */
export type EdgeAuraPresetName = keyof typeof EDGE_AURA_PRESETS;
