/**
 * edge-aura — organic screen-edge glow effect.
 *
 * Core entry point: framework-agnostic and server-safe (no React imports).
 * The React adapter lives at the separate import path "./react" so that
 * importing the engine never pulls React into a bundle.
 */
export {
  createAuraEngine,
  defineEdgeAuraOptions,
  EDGE_AURA_DEFAULTS,
  NORMALIZE_REF,
  NORMALIZE_REF_DARK,
  type AuraEngine,
  type EdgeAuraOptions,
  type EdgeAuraGeometryOptions,
  type EdgeAuraPaletteOptions,
  type EdgeAuraMotionOptions,
  type EdgeAuraInputOptions,
  type EdgeAuraPaletteStop,
  type EdgeAuraPaletteStops,
} from "./engine";

export {
  EDGE_AURA_PALETTES,
  // PaletteStops is a @deprecated alias of EdgeAuraPaletteStops.
  type PaletteStops,
  type EdgeAuraPaletteName,
} from "./palettes";

export {
  EDGE_AURA_PRESETS,
  type EdgeAuraPresetName,
} from "./presets";

export { keyCodeToPosition } from "./keyboard-map";
