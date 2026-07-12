// @vitest-environment node
/**
 * Engine behavior tests against the stub-canvas harness. Everything imports
 * from ../src/index (the public server-safe entry) — vitest resolves the TS
 * sources directly, so these tests exercise exactly what ships.
 */
import { describe, expect, it } from "vitest";
import {
  bytesEqual,
  captureBuffers,
  captureFrame,
  installStubDom,
  newCanvas,
  sha256Hex,
} from "./harness";

installStubDom();

import {
  createAuraEngine,
  EDGE_AURA_DEFAULTS,
  EDGE_AURA_PALETTES,
  EDGE_AURA_PRESETS,
  NORMALIZE_REF,
  NORMALIZE_REF_DARK,
  type EdgeAuraOptions,
  type EdgeAuraPaletteStops,
} from "../src/index";

const mk = (options?: EdgeAuraOptions) => createAuraEngine(newCanvas(), options);

// Geometry constants the corner tests reason about (defaults; the engine
// derives the same RIM = INSET + CR from these). CQ (corner-buffer size) = RIM.
const INSET = EDGE_AURA_DEFAULTS.geometry.inset;
const CR = EDGE_AURA_DEFAULTS.geometry.cornerRadius;
const RIM = INSET + CR;

/** Alpha byte at flat pixel index `i` (RGBA) of a tile buffer. */
const alphaAt = (buf: Uint8ClampedArray, i: number): number => buf[i * 4 + 3];

// captureBuffers draw order is fixed: 4 strips then 4 corners —
// [top, bottom, left, right, TL, TR, BR, BL].
const TILE = { top: 0, bottom: 1, left: 2, right: 3, TL: 4, TR: 5, BR: 6, BL: 7 } as const;

// Local arc-center (bufferX, bufferY) of each corner tile, in the same
// clockwise TL/TR/BR/BL order captureBuffers emits them. A corner pixel's
// radial distance to this point is CR at the centerline; the outward feather
// rounds the glow off past CR + INSET + CORNER_FEATHER_PX.
const CORNER_CENTERS: Record<number, [number, number]> = {
  [TILE.TL]: [RIM, RIM],
  [TILE.TR]: [0, RIM],
  [TILE.BR]: [0, 0],
  [TILE.BL]: [RIM, 0],
};

describe("seed determinism", () => {
  it("renders identical bytes for two engines with the same seed", () => {
    const a = mk({ seed: 42 });
    const b = mk({ seed: 42 });
    a.step(16);
    b.step(16);
    const fa = captureFrame(a);
    expect(fa.some((v) => v !== 0)).toBe(true); // non-vacuous comparison
    expect(bytesEqual(fa, captureFrame(b))).toBe(true);
  });

  it("renders different bytes for different seeds", () => {
    const a = mk({ seed: 42 });
    const b = mk({ seed: 43 });
    a.step(16);
    b.step(16);
    expect(bytesEqual(captureFrame(a), captureFrame(b))).toBe(false);
  });

  it("accepts seed 0 as a valid deterministic seed", () => {
    const a = mk({ seed: 0 });
    const b = mk({ seed: 0 });
    a.step(16);
    b.step(16);
    const fa = captureFrame(a);
    expect(fa.some((v) => v !== 0)).toBe(true);
    expect(bytesEqual(fa, captureFrame(b))).toBe(true);
  });
});

describe("palette validation", () => {
  it("throws an edge-aura-prefixed error for a single-stop palette", () => {
    expect(() =>
      mk({ palette: { stops: [[0, [1, 2, 3]]] as EdgeAuraPaletteStops } }),
    ).toThrowError(/^edge-aura:/);
  });

  it("throws when the first stop position is not 0", () => {
    const stops: EdgeAuraPaletteStops = [
      [0.1, [10, 20, 30]],
      [1, [10, 20, 30]],
    ];
    expect(() => mk({ palette: { stops } })).toThrowError(/^edge-aura:/);
  });

  it("accepts every appearance preset and renders non-zero pixels", () => {
    for (const preset of Object.values(EDGE_AURA_PRESETS)) {
      const engine = mk({ ...preset, seed: 1 });
      engine.step(16);
      const frame = captureFrame(engine);
      expect(frame.some((v) => v !== 0)).toBe(true);
    }
  });

  it("clamps rotateIdleS 0 and still renders NaN-free non-zero pixels", () => {
    const engine = mk({ seed: 5, motion: { rotateIdleS: 0 } });
    engine.step(16);
    engine.step(16);
    const frame = captureFrame(engine);
    expect(frame.some((v) => v !== 0)).toBe(true);
    expect(frame.every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe("palette preset smoke (every named palette, both backgrounds)", () => {
  // Every EDGE_AURA_PALETTES entry — including the heavy/dark ember and
  // ultraviolet — must render NaN-free, non-zero, never-over-opaque pixels and
  // resolve a sane normalization on both backgrounds: alpha strictly inside the
  // clamp band (0, 1], pastel within [0, 0.35], and a positive finite weight.
  for (const [name, stops] of Object.entries(EDGE_AURA_PALETTES) as [
    string,
    EdgeAuraPaletteStops,
  ][]) {
    it.each(["light", "dark"] as const)(`${name} on %s`, (background) => {
      const engine = mk({ seed: 42, palette: { stops, background } });
      const norm = engine.getNormalization();
      engine.step(16.7);
      engine.step(16.7);
      const frame = captureFrame(engine);

      expect(frame.some((v) => v !== 0)).toBe(true); // renders something
      expect(frame.every((v) => Number.isFinite(v))).toBe(true); // NaN-free
      expect(frame.every((v) => v <= 255)).toBe(true); // never over-opaque

      expect(Number.isFinite(norm.weight)).toBe(true);
      expect(norm.weight).toBeGreaterThan(0);
      expect(norm.effRingAlpha).toBeGreaterThan(0);
      expect(norm.effRingAlpha).toBeLessThanOrEqual(1);
      expect(norm.effPastel).toBeGreaterThanOrEqual(0);
      expect(norm.effPastel).toBeLessThanOrEqual(0.35);
    });
  }
});

describe("dt guard", () => {
  it("treats negative and NaN dt as 0 — a later normal step still renders", () => {
    const guarded = mk({ seed: 9 });
    guarded.step(-100);
    guarded.step(Number.NaN);
    guarded.step(16);

    // Same seed, only the valid step: garbage dt must have advanced nothing.
    const clean = mk({ seed: 9 });
    clean.step(16);

    const frame = captureFrame(guarded);
    expect(frame.some((v) => v !== 0)).toBe(true);
    expect(bytesEqual(frame, captureFrame(clean))).toBe(true);
  });
});

describe("destroy", () => {
  it("makes step/render/renderStatic/setPalette no-ops", () => {
    const engine = mk({ seed: 3 });
    engine.step(16);
    engine.destroy();
    expect(() => {
      engine.step(16);
      engine.render();
      engine.renderStatic();
      engine.setPalette("ocean");
      engine.destroy(); // idempotent
    }).not.toThrow();
    expect(captureBuffers(engine)).toHaveLength(0); // render draws nothing
  });
});

describe("input API", () => {
  it("key has arity 1 and key(0.5) changes subsequent frames", () => {
    const withKey = mk({ seed: 11 });
    expect(withKey.key.length).toBe(1);
    withKey.key(0.5);
    withKey.step(50);
    withKey.step(50);

    const without = mk({ seed: 11 });
    without.step(50);
    without.step(50);

    expect(bytesEqual(captureFrame(withKey), captureFrame(without))).toBe(false);
  });

  it.each([
    ["pulse()", (e: ReturnType<typeof mk>) => e.pulse()],
    ["pulse(0.3)", (e: ReturnType<typeof mk>) => e.pulse(0.3)],
    ["savedPulse()", (e: ReturnType<typeof mk>) => e.savedPulse()],
  ])("%s injects energy that changes subsequent frames", (_name, fire) => {
    const pulsed = mk({ seed: 13 });
    fire(pulsed);
    pulsed.step(50);
    pulsed.step(50);

    const idle = mk({ seed: 13 });
    idle.step(50);
    idle.step(50);

    expect(bytesEqual(captureFrame(pulsed), captureFrame(idle))).toBe(false);
  });
});

describe("setPalette", () => {
  it("instant swap changes bytes and equals direct-create with the new stops", () => {
    const engine = mk({ seed: 42 });
    engine.step(16);
    engine.step(16);
    const before = captureFrame(engine);
    engine.setPalette("ocean");
    const after = captureFrame(engine);
    expect(bytesEqual(before, after)).toBe(false);

    const direct = mk({ seed: 42, palette: { stops: EDGE_AURA_PALETTES.ocean } });
    direct.step(16);
    direct.step(16);
    expect(bytesEqual(after, captureFrame(direct))).toBe(true);
  });

  it("crossfade: no pop at f=0, midpoint differs from both endpoints, end equals direct-create", () => {
    const engine = mk({ seed: 7 });
    engine.step(16);
    const startFrame = captureFrame(engine);
    engine.setPalette("ember", { crossfadeMs: 400 });
    // No step yet — the blend origin is an exact snapshot of the old LUT.
    expect(bytesEqual(captureFrame(engine), startFrame)).toBe(true);

    for (let i = 0; i < 12; i++) engine.step(16); // 192 ms ≈ midpoint of 400
    const mid = captureFrame(engine);
    for (let i = 0; i < 15; i++) engine.step(16); // 432 ms total — past the end
    const end = captureFrame(engine);
    expect(bytesEqual(mid, startFrame)).toBe(false);
    expect(bytesEqual(mid, end)).toBe(false);

    // Same seed + same total elapsed → identical steady output by contract.
    const direct = mk({ seed: 7, palette: { stops: EDGE_AURA_PALETTES.ember } });
    for (let i = 0; i < 28; i++) direct.step(16);
    expect(bytesEqual(end, captureFrame(direct))).toBe(true);
  });

  it("throws edge-aura-prefixed errors for garbage stops and unknown preset names", () => {
    const engine = mk();
    expect(() =>
      engine.setPalette([[0, [1, 2, 3]]] as EdgeAuraPaletteStops),
    ).toThrowError(/^edge-aura:/);
    expect(() =>
      engine.setPalette("nope" as unknown as "ocean"),
    ).toThrowError(/^edge-aura:/);
  });
});

describe("background normalization", () => {
  it('background "dark" changes effRingAlpha vs "light" for a light palette (sakura)', () => {
    const light = mk({ palette: { stops: EDGE_AURA_PALETTES.sakura } }).getNormalization();
    const dark = mk({
      palette: { stops: EDGE_AURA_PALETTES.sakura, background: "dark" },
    }).getNormalization();
    expect(dark.effRingAlpha).not.toBe(light.effRingAlpha);
  });

  it("keeps the stock opal palette at scale exactly 1 on both backgrounds", () => {
    const light = mk().getNormalization();
    const dark = mk({ palette: { background: "dark" } }).getNormalization();
    expect(light.weight).toBe(NORMALIZE_REF);
    expect(dark.weight).toBe(NORMALIZE_REF_DARK);
    expect(light.effRingAlpha).toBeCloseTo(0.9, 12);
    expect(dark.effRingAlpha).toBeCloseTo(0.9, 12);
  });

  it("lets an explicit normalizeTarget win over the dark-background default", () => {
    const pinned = mk({
      palette: { background: "dark", normalizeTarget: NORMALIZE_REF_DARK * 2 },
    }).getNormalization();
    expect(pinned.effRingAlpha).not.toBeCloseTo(0.9, 12);
  });

  it("opal + dark default resolves the DARK reference target — scale exactly 1", () => {
    // Regression: on a dark page the default normalizeTarget must be
    // NORMALIZE_REF_DARK, not the light NORMALIZE_REF. With the light reference
    // the scale would collapse to ~0.37 and effRingAlpha would clamp to the
    // 0.45 dark floor (the ring renders at half its intended alpha). The dark
    // reference makes alphaScale exactly 1 → effRingAlpha 0.9.
    const dark = mk({ palette: { background: "dark" } }).getNormalization();
    expect(dark.weight).toBe(NORMALIZE_REF_DARK);
    expect(dark.effRingAlpha).toBe(0.9); // scale exactly 1, not the 0.45 floor
  });

  it("re-resolves the DEFAULT target when background flips light→dark via updateOptions", () => {
    // The default target must track the background across a live flip, not stay
    // pinned to the creation-time light reference.
    const engine = mk();
    expect(engine.getNormalization().weight).toBe(NORMALIZE_REF);
    engine.updateOptions({ palette: { background: "dark" } });
    const after = engine.getNormalization();
    expect(after.weight).toBe(NORMALIZE_REF_DARK);
    expect(after.effRingAlpha).toBe(0.9); // dark reference → scale 1
    // Equals a fresh dark-created instance.
    const fresh = mk({ palette: { background: "dark" } }).getNormalization();
    expect(after.effRingAlpha).toBe(fresh.effRingAlpha);
  });

  it("keeps an explicit user normalizeTarget across a background flip", () => {
    // A user-set target must keep winning over the background-derived default
    // through updateOptions — the light→dark flip must NOT overwrite it.
    const target = NORMALIZE_REF; // deliberately the light reference
    const engine = mk({ palette: { normalizeTarget: target } });
    engine.updateOptions({ palette: { background: "dark" } });
    const after = engine.getNormalization();
    // Effective alpha derives from the pinned light target against the dark
    // weight — NOT the 0.9 the dark default would give.
    const pinnedRef = mk({
      palette: { background: "dark", normalizeTarget: target },
    }).getNormalization();
    expect(after.effRingAlpha).toBe(pinnedRef.effRingAlpha);
    expect(after.effRingAlpha).not.toBe(0.9);
  });

  it('never runs the pastel step-down under the dark metric (ember + "dark" keeps effPastel 0.35)', () => {
    // Regression: the step-down loop lowers pastel to DARKEN colors, which
    // only converges under the light metric. Under the dark metric it would
    // diverge (each step lowers weight, growing alphaScale) and crush the
    // user's pastel to 0 — a heavy palette on "dark" must keep it untouched
    // and rely on the alpha clamp alone.
    const dark = mk({
      palette: { stops: EDGE_AURA_PALETTES.ember, background: "dark" },
    }).getNormalization();
    expect(dark.effPastel).toBe(0.35);
    expect(dark.effRingAlpha).toBeLessThanOrEqual(1.0);
  });
});

describe("getNormalization coherence", () => {
  it("reports the configured defaults for the stock palette", () => {
    const norm = mk().getNormalization();
    expect(norm.weight).toBe(NORMALIZE_REF);
    expect(norm.effRingAlpha).toBeCloseTo(0.9, 12);
    expect(norm.effPastel).toBeCloseTo(0.35, 12);
  });

  it("reflects the target palette as soon as a crossfade starts", () => {
    const engine = mk();
    const before = engine.getNormalization();
    engine.setPalette(EDGE_AURA_PALETTES.sakura, { crossfadeMs: 1000 });
    const during = engine.getNormalization();
    expect(
      during.effRingAlpha !== before.effRingAlpha || during.weight !== before.weight,
    ).toBe(true);
  });
});

describe("pixel snapshot", () => {
  /**
   * sha256 of the concatenated 8 tile buffers for `{ seed: 42 }` default
   * options after the fixed sequence below (30 frames of step(16.7) + render,
   * tap at frame 10, key(0.5) at frame 15, 800×600 stub viewport).
   *
   * Regenerated for v0.3: the default palette is now `opal` (was `siri`), the
   * corner tiles round off with the outward feather (was flat-filled to the
   * square viewport corner), and the default `hueDriftDeg` (10°) hue
   * oscillation shifts the palette sample every frame. All three fold into
   * this one hash.
   *
   * Regenerated again for the corner-continuity seam fix: strip columns near
   * the corners and the corner tiles now converge to a shared per-corner
   * arc-midpoint noise profile (mid-edge columns stay byte-identical),
   * removing the bloom-amplitude step along the 45° corner-ownership
   * diagonals and at the TL tile boundary (the s = 0 noise wrap).
   *
   * Regenerated for v0.3.1: the corner-continuity blend moved from a
   * whole-column freeze (which read as a flat "interference" band near corners
   * at large band) to a DEPTH crossfade — near-corner columns keep their own
   * live noise at shallow depths and only converge to the shared corner profile
   * at the deep diagonal-cut depth. This changes light pixels near the four
   * corners; mid-edge columns remain byte-identical.
   *
   * Regenerated for v0.4: four fold in. (1) The spatial noise field is now
   * PERIODIC in the ring — every stream's spatial phase is an integer harmonic
   * of the ring angle θ = 2π·s/perimeter, so the undulation flows continuously
   * around the ring and is byte-identical across the s = 0 / perimeter closure.
   * (2) The corner TILE renders that field LIVE per pixel again (no frozen
   * arc-midpoint snapshot), and the strip diagonal crossfade is now deep-only
   * (6-px window, no shallow tile-adjacency lift) — the near-corner pixels move.
   * (3) The inner dissolve window is smoothstep(1 − x⁴) (C1, zero slope at the
   * band edge) instead of the bare 1 − x⁴. (4) Mean-preserving ordered Bayer
   * alpha dithering (offset in [0,1), floored) is added at quantization. All
   * four move the default pixels by design.
   *
   * Regenerated again for the v0.4 corner perf pass: the corner tile no longer
   * evaluates the 15-sin neonAt per pixel — it samples the SAME live periodic
   * field at CORNER_ARC_SAMPLES points along the quarter arc and each pixel
   * reuses the nearest sample across its radial depth (the strip discipline,
   * for a curved path). The arc endpoints stay exact samples (tile↔strip
   * boundaries unchanged), so only corner-interior pixels shift by the
   * sub-LSB sample-quantization. Byte-identical reorders in the same pass
   * (hoisting TWO_PI/perimeter and the Bayer load out of the hot loops) leave
   * the pixels otherwise unchanged.
   *
   * Regenerated for v0.4.2 — the MULTI-SOURCE ADDITIVE corner light model. The
   * round corners (tiles + near-corner strip columns) now combine the arc and
   * both adjacent straights by the p=3 norm instead of the single nearest source
   * + deep depth-crossfade; only corner-neighbourhood pixels move (the mid-edge
   * is bit-identical — see the mid-edge span reference test).
   *
   * Regenerated for the explicit S3 concentration ceiling: the additive combined
   * coverage is now held to min(p3norm, dominantBranch · S3_MAX_GAIN) before the
   * intensity/dark-gamma stages, capping the multi-source pile that breached the
   * S3 +40 % bend-interior ceiling on thin bands. ONLY genuinely multi-branch
   * corner pixels move (a single-branch pixel's p3norm already equals its
   * coverage, and dom·gain ≥ it, so min is a no-op) — the mid-edge span reference
   * test stays bit-identical, verifying the ceiling never leaked into the straights.
   *
   * To regenerate after an INTENTIONAL default-appearance change: run this
   * test, copy the "received" hash from the failure output, and update the
   * constant. Any unintentional mismatch is a pixel regression in the default
   * rendering path.
   */
  const SNAPSHOT_SHA256 =
    "5ad60de921b041f378061f826a87e3db34b07752b7d87f6b200caf7f5e40786e";

  it("matches the golden hash for the fixed 30-frame sequence", () => {
    const engine = mk({ seed: 42 });
    let final: Uint8ClampedArray = new Uint8ClampedArray(0);
    for (let frame = 0; frame < 30; frame++) {
      engine.step(16.7);
      if (frame === 10) engine.tap({ x: 200, y: 300 });
      if (frame === 15) engine.key(0.5);
      final = captureFrame(engine);
    }
    expect(final.some((v) => v !== 0)).toBe(true);
    expect(sha256Hex(final)).toBe(SNAPSHOT_SHA256);
  });
});

describe("dark pixel snapshot", () => {
  /**
   * Dark-background golden: same fixed 30-frame sequence as the light snapshot
   * but with `{ seed: 42, palette: { background: "dark" } }`, so it locks the
   * whole dark pipeline (darkAlphaGamma response curve, darkChroma Oklab lift,
   * the raised dark ring-alpha floor, dark coreWhiten default) into one hash.
   * Regenerate exactly like the light snapshot: run, copy the received hash.
   * (Regenerated with the light snapshot for the corner-continuity seam fix —
   * the defect this fix removes was dark-visible: darkAlphaGamma amplified
   * the bloom step across the corner diagonals.)
   *
   * Regenerated for v0.3.1: two dark-only default bumps (coreWhiten 0.32 → 0.35,
   * darkChroma 1.15 → 1.25) plus the corner depth-crossfade (see the light
   * snapshot note) all fold into this hash.
   *
   * Regenerated for v0.4 with the light snapshot: periodic ring noise, the live
   * corner tile + deep-only diagonal crossfade, the smoothstep(1 − x⁴) inner
   * window, and mean-preserving ordered Bayer alpha dithering. The dither is
   * especially visible here — the darkAlphaGamma response amplifies the faint
   * tail, so breaking its 1/255 contours is exactly the dark-mode win.
   *
   * Regenerated again with the light snapshot for the corner arc-sample perf
   * pass (see the light note): only corner-interior pixels shift by the sub-LSB
   * arc-sample quantization; the rest of the pipeline is a byte-identical reorder.
   *
   * Regenerated for v0.4 item 2 (dark terminus cliff): the darkAlphaLut is now
   * indexed at 4096 input levels instead of 256 — the coverage is quantized
   * finely BEFORE pow(gamma), so the smallest nonzero dark alpha drops from
   * ~12/255 to ~2.6/255 and the inner-edge terminus no longer ends in an
   * ~11/255 stippled cliff. DARK-ONLY: the light snapshot is unchanged. The
   * response CURVE is identical (same pow), only its input resolution is finer,
   * so mid-tail values move ≤ 1/255 and only the faint terminus visibly shifts.
   */
  // Regenerated for v0.4.2 alongside the light snapshot (multi-source additive
  // round corners, p=3 norm). Dark-visible: the darkAlphaGamma response makes
  // the bend-interior concentration and the seamless diagonal most apparent.
  // Regenerated again for the explicit S3 concentration ceiling (see the light
  // snapshot note) — the dark-gamma response makes the capped pile most visible.
  const DARK_SNAPSHOT_SHA256 =
    "37ee247f45c1ef54900835e062fccb834985010026ebb4536bc0188adfcf2769";

  it("matches the golden hash for the fixed dark 30-frame sequence", () => {
    const engine = mk({ seed: 42, palette: { background: "dark" } });
    let final: Uint8ClampedArray = new Uint8ClampedArray(0);
    for (let frame = 0; frame < 30; frame++) {
      engine.step(16.7);
      if (frame === 10) engine.tap({ x: 200, y: 300 });
      if (frame === 15) engine.key(0.5);
      final = captureFrame(engine);
    }
    expect(final.some((v) => v !== 0)).toBe(true);
    expect(sha256Hex(final)).toBe(DARK_SNAPSHOT_SHA256);
  });
});

describe("corner rounding", () => {
  // The four corner tiles are the last four buffers captureBuffers records.
  const cornerTiles = (engine: ReturnType<typeof mk>) =>
    captureBuffers(engine).slice(4);

  it("writes nothing beyond the outward feather (radialDist > CR + INSET + 2)", () => {
    const engine = mk({ seed: 42 });
    engine.step(16);
    const corners = captureBuffers(engine);
    for (const idx of [TILE.TL, TILE.TR, TILE.BR, TILE.BL]) {
      const buf = corners[idx];
      const [cx, cy] = CORNER_CENTERS[idx];
      for (let ly = 0; ly < RIM; ly++) {
        for (let lx = 0; lx < RIM; lx++) {
          const radialDist = Math.hypot(lx + 0.5 - cx, ly + 0.5 - cy);
          if (radialDist > CR + INSET + 2) {
            // Past the 1.5px feather (+0.5px pixel-center margin): fully rounded
            // off, so the square viewport-corner region must be transparent.
            expect(alphaAt(buf, ly * RIM + lx)).toBe(0);
          }
        }
      }
    }
  });

  it("feathers monotonically to zero along the TL corner diagonal", () => {
    // The TL arc center sits at the buffer's bottom-right (RIM, RIM); walking
    // the diagonal outward toward the screen corner (k = RIM-1 → 0) increases
    // radial distance at a fixed arc fraction, so np is constant and only the
    // outward feather varies — alpha must be non-increasing and reach 0.
    const engine = mk({ seed: 42 });
    engine.step(16);
    const tl = cornerTiles(engine)[0]; // TILE.TL is the first corner
    // Sample the outward half of the diagonal (k = 0..5): k=5 sits just past
    // the arc (still fully lit), k=0 is the screen corner (fully faded).
    const alphas: number[] = [];
    for (let k = 5; k >= 0; k--) alphas.push(alphaAt(tl, k * RIM + k));
    expect(alphas[0]).toBeGreaterThan(0); // lit just outside the arc
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1]); // non-increasing
    }
    expect(alphas[alphas.length - 1]).toBe(0); // transparent at the corner tip
  });

  it("keeps every corner pixel NaN-free and never over-opaque", () => {
    const engine = mk({ seed: 42, palette: { background: "dark" } });
    engine.step(16);
    for (const buf of cornerTiles(engine)) {
      expect(buf.every((v) => Number.isFinite(v))).toBe(true);
      expect(buf.every((v) => v <= 255)).toBe(true);
    }
  });
});

describe("corner fill (opt-in): crisp band-union fill", () => {
  // v0.6 — the CRISP BAND-UNION FILL. cornerFill v4 (and the v0.5.1 radial-pocket
  // scaling that preceded it) was REJECTED: it lit the pocket by RADIAL distance
  // from the arc, so at equal depth the corner's diagonal interior was far dimmer
  // than the adjacent straight bands and the two bands' inner contours carved a
  // DARK RECTANGLE where they met (worst at cornerRadius 0). The fix renders the
  // corner as the UNION of its two adjacent straight bands: the additive combine
  // of {h-branch at depth ay, v-branch at depth ax, arc at the rounded-path
  // distance} is ≥ the dominant branch = the band at effective depth
  // min(ax, ay, d_rounded) = min(d_L, d_rounded), so the corner is NEVER darker
  // than either band at equal depth. The outward pocket renders SOLID (each
  // branch clamps its outward side to the flat centerline value — no radial decay,
  // no per-size sigma floor) out to the physical corner tip, while the inner
  // dissolve follows the rounded arc near the bend (d_rounded < d_L) and squares
  // off to the band union deeper — "outer corner radius 0, inner radius CR".
  //
  // These tests assert THE INVARIANT (corner ≥ band at equal effective depth) as a
  // 2D scan over the whole corner quadrant across the geometry matrix, the two
  // named user-exposing cases, the light background, pocket solidity to the tip,
  // core-bend + inner-contour rounding preservation, and seam continuity — plus
  // the round-mode identity + live-toggle behaviour. Stub viewport 800×600.
  const W = 800, H = 600;
  const CORNERS = [TILE.TL, TILE.TR, TILE.BR, TILE.BL];
  const ORIGIN: Record<number, [number, number]> = {
    [TILE.TL]: [0, 0], [TILE.TR]: [W - RIM, 0], [TILE.BR]: [W - RIM, H - RIM], [TILE.BL]: [0, H - RIM],
  };

  // Fixed 12-frame settle (hueDrift off), returning the 8 tiles for a geometry.
  const settleTiles = (opts: EdgeAuraOptions, N = 12): Uint8ClampedArray[] => {
    const e = mk({ seed: 42, palette: { background: "dark" }, motion: { hueDriftDeg: 0 }, ...opts });
    let bufs: Uint8ClampedArray[] = [];
    for (let f = 0; f < N; f++) { e.step(16.7); bufs = captureBuffers(e); }
    return bufs;
  };

  // DECORRELATED frame-average → a pure-geometry alpha grid. The ring's slow
  // organic brightness noise (±30–40 % ALONG the ring) is what makes any positional
  // band reference at a DIFFERENT ring position drift; the INVARIANT is a geometric
  // property (holds by construction — additive ≥ dominant branch), so we cancel the
  // noise to test it. Consecutive 16.7 ms frames span far less than the slow octave
  // period (~11–17 s), so plain 40-frame averaging (S3's) barely dents it; instead
  // we take N samples spaced `gap` × 50 ms apart (the step dt clamp), spanning
  // ~N·gap·50 ms ≈ 33 s ≈ 3 periods, so the noise integrates to its mean with only
  // N renders. (Verified: the near-corner and a clean mid-edge column converge to
  // the same profile as N grows — the residual is noise, not a dark corner.)
  const avgTiles = (opts: EdgeAuraOptions, N = 20, gap = 33): Float64Array[] => {
    const e = mk({ seed: 42, palette: { background: "dark" }, motion: { hueDriftDeg: 0 }, ...opts });
    for (let f = 0; f < 8; f++) e.step(50);
    let acc: Float64Array[] | null = null;
    for (let f = 0; f < N; f++) {
      for (let g = 0; g < gap; g++) e.step(50);
      const bufs = captureBuffers(e);
      if (!acc) acc = bufs.map((b) => new Float64Array(b.length));
      for (let t = 0; t < bufs.length; t++) for (let i = 0; i < bufs[t].length; i++) acc[t][i] += bufs[t][i];
    }
    for (const a of acc!) for (let i = 0; i < a.length; i++) a[i] /= N;
    return acc!;
  };

  // Source-over composite of the 8 disjoint tiles into a W×H alpha grid (a=0 never
  // overwrites — matches drawImage), so the tile + near-corner strip triangles
  // share one coordinate space. Works for Uint8ClampedArray or Float64Array tiles.
  const compositeAlpha = (bufs: ReadonlyArray<ArrayLike<number>>, band: number, rim: number): Float64Array => {
    const G = new Float64Array(W * H);
    const put = (buf: ArrayLike<number>, bw: number, bh: number, ox: number, oy: number) => {
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const bi = (y * bw + x) * 4;
        if (buf[bi + 3] === 0) continue;
        G[(oy + y) * W + (ox + x)] = buf[bi + 3];
      }
    };
    const topW = W - 2 * rim, leftH = H - 2 * rim;
    put(bufs[0], topW, band, rim, 0); put(bufs[1], topW, band, rim, H - band);
    put(bufs[2], band, leftH, 0, rim); put(bufs[3], band, leftH, W - band, rim);
    put(bufs[4], rim, rim, 0, 0); put(bufs[5], rim, rim, W - rim, 0);
    put(bufs[6], rim, rim, W - rim, H - rim); put(bufs[7], rim, rim, 0, H - rim);
    return G;
  };
  const bil = (G: Float64Array, x: number, y: number): number => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const g = (a: number, b: number) => G[b * W + a];
    return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) +
           (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy;
  };

  // Corner-local → global: (u, v) = px from the physical screen corner along the
  // two adjacent edges (across, then down for TL). One mapping per corner.
  const cmap = [
    (u: number, v: number): [number, number] => [u, v],                 // TL
    (u: number, v: number): [number, number] => [W - 1 - u, v],         // TR
    (u: number, v: number): [number, number] => [W - 1 - u, H - 1 - v], // BR
    (u: number, v: number): [number, number] => [u, H - 1 - v],         // BL
  ];

  // The INVARIANT scan. For every pixel of every corner quadrant, compute the
  // effective depth d = min(ax, ay) (perpendicular inward distances from the two
  // adjacent centerlines) and compare the corner's alpha to the BAND at depth d on
  // the RESPONSIBLE (min-axis) edge — the mid-edge reference, sampled from the
  // nearest CLEAN single-source strip column of that same corner+edge (off ≈ the
  // additive-neighbourhood width). Returns the worst deficit (band − corner) in
  // the LIT region (band ≥ 24/255 — where a dark rectangle is perceptible) and over
  // the FULL quadrant. The lit deficit is the real invariant; the full deficit's
  // extra headroom is the faint inner terminus, where the additive p3-norm LUT
  // floors sub-ε coverage ~1 step before a mid-edge band — a <8/255 effect in a
  // <24/255 region, not a dark rectangle.
  const invariantDeficit = (G: Float64Array, inset: number, cr: number, band: number) => {
    const rim = inset + cr;
    const off = Math.max(band, rim) + 3; // nearest clean single-source column, along-edge
    const bandAt = (k: number, edge: 0 | 1, d: number): number => {
      const [gx, gy] = edge === 0 ? cmap[k](off, d) : cmap[k](d, off);
      return G[Math.round(gy) * W + Math.round(gx)];
    };
    const bandDepth = (k: number, edge: 0 | 1, de: number): number => {
      if (de <= 0) return bandAt(k, edge, 0);
      const d0 = Math.floor(de), f = de - d0;
      return bandAt(k, edge, Math.min(band - 1, d0)) * (1 - f) + bandAt(k, edge, Math.min(band - 1, d0 + 1)) * f;
    };
    const reach = Math.min(band - 1, 55), lim = rim + reach;
    let lit = 0, full = 0;
    for (let v = 0; v < lim; v++) for (let u = 0; u < lim; u++) {
      const au = u + 0.5 - inset, av = v + 0.5 - inset;
      const dEff = Math.min(au, av);
      const edge: 0 | 1 = av <= au ? 0 : 1; // 0 = horizontal edge (depth av), 1 = vertical (depth au)
      const de = inset + Math.max(0, dEff);
      for (let k = 0; k < 4; k++) {
        const [gx, gy] = cmap[k](u, v);
        const cv = G[gy * W + gx], bv = bandDepth(k, edge, de);
        const def = bv - cv;
        if (bv >= 24 && def > lit) lit = def;
        if (def > full) full = def;
      }
    }
    return { lit, full };
  };

  // ---- round-mode identity + basic toggle ----------------------------------
  it("default off is byte-identical to omitting the option (light and dark)", () => {
    for (const bg of ["light", "dark"] as const) {
      const omit = mk({ seed: 42, palette: { background: bg } });
      const off = mk({ seed: 42, palette: { background: bg }, geometry: { cornerFill: false } });
      omit.step(16.7); off.step(16.7);
      expect(bytesEqual(captureFrame(omit), captureFrame(off))).toBe(true);
    }
  });

  it("on: lights the physical corner tip where off leaves it transparent (all corners)", () => {
    const off = settleTiles({ geometry: { cornerFill: false } });
    const on = settleTiles({ geometry: { cornerFill: true } });
    for (const kind of CORNERS) {
      const [ox, oy] = ORIGIN[kind];
      const tx = ox === 0 ? 0 : RIM - 1;
      const ty = oy === 0 ? 0 : RIM - 1;
      expect(off[kind][(ty * RIM + tx) * 4 + 3]).toBe(0);      // rounded off in round mode
      expect(on[kind][(ty * RIM + tx) * 4 + 3]).toBeGreaterThan(0); // lit in fill mode
    }
  });

  // ---- (a) THE INVARIANT over the full geometry matrix (CR = 0 included) ----
  const insets = [3, 8, 12], crs = [0, 16, 32, 40], bands = [34, 76, 120];
  const matrix: Array<[number, number, number]> = [];
  for (const inset of insets) for (const cr of crs) for (const band of bands) matrix.push([inset, cr, band]);
  it.each(matrix)(
    "INVARIANT: corner ≥ band at equal depth — inset %i / CR %i / band %i (dark)",
    (inset, cr, band) => {
      const G = compositeAlpha(avgTiles({ geometry: { inset, cornerRadius: cr, band, cornerFill: true } }), band, inset + cr);
      const { lit, full } = invariantDeficit(G, inset, cr, band);
      expect(lit).toBeLessThanOrEqual(2);  // no dark rectangle in the perceptible band
      expect(full).toBeLessThanOrEqual(8);  // faint terminus only (p3-norm LUT floor)
    },
  );

  // The two named user-exposing cases, opal default, dark.
  it.each([
    [12, 0, 76], [8, 32, 76],
  ] as const)("INVARIANT (named user case): inset %i / CR %i / band %i (dark)", (inset, cr, band) => {
    const G = compositeAlpha(avgTiles({ geometry: { inset, cornerRadius: cr, band, cornerFill: true } }), band, inset + cr);
    const { lit, full } = invariantDeficit(G, inset, cr, band);
    expect(lit).toBeLessThanOrEqual(2);
    expect(full).toBeLessThanOrEqual(8);
  });

  // ---- (d) light-background variant at the default geometry -----------------
  it("INVARIANT: holds on a light background (default geometry)", () => {
    const e = mk({ seed: 42, palette: { background: "light" }, motion: { hueDriftDeg: 0 }, geometry: { cornerFill: true } });
    for (let f = 0; f < 8; f++) e.step(50);
    let acc: Float64Array[] | null = null;
    for (let f = 0; f < 20; f++) {
      for (let g = 0; g < 33; g++) e.step(50);
      const bufs = captureBuffers(e);
      if (!acc) acc = bufs.map((b) => new Float64Array(b.length));
      for (let t = 0; t < bufs.length; t++) for (let i = 0; i < bufs[t].length; i++) acc[t][i] += bufs[t][i];
    }
    for (const a of acc!) for (let i = 0; i < a.length; i++) a[i] /= 20;
    const G = compositeAlpha(acc!, 76, RIM);
    const { lit, full } = invariantDeficit(G, INSET, CR, 76);
    expect(lit).toBeLessThanOrEqual(2);
    expect(full).toBeLessThanOrEqual(8);
  });

  // ---- pocket solidity: SOLID margin out to the physical tip ----------------
  it.each([
    [12, 0, 76], [3, 11, 76], [8, 32, 76],
  ] as const)("pocket is solid to the tip — within 2/255 of the straight margin (inset %i / CR %i / band %i)", (inset, cr, band) => {
    const rim = inset + cr;
    const G = compositeAlpha(settleTiles({ geometry: { inset, cornerRadius: cr, band, cornerFill: true } }), band, rim);
    // Straight outward-margin profile: a clean mid-top column at depth 0..inset,
    // indexed by |tIn| = inset − depth. The pocket at signed distance −m (outward)
    // must match the straight margin at the same |tIn|.
    const margin = (m: number) => bil(G, W / 2, Math.max(0, inset - m));
    let worst = 0;
    for (let v = 0; v < rim; v++) for (let u = 0; u < rim; u++) {
      const au = u + 0.5 - inset, av = v + 0.5 - inset;
      if (au <= 0 && av <= 0) { // pocket: outward of both centerlines (incl. the tip at u=v=0)
        const m = Math.min(inset - 0.5, Math.hypot(au, av));
        worst = Math.max(worst, margin(m) - G[v * W + u]);
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
    expect(G[0]).toBeGreaterThan(200); // the physical tip is near-solid, not a faint edge
  });

  // ---- (b) core-bend + inner-contour rounding preservation ------------------
  // Fill mode keeps the arc (rounded-path) distance for the CORE and the near-bend
  // inner dissolve, so both contours follow the arc exactly as ROUND mode does
  // (the fill vs round difference cancels the shared per-frame noise). Probed by
  // fanning the central bend of the TL arc and recording the inward depth where
  // the alpha crosses the core plateau (iso 200) and a mid-shoulder level (iso 64).
  it.each([16, 32, 40])("core + inner contour follow the arc, matching round mode (CR %i)", (cr) => {
    const inset = 3, band = 76, rim = inset + cr;
    const Gf = compositeAlpha(settleTiles({ geometry: { inset, cornerRadius: cr, band, cornerFill: true } }), band, rim);
    const Gr = compositeAlpha(settleTiles({ geometry: { inset, cornerRadius: cr, band, cornerFill: false } }), band, rim);
    const contourDepth = (G: Float64Array, ang: number, iso: number): number => {
      for (let d = 0; d <= cr + 20; d += 0.25) {
        const r = cr - d;
        if (bil(G, rim + r * Math.cos(ang), rim + r * Math.sin(ang)) < iso) return d;
      }
      return cr + 20;
    };
    let core = 0, iso64 = 0;
    for (let k = 2; k <= 18; k++) { // central 80 % of the TL quarter arc
      const ang = -Math.PI + (k / 20) * (Math.PI / 2);
      core = Math.max(core, Math.abs(contourDepth(Gf, ang, 200) - contourDepth(Gr, ang, 200)));
      iso64 = Math.max(iso64, Math.abs(contourDepth(Gf, ang, 64) - contourDepth(Gr, ang, 64)));
    }
    expect(core).toBeLessThanOrEqual(1);   // core bends with CR, ≤1px + dither
    expect(iso64).toBeLessThanOrEqual(2);  // inner dissolve stays rounded, ≤2px
  });

  // ---- (c) seam / handover continuity ---------------------------------------
  it.each([34, 76, 120])("tile↔strip and additive↔mid-edge handoffs carry no step beyond the local gradient (band %i, dark)", (band) => {
    const G = compositeAlpha(settleTiles({ geometry: { band, cornerFill: true } }), band, RIM);
    const at = (x: number, y: number) => G[y * W + x];
    const excess = (tx: number, ty: number, sx: number, sy: number) => {
      const dx = sx - tx, dy = sy - ty;
      const cross = Math.abs(at(tx, ty) - at(sx, sy));
      const tileInner = Math.abs(at(tx, ty) - at(tx - dx, ty - dy));
      const stripInner = Math.abs(at(sx, sy) - at(sx + dx, sy + dy));
      return cross - Math.max(tileInner, stripInner);
    };
    let worst = -999;
    for (let k = 0; k < RIM; k++) {
      // tile↔strip boundaries (all 4 corners, both orientations)
      worst = Math.max(worst, excess(RIM - 1, k, RIM, k), excess(RIM - 1, H - 1 - k, RIM, H - 1 - k));
      worst = Math.max(worst, excess(W - RIM, k, W - RIM - 1, k), excess(W - RIM, H - 1 - k, W - RIM - 1, H - 1 - k));
      worst = Math.max(worst, excess(k, RIM - 1, k, RIM), excess(W - 1 - k, RIM - 1, W - 1 - k, RIM));
      worst = Math.max(worst, excess(k, H - RIM, k, H - RIM - 1), excess(W - 1 - k, H - RIM, W - 1 - k, H - RIM - 1));
    }
    // additive↔mid-edge handoff (where the near-corner additive region ends, x ≈ band)
    if (band > RIM) {
      const ry = Math.floor(INSET / 2);
      worst = Math.max(worst, excess(band - 1, ry, band, ry));
    }
    expect(worst).toBeLessThanOrEqual(2);
  });

  // ---- live toggle + organic-motion composition -----------------------------
  it("is togglable live via updateOptions (matches a fresh cornerFill instance)", () => {
    const engine = mk({ seed: 42, geometry: { cornerFill: false } });
    engine.step(16.7);
    expect(captureBuffers(engine)[TILE.TL][3]).toBe(0); // TL tip rounded off before the toggle
    engine.updateOptions({ geometry: { cornerFill: true } });
    const fresh = mk({ seed: 42, geometry: { cornerFill: true } });
    fresh.step(16.7);
    engine.step(16.7); fresh.step(16.7);
    expect(bytesEqual(captureFrame(engine), captureFrame(fresh))).toBe(true);
    expect(captureBuffers(engine)[TILE.TL][3]).toBeGreaterThan(0); // pocket now lit
  });

  it("kindle / highlight / hueDrift compose into the pocket (not frozen)", () => {
    // Sample the WHOLE TL tile RGBA: the pocket tip is solid, so bloom-only
    // modulation (the highlight sweep) leaves its clamped alpha unchanged — the
    // motion must be probed over the inner dissolve region too, where the bloom
    // is not saturated. hueDrift moves the COLOUR even where alpha is solid.
    const patch = (bufs: Uint8ClampedArray[]) => Array.from(bufs[TILE.TL]);
    const differs = (a: number[], b: number[]) => a.some((v, i) => v !== b[i]);
    const fillOpts = (extra: EdgeAuraOptions["motion"]) =>
      mk({ seed: 42, palette: { background: "dark" }, geometry: { cornerFill: true }, motion: { hueDriftDeg: 0, ...extra } });

    const base = fillOpts({}); const drift = fillOpts({ hueDriftDeg: 10 });
    let baseB: Uint8ClampedArray[] = [], driftB: Uint8ClampedArray[] = [];
    for (let f = 0; f < 20; f++) { base.step(16.7); drift.step(16.7); baseB = captureBuffers(base); driftB = captureBuffers(drift); }
    expect(differs(patch(baseB), patch(driftB))).toBe(true);

    const hl = fillOpts({ highlight: { arcDeg: 60, periodS: 2, min: 0.2 } }); const plain = fillOpts({});
    let hlB: Uint8ClampedArray[] = [], plB: Uint8ClampedArray[] = [];
    for (let f = 0; f < 20; f++) { hl.step(16.7); plain.step(16.7); hlB = captureBuffers(hl); plB = captureBuffers(plain); }
    expect(differs(patch(hlB), patch(plB))).toBe(true);

    const k = fillOpts({});
    k.step(16.7);
    const before = patch(captureBuffers(k));
    k.kindle(W - 1, H - 1);
    k.step(16.7);
    expect(differs(before, patch(captureBuffers(k)))).toBe(true);
  });
});

describe("corner bent-tube: multi-source additive light (v0.4.2)", () => {
  // The round corner is rendered by the MULTI-SOURCE ADDITIVE model: every pixel
  // in a corner neighbourhood combines the geometric coverage of the three tube
  // branches — the two adjacent straights (each with its own live per-column/row
  // profile) and the arc — by the p=3 norm (∛(Σcovᵢ³)), clamped to 1 before the
  // intensity / dark-gamma / dither stages. The old deep depth-crossfade
  // concealment is gone; the field is a pure function of position, so it is
  // seamless across the tile/strip and 45° ownership boundaries by construction,
  // stays live at depth (undulation survives — S4), and concentrates light in
  // the bend interior (S3). These tests encode the verbalised corner spec
  // (S1 core, S3 bend interior, S4 undulation, S5 no implementation signature).
  // The stub viewport is 800×600 (installStubDom default).
  const VW = 800, VH = 600;
  const CQ = RIM;

  // Source-over composite of the 8 disjoint tiles into a W×H grid, keeping the
  // requested channel offset (3 = alpha) — transparent source pixels (a=0) never
  // overwrite, matching the engine's drawImage compositing.
  const compositeChannel = (
    bufs: Uint8ClampedArray[], band: number, ch: number,
  ): Float64Array => {
    const G = new Float64Array(VW * VH);
    const put = (buf: Uint8ClampedArray, bw: number, bh: number, ox: number, oy: number) => {
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
        const bi = (y * bw + x) * 4;
        if (buf[bi + 3] === 0) continue;
        G[(oy + y) * VW + (ox + x)] = buf[bi + ch];
      }
    };
    const topW = VW - 2 * RIM, leftH = VH - 2 * RIM;
    put(bufs[TILE.top], topW, band, RIM, 0);
    put(bufs[TILE.bottom], topW, band, RIM, VH - band);
    put(bufs[TILE.left], band, leftH, 0, RIM);
    put(bufs[TILE.right], band, leftH, VW - band, RIM);
    put(bufs[TILE.TL], CQ, CQ, 0, 0);
    put(bufs[TILE.TR], CQ, CQ, VW - CQ, 0);
    put(bufs[TILE.BR], CQ, CQ, VW - CQ, VH - CQ);
    put(bufs[TILE.BL], CQ, CQ, 0, VH - CQ);
    return G;
  };
  const compositeAlpha = (bufs: Uint8ClampedArray[], band: number) => compositeChannel(bufs, band, 3);

  const settle = (band: number, bg: "dark" | "light" = "dark") => {
    const engine = mk({ seed: 42, geometry: { band }, palette: { background: bg } });
    for (let f = 0; f < 8; f++) engine.step(16.7);
    return engine;
  };
  // Frame-averaged alpha grid (cancels the live noise for the S3 concentration
  // law); no tap/key and hueDrift off so the average is a clean geometry probe.
  // Defaults to the spec's GOLDEN seed 42 (not seed 7 — the earlier revision
  // gamed S3 by measuring seed 7, where the thin-band pooled concentration
  // happens to pass) and the dark golden background.
  const averaged = (band: number, seed = 42, bg: "dark" | "light" = "dark", N = 40): Float64Array => {
    const e = mk({ seed, geometry: { band }, motion: { hueDriftDeg: 0 }, palette: { background: bg } });
    for (let f = 0; f < 8; f++) e.step(16.7);
    const acc = new Float64Array(VW * VH);
    for (let f = 0; f < N; f++) {
      e.step(16.7);
      const A = compositeAlpha(captureBuffers(e), band);
      for (let i = 0; i < acc.length; i++) acc[i] += A[i];
    }
    for (let i = 0; i < acc.length; i++) acc[i] /= N;
    return acc;
  };

  // ---- S1: the near-centerline CORE is flat along the whole path -----------
  // Sample the alpha at the tube centerline walking mid-top-edge → TR arc →
  // mid-right-edge; the core saturates, so it must stay flat (dev ≤ 2/255).
  it.each([34, 76, 120])("S1: core stays flat through the bend (band %i, dark)", (band) => {
    const A = compositeAlpha(captureBuffers(settle(band)), band);
    const at = (x: number, y: number) => A[y * VW + x];
    const vals: number[] = [at(Math.round(VW / 2), INSET)];
    const ccx = VW - RIM, ccy = RIM;
    for (let k = 0; k <= 20; k++) {
      const ang = -Math.PI / 2 + (k / 20) * (Math.PI / 2);
      vals.push(at(Math.round(ccx + CR * Math.cos(ang)), Math.round(ccy + CR * Math.sin(ang))));
    }
    vals.push(at(VW - 1 - INSET, Math.round(VH / 2)));
    const mid = vals[0];
    expect(mid).toBeGreaterThan(0);
    for (const v of vals) expect(Math.abs(v - mid)).toBeLessThanOrEqual(2);
  });

  // ---- S3: BEND INTERIOR light concentration -------------------------------
  // The concave apex at arc distance-to-path d is compared to a straight section
  // AT EQUAL DEPTH d. The multi-source combine holds this within [−5 %, +40 %].
  //
  // CHOICE OF REFERENCE — why the apex is referenced to its OWN corner's two
  // adjacent edges, and why the metric is POOLED over the four corners (not a
  // single mid-top straight for every corner, as the earlier revision did):
  // the ring's slow organic brightness noise varies ±30–40 % ALONG the ring, so
  // a single corner's apex vs a straight on a DIFFERENT edge conflates that
  // brightness swing with the geometric concentration. Measured directly, a
  // single corner's E spans roughly −45 %…+140 % from the noise ALONE — even with
  // the multi-source pile switched off (combined = dominant branch). So a literal
  // per-corner [−5 %, +40 %] bound is not a well-posed quantity; the geometric
  // concentration only emerges once the brightness swing is cancelled, by (a)
  // referencing each apex to a single-source baseline on ITS OWN two edges just
  // outside the neighbourhood (off = band), and (b) pooling over the four
  // corners. The −5 % floor holds for d ≥ 4 (at d = 2 the apex sits inside the
  // saturated core neighbourhood, where the ratio is meaningless).
  const s3corners = [
    { cx: RIM, cy: RIM, sx: -1, sy: -1, // TL: top + left edges
      refs: (d: number, o: number): [number, number][] => [[RIM + o, INSET + d], [INSET + d, RIM + o]] },
    { cx: VW - RIM, cy: RIM, sx: 1, sy: -1, // TR: top + right
      refs: (d: number, o: number): [number, number][] => [[VW - RIM - o, INSET + d], [VW - 1 - INSET - d, RIM + o]] },
    { cx: VW - RIM, cy: VH - RIM, sx: 1, sy: 1, // BR: bottom + right
      refs: (d: number, o: number): [number, number][] => [[VW - RIM - o, VH - 1 - INSET - d], [VW - 1 - INSET - d, VH - RIM - o]] },
    { cx: RIM, cy: VH - RIM, sx: -1, sy: 1, // BL: bottom + left
      refs: (d: number, o: number): [number, number][] => [[RIM + o, VH - 1 - INSET - d], [INSET + d, VH - RIM - o]] },
  ];
  // GOLDEN seed 42 + a second seed (1234) for robustness, on BOTH backgrounds —
  // the explicit S3 ceiling is applied to aGeom BEFORE the dark LUT, so it must
  // hold on light (no dark-gamma compression) as well as dark. Light pools ~2×
  // dark for the same geometry (the 0.55 dark gamma compresses ratios), so both
  // living inside +40 % is the real background-independence check the ceiling
  // buys. Pre-ceiling the dark seed-42 thin band pooled to +53 % and single
  // corners to +139 %; the ceiling brings the pool to ≤+20 % dark / ≤+38 % light.
  it.each([
    [42, "dark"], [1234, "dark"], [42, "light"], [1234, "light"],
  ] as const)("S3: bend-interior concentration pools within [−5%, +40%] (seed %i, %s)", (seed, bg) => {
    for (const band of [34, 76, 120]) {
      const A = averaged(band, seed, bg);
      const at = (x: number, y: number) => A[y * VW + x];
      const inv = Math.SQRT1_2;
      const off = band; // single-source baseline just outside the neighbourhood
      let sawPositive = false;
      for (const d of [4, 6, 8, 10]) {
        let eSum = 0, n = 0;
        for (const c of s3corners) {
          const rad = CR - d; // apex at arc-distance d, toward the screen corner
          const interior = at(Math.round(c.cx + c.sx * rad * inv), Math.round(c.cy + c.sy * rad * inv));
          let rs = 0, rn = 0;
          for (const [x, y] of c.refs(d, off)) { const v = at(x, y); if (v > 2) { rs += v; rn++; } }
          if (rn === 2) { eSum += interior / (rs / rn) - 1; n++; }
        }
        const E = (eSum / n) * 100;
        expect(E).toBeGreaterThanOrEqual(-5);
        expect(E).toBeLessThanOrEqual(40);
        if (E > 5) sawPositive = true;
      }
      expect(sawPositive).toBe(true); // a real concentration is present, not just noise
    }
  });

  // The explicit S3 ceiling caps the multi-source pile PER PIXEL at
  // S3_MAX_GAIN × the dominant single branch — a background-independent hard cap
  // the p=3 norm's implicit ×∛(branches) shape does not guarantee on thin bands.
  // Verify the mechanism directly (independent of the reference-choice noise):
  // walk the exact bend-centre diagonal (all three branches pile) and confirm the
  // composited apex never exceeds ~1.1× the brightest co-located single-source
  // straight one branch away — i.e. the pile is bounded, the +139 % spike is gone.
  it("S3: the multi-source pile stays bounded near the dominant branch (dark, seed 42)", () => {
    const B = 76;
    const A = averaged(B, 42, "dark");
    const at = (x: number, y: number) => A[y * VW + x];
    const inv = Math.SQRT1_2;
    let worstRatio = 0;
    for (const c of s3corners) {
      for (const d of [4, 6, 8, 10]) {
        const rad = CR - d;
        const apex = at(Math.round(c.cx + c.sx * rad * inv), Math.round(c.cy + c.sy * rad * inv));
        // Brightest single-source straight at equal depth on either own edge,
        // sampled at three along-edge offsets to bracket the local tube.
        let dom = 0;
        for (const o of [B, B + 30, B + 60]) {
          for (const [x, y] of c.refs(d, o)) dom = Math.max(dom, at(x, y));
        }
        if (dom > 4) worstRatio = Math.max(worstRatio, apex / dom);
      }
    }
    // The local single-source reference undershoots the apex's own in-place branch
    // amplitude (sampled ≥ band px away, on a dimmer ring spot), so the measured
    // ratio runs above the 1.1 per-pixel cap; the point is it is BOUNDED and far
    // below the pre-ceiling pile (which drove single-corner E to +139 %, ratio
    // ~2.4). Guards against the ceiling silently regressing.
    expect(worstRatio).toBeLessThanOrEqual(1.55);
  });

  it("S3: the enhancement decays away from the corner (band 76)", () => {
    // At a fixed depth on the top edge, the interior brightening is maximal near
    // the TR corner (the right straight + arc pile on) and falls to the mid-edge
    // baseline as those branches recede. Compare three windows (averaged along
    // the edge to cancel the residual noise): near-corner > mid-approach > far.
    const A = averaged(76);
    const at = (x: number, y: number) => A[y * VW + x];
    const depthY = INSET + 6;
    const win = (xLo: number, xHi: number) => {
      let s = 0, n = 0;
      for (let x = xLo; x < xHi; x++) { s += at(x, depthY); n++; }
      return s / n;
    };
    const near = win(VW - RIM - 30, VW - RIM - 4);
    const mid = win(VW - RIM - 110, VW - RIM - 80);
    const far = win(VW / 2 - 40, VW / 2 + 40);
    expect(near).toBeGreaterThan(mid);       // decays with distance from corner
    expect(mid).toBeGreaterThanOrEqual(far - 1);
    expect(near).toBeGreaterThan(far + 3);   // a real, measurable concentration
  });

  // ---- S4: UNDULATION survives at depth near the corners -------------------
  // Composited near-corner liveness (columns 8 apart cancel the Bayer dither;
  // only lit pairs counted) must stay ≥ 0.8× the mid-edge rate at ALL depths —
  // the deep crossfade used to collapse this toward 0. Measured on the composite
  // because the diagonal ownership hands deep near-corner pixels to the
  // perpendicular strip (they stay lit and live, just in another buffer).
  const livenessRow = (A: Float64Array, d: number, xLo: number, xHi: number) => {
    const at = (x: number, y: number) => A[y * VW + x];
    let distinct = 0, total = 0;
    for (let x = xLo; x < xHi; x++) {
      const a = at(x, d), b = at(x + 8, d);
      if (a === 0 && b === 0) continue;
      if (a !== b) distinct++; total++;
    }
    return total ? distinct / total : 0;
  };
  // The near-corner undulation must survive at depth (the deep crossfade the
  // additive model replaced used to collapse it toward 0). Asserted on BOTH
  // backgrounds — the multi-source round path keeps each branch's own live noise
  // on light and dark alike. The floor is background-DEPENDENT and measured:
  // DARK holds ≥ 0.8× mid-edge (measured worst ≈ 0.81 both bands); LIGHT holds a
  // lower ≥ 0.7× floor (measured worst ≈ 0.75 at band 76, ≈ 0.82 at band 120).
  // Light is inherently less distinct because it has NO dark-response gamma to
  // amplify the small per-column alpha differences the energy-weighted blend
  // leaves in the deep corner interior — the same mechanism behind the S3 light
  // overshoot. This is not the deep-crossfade collapse the test guards against
  // (that drove the ratio toward 0); the undulation is demonstrably alive on both.
  it.each([
    [76, "dark", 0.8], [120, "dark", 0.8], [76, "light", 0.7], [120, "light", 0.7],
  ] as const)("S4: near-corner undulation survives at all depths (band %i, %s, ≥%f× mid)", (band, bg, floor) => {
    const A = compositeAlpha(captureBuffers(settle(band, bg)), band);
    for (let d = 8; d < band - 4; d += 6) {
      const near = livenessRow(A, d, RIM, RIM + 2 * band); // within 2·reach of TL
      const mid = livenessRow(A, d, 260, 420);
      if (mid < 0.15) continue; // mid itself has died — nothing to compare
      expect(near).toBeGreaterThanOrEqual(floor * mid - 0.02);
    }
  });

  // ---- S5: no implementation signature -------------------------------------
  // (a) The field is C0-continuous across the 45° ownership diagonals: the max
  // adjacent step STRADDLING a diagonal is no larger than the general adjacent
  // step in the same neighbourhood, plus a small margin for the physical S3 apex
  // highlight (which is a smooth brightness maximum, not a seam).
  it.each([34, 76, 120])("S5: no ownership seam across the diagonals (band %i, dark)", (band) => {
    const A = compositeAlpha(captureBuffers(settle(band)), band);
    const at = (x: number, y: number) => A[y * VW + x];
    let straddle = 0, general = 0;
    const dHi = Math.min(band - 1, 70);
    for (let D = RIM; D <= dHi; D++) {
      const k = D - RIM;
      const cs = [
        [RIM + k, RIM + k], [VW - 1 - (RIM + k), RIM + k],
        [VW - 1 - (RIM + k), VH - 1 - (RIM + k)], [RIM + k, VH - 1 - (RIM + k)],
      ];
      for (const [x, y] of cs) {
        straddle = Math.max(straddle, Math.abs(at(x, y) - at(x, y + 1)), Math.abs(at(x, y) - at(x, y - 1)));
        for (const dxo of [3, -3, 6, -6]) general = Math.max(general, Math.abs(at(x + dxo, y) - at(x + dxo, y + 1)));
      }
    }
    expect(straddle).toBeLessThanOrEqual(general + 3);
  });

  // (b) The tile↔strip boundaries stay CONTINUOUS: the additive tile and the
  // additive near-corner strips evaluate the identical position-pure field, so a
  // boundary crossing carries only the local field gradient — never a step
  // beyond what the same crossing shows one pixel deeper into either owner. (A
  // raw across-the-boundary difference is NOT a valid seam metric here: the two
  // sides sit at different tube depths, so in the bright 3-branch corner interior
  // the physical gradient alone is ~6/255 — see S1 for the flat core.) Checked
  // for every corner, both the vertical (tile↔horizontal strip) and horizontal
  // (tile↔vertical strip) boundary.
  it.each([34, 76, 120])("S5: tile↔strip boundaries carry no step beyond the local gradient (band %i, dark)", (band) => {
    const A = compositeAlpha(captureBuffers(settle(band)), band);
    const at = (x: number, y: number) => A[y * VW + x];
    // Continuity across one boundary pixel: |tile − strip| minus the larger of
    // the two owners' own adjacent step in the crossing direction.
    const excess = (tx: number, ty: number, sx: number, sy: number) => {
      const dx = sx - tx, dy = sy - ty; // crossing direction (unit)
      const cross = Math.abs(at(tx, ty) - at(sx, sy));
      const tileInner = Math.abs(at(tx, ty) - at(tx - dx, ty - dy));
      const stripInner = Math.abs(at(sx, sy) - at(sx + dx, sy + dy));
      return cross - Math.max(tileInner, stripInner);
    };
    let worst = -999;
    for (let k = 0; k < RIM; k++) {
      // vertical boundaries (crossing in x): TL/BL at x=RIM, TR/BR at x=VW−RIM
      worst = Math.max(worst, excess(RIM - 1, k, RIM, k), excess(RIM - 1, VH - 1 - k, RIM, VH - 1 - k));
      worst = Math.max(worst, excess(VW - RIM, k, VW - RIM - 1, k), excess(VW - RIM, VH - 1 - k, VW - RIM - 1, VH - 1 - k));
      // horizontal boundaries (crossing in y): TL/TR at y=RIM, BL/BR at y=VH−RIM
      worst = Math.max(worst, excess(k, RIM - 1, k, RIM), excess(VW - 1 - k, RIM - 1, VW - 1 - k, RIM));
      worst = Math.max(worst, excess(k, VH - RIM, k, VH - RIM - 1), excess(VW - 1 - k, VH - RIM, VW - 1 - k, VH - RIM - 1));
    }
    expect(worst).toBeLessThanOrEqual(2); // no discontinuity beyond the field gradient
  });

  // (c) Hue advances continuously by arc length through the corner (palette +
  // noise phases key on the arc position s), so no palette jump on the arc.
  it("S5: hue advances continuously along the TR arc centerline (dark)", () => {
    const bufs = captureBuffers(settle(76));
    const R = compositeChannel(bufs, 76, 0);
    const G = compositeChannel(bufs, 76, 1);
    const B = compositeChannel(bufs, 76, 2);
    const ccx = VW - RIM, ccy = RIM;
    let prev: [number, number, number] | null = null, maxJump = 0;
    for (let k = 0; k <= 40; k++) {
      const ang = -Math.PI / 2 + (k / 40) * (Math.PI / 2);
      const x = Math.round(ccx + CR * Math.cos(ang)), y = Math.round(ccy + CR * Math.sin(ang));
      const rgb: [number, number, number] = [R[y * VW + x], G[y * VW + x], B[y * VW + x]];
      if (prev) maxJump = Math.max(maxJump, Math.abs(rgb[0] - prev[0]) + Math.abs(rgb[1] - prev[1]) + Math.abs(rgb[2] - prev[2]));
      prev = rgb;
    }
    expect(maxJump).toBeLessThanOrEqual(12); // ~4/channel, continuous — no palette jump
  });

  // ---- S2: iso-level CONTOURS are smooth offset curves (no scalloping) ------
  // A physically-bent tube's alpha iso-contour is an OFFSET CURVE of the rounded
  // path: it must fan around the bend smoothly, with no scalloping (the facet
  // artifact the p3-norm + arc-sample nearest-neighbour quantization could
  // reintroduce — the class of defect the owner called "微妙"). Probe the bend
  // INTERIOR (where the multi-source additive concentration is strongest and any
  // arc-sample facet would show): at ~40 angular positions fanning the central
  // portion of each corner arc, march inward from the centerline (r = CR) and
  // record the depth where the alpha crosses each iso-level; a facet would spike
  // the SECOND difference of that depth-vs-angle curve. Measured on the frame-
  // averaged grid so the live noise cancels and only geometry is left.
  //
  // Iso-levels are the SPEC's {128, 64, 16} (restored — an earlier revision drifted
  // to {112, 96, 80}). Their conditioning is band-dependent, so each is probed only
  // where the contour-DEPTH metric is well-posed:
  //   • 128, 64 — on the near-opaque core plateau / upper shoulder; the contour sits
  //     at a small inward offset (< CR) at every band, so it is well-conditioned at
  //     34/76/120 (measured contour-depth jump ≤ 1.85 px).
  //   • 16 — a faint DEEP level. Its contour lies at inward offset < CR only at the
  //     thin band 34 (self-similar bloom → the faint tail is compressed shallow);
  //     at band 76 it already sits at offset ≈ CR and at 120 far past it, where the
  //     inward offset curve of an 11 px-radius arc self-degenerates (measured
  //     contour-depth jump 5 px at 76, 21 px at 120 — pure ill-conditioning: the
  //     alpha gradient along the deep march is near-flat, so tiny alpha ripples
  //     blow up the crossing depth). So level 16 is probed by this contour method
  //     ONLY at band 34. The DEEP-INTERIOR smoothness that level 16 would probe at
  //     bands 76/120 is instead covered by the offset-curve ALPHA-smoothness method
  //     below (S2-B) at a valid mid-depth — where the deep alpha is demonstrably
  //     smooth (jump ≤ 1.1/255), proving there is no scallop, only ill-conditioning.
  // The fan spans the central 32 % of the quarter — the bend proper; the
  // arc↔straight tangent handoffs are covered by the S5 tile↔strip test.
  const fanCorners = [
    { cx: RIM, cy: RIM, a0: -Math.PI, a1: -Math.PI / 2 },        // TL → (0,0)
    { cx: VW - RIM, cy: RIM, a0: -Math.PI / 2, a1: 0 },          // TR → (VW,0)
    { cx: VW - RIM, cy: VH - RIM, a0: 0, a1: Math.PI / 2 },      // BR → (VW,VH)
    { cx: RIM, cy: VH - RIM, a0: Math.PI / 2, a1: Math.PI },     // BL → (0,VH)
  ];
  const N = 40;
  // Bilinear alpha at a fractional pixel of a frame-averaged grid (clamped).
  const bilinear = (A: Float64Array) => (x: number, y: number): number => {
    if (x < 0) x = 0; else if (x > VW - 1) x = VW - 1;
    if (y < 0) y = 0; else if (y > VH - 1) y = VH - 1;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, VW - 1), y1 = Math.min(y0 + 1, VH - 1);
    const fx = x - x0, fy = y - y0;
    const a = A[y0 * VW + x0], b = A[y0 * VW + x1];
    const c = A[y1 * VW + x0], d = A[y1 * VW + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  const fanAngle = (c: { a0: number; a1: number }, k: number) =>
    c.a0 + (c.a1 - c.a0) * (0.34 + 0.32 * (k / (N - 1)));

  it.each([34, 76, 120])("S2: iso-contours are smooth offset curves (band %i, dark)", (band) => {
    const sampleA = bilinear(averaged(band));
    const levels = band === 34 ? [128, 64, 16] : [128, 64]; // 16 only where well-conditioned
    for (const level of levels) {
      for (const c of fanCorners) {
        // Contour depth at each fan angle: from the centerline (r = CR) march
        // inward (toward the arc centre and on into the interior) until alpha
        // falls to `level`, interpolating the crossing.
        const depth: number[] = [];
        for (let k = 0; k < N; k++) {
          const a = fanAngle(c, k);
          const ux = Math.cos(a), uy = Math.sin(a);
          let cross = NaN, prevD = 0, prevV = sampleA(c.cx + CR * ux, c.cy + CR * uy);
          for (let D = 0; D <= band * 1.7; D += 0.25) {
            const rr = CR - D;
            const v = sampleA(c.cx + rr * ux, c.cy + rr * uy);
            if (v <= level) {
              cross = prevV === v ? D : prevD + (0.25 * (prevV - level)) / (prevV - v);
              break;
            }
            prevD = D; prevV = v;
          }
          depth.push(cross);
        }
        // The whole fan must actually cross the level (contour exists).
        expect(depth.every((r) => Number.isFinite(r))).toBe(true);
        let maxJump = 0, maxSecond = 0;
        for (let k = 1; k < N; k++) maxJump = Math.max(maxJump, Math.abs(depth[k] - depth[k - 1]));
        for (let k = 1; k < N - 1; k++) {
          maxSecond = Math.max(maxSecond, Math.abs(depth[k + 1] - 2 * depth[k] + depth[k - 1]));
        }
        // Smooth offset curve: no adjacent step and no curvature spike (the
        // scalloping/faceting signature). The ≤2 px bounds are the spec thresholds.
        expect(maxJump).toBeLessThanOrEqual(2);
        expect(maxSecond).toBeLessThanOrEqual(2);
      }
    }
  });

  // S2-B — DEEP-INTERIOR smoothness via the offset-curve ALPHA (the auditor's
  // method), covering the bend interior at bands 76/120 where the level-16
  // contour-depth degenerates (offset ≫ CR). Instead of the depth where alpha
  // crosses a level, this walks a curve at a FIXED deep inward offset D (a valid
  // depth well inside the rendered strip) and asserts the ALPHA along it varies
  // smoothly — a facet/scallop from the p3-norm + arc-sample quantization would
  // spike the second difference. Deep alpha is smooth (measured jump ≤ 1.1/255,
  // second ≤ 0.6), so the level-16 ill-conditioning above is purely the flat
  // gradient, not a real offset-curve defect.
  it.each([[76, 30], [120, 40]] as const)(
    "S2-B: deep interior alpha is smooth along the offset curve (band %i, depth %i, dark)",
    (band, D) => {
      const sampleA = bilinear(averaged(band));
      let maxJump = 0, maxSecond = 0;
      for (const c of fanCorners) {
        const alpha: number[] = [];
        for (let k = 0; k < N; k++) {
          const a = fanAngle(c, k);
          alpha.push(sampleA(c.cx + (CR - D) * Math.cos(a), c.cy + (CR - D) * Math.sin(a)));
        }
        for (let k = 1; k < N; k++) maxJump = Math.max(maxJump, Math.abs(alpha[k] - alpha[k - 1]));
        for (let k = 1; k < N - 1; k++) {
          maxSecond = Math.max(maxSecond, Math.abs(alpha[k + 1] - 2 * alpha[k] + alpha[k - 1]));
        }
      }
      expect(maxJump).toBeLessThanOrEqual(2);
      expect(maxSecond).toBeLessThanOrEqual(2);
    },
  );

  // ---- band < RIM: the additive box must still cover the arc TILE -----------
  // Regression guard for the corner box size. BS (the additive neighbourhood
  // side) must cover BOTH the near-corner strip triangles (up to BAND) and the
  // RIM×RIM arc tile — so BS = max(RIM, BAND). Sized to BAND alone, any band <
  // RIM = INSET + CR (default 14) made the box smaller than the tile, and tile
  // pixels past BS collapsed onto the BS−1 edge in addNeonPixel's safety clamp —
  // a smear. band = 8 (< RIM) is reachable through the public geometry.band
  // (clamp floor 8) at the DEFAULT radius. Verify the first tile row and column
  // that WOULD be smeared (index = band, which the old clamp folded onto band−1)
  // instead carry their own live arc geometry.
  it("round corners survive band < RIM (box covers the arc tile, no clamp smear)", () => {
    const band = 8;
    expect(band).toBeLessThan(RIM); // precondition: this exercises band < RIM
    const e = mk({ seed: 42, geometry: { band }, palette: { background: "dark" } });
    for (let f = 0; f < 8; f++) e.step(16.7);
    const tl = captureBuffers(e)[TILE.TL]; // RIM × RIM corner tile (TL box origin 0,0)
    const alpha = (ly: number, lx: number) => tl[(ly * RIM + lx) * 4 + 3];
    // The tile is lit.
    let anyLit = false;
    for (let i = 0; i < RIM * RIM; i++) if (tl[i * 4 + 3] > 0) anyLit = true;
    expect(anyLit).toBe(true);
    // Row/col `band` vs its clamp edge (band−1). Pre-fix they were byte-copies
    // of the edge (differing only by the ±1 Bayer dither); live arc geometry
    // differs far more (observed ≈90/255).
    let rowDiff = 0, colDiff = 0;
    for (let t = 0; t < RIM; t++) {
      rowDiff = Math.max(rowDiff, Math.abs(alpha(band, t) - alpha(band - 1, t)));
      colDiff = Math.max(colDiff, Math.abs(alpha(t, band) - alpha(t, band - 1)));
    }
    expect(rowDiff).toBeGreaterThan(15);
    expect(colDiff).toBeGreaterThan(15);
  });

  // Mid-edge span reference: proves the additive corner rework leaves the
  // mid-edge (single-source strip) path BIT-IDENTICAL. This hash was captured
  // from the pre-change build (git worktree of main) and verified equal to the
  // current build; a mismatch means the corner change leaked into the straights.
  const MID_EDGE_SPAN_SHA256 = "e4f426b1fa0ecfeb1959b43f716a373e9028c0cae9697b37fce5891914c1daf0";
  it("mid-edge span is unchanged (single-source path bit-identical)", () => {
    const e = mk({ seed: 42, palette: { background: "dark" } });
    let top: Uint8ClampedArray = new Uint8ClampedArray(0);
    for (let f = 0; f < 30; f++) {
      e.step(16.7);
      if (f === 10) e.tap({ x: 200, y: 300 });
      if (f === 15) e.key(0.5);
      top = captureBuffers(e)[TILE.top];
    }
    const topW = VW - 2 * RIM;
    // depths 0..39, columns 300..480 — far from both corners (near-corner is
    // within band=76 of x=RIM and x=VW−RIM).
    const span = new Uint8ClampedArray(40 * 181 * 4);
    let o = 0;
    for (let d = 0; d < 40; d++) for (let i = 300; i <= 480; i++) {
      const idx = (d * topW + i) * 4;
      span[o++] = top[idx]; span[o++] = top[idx + 1]; span[o++] = top[idx + 2]; span[o++] = top[idx + 3];
    }
    expect(sha256Hex(span)).toBe(MID_EDGE_SPAN_SHA256);
  });
});

describe("palette determinism (stops, not name)", () => {
  it("'ember' by name renders byte-identically to the same stops passed inline", () => {
    // Proves the engine keys rendering off the stop values, not the preset
    // name: a manually-supplied array equal to ember must be byte-equal.
    // hueDriftDeg 0 + highlight off keeps the frame purely stops-driven.
    // The literal below is pinned to EDGE_AURA_PALETTES.ember — if the preset
    // stops ever drift from it, this equivalence check fails loudly.
    const inlineEmber: EdgeAuraPaletteStops = [
      [0, [186, 58, 60]],
      [0.25, [244, 96, 62]],
      [0.46, [255, 158, 96]],
      [0.55, [255, 204, 144]],
      [0.68, [232, 122, 82]],
      [0.88, [164, 64, 82]],
      [1.0, [186, 58, 60]],
    ];
    const byName = mk({
      seed: 1,
      palette: { stops: EDGE_AURA_PALETTES.ember },
      motion: { hueDriftDeg: 0 },
    });
    const byStops = mk({
      seed: 1,
      palette: { stops: inlineEmber },
      motion: { hueDriftDeg: 0 },
    });
    byName.step(16);
    byStops.step(16);
    const a = captureFrame(byName);
    expect(a.some((v) => v !== 0)).toBe(true);
    expect(bytesEqual(a, captureFrame(byStops))).toBe(true);
  });
});

describe("hue drift", () => {
  it("drift 10° diverges from drift 0 once elapsed advances", () => {
    const mkDrift = (deg: number) =>
      mk({ seed: 3, motion: { hueDriftDeg: deg } });
    const still = mkDrift(0);
    const drifting = mkDrift(10);
    // Accumulate ~1s so sin(2π·elapsed/12) is well off zero — a sub-frame
    // elapsed would leave the LUT sample offset below one entry and round away.
    for (let i = 0; i < 60; i++) {
      still.step(16.7);
      drifting.step(16.7);
    }
    expect(bytesEqual(captureFrame(still), captureFrame(drifting))).toBe(false);
  });

  it("with drift 0 the period is irrelevant (offset is always exactly 0)", () => {
    const mkPeriod = (period: number) =>
      mk({ seed: 3, motion: { hueDriftDeg: 0, hueDriftPeriodS: period } });
    const p12 = mkPeriod(12);
    const p3 = mkPeriod(3);
    for (let i = 0; i < 60; i++) {
      p12.step(16.7);
      p3.step(16.7);
    }
    expect(bytesEqual(captureFrame(p12), captureFrame(p3))).toBe(true);
  });
});

describe("highlight sweep", () => {
  it("absent option is byte-identical to the baseline (zero cost, zero change)", () => {
    const baseline = mk({ seed: 5 });
    const noHighlight = mk({ seed: 5, motion: {} });
    expect(bytesEqual(captureFrame(baseline), captureFrame(noHighlight))).toBe(true);
  });

  it("enabled: swells the bloom but leaves the core-saturated peak untouched", () => {
    // At elapsed 0 the crest is centered at arc s=0 (top), so the bottom strip
    // is at the window trough: highlight scales the BLOOM there by `min`
    // (0.35), lowering the deep bloom tail — while the centerline saturates
    // core+bloom to 1 and clamps to the same peak alpha with or without it.
    const off = mk({ seed: 5 });
    const on = mk({
      seed: 5,
      motion: { highlight: { arcDeg: 80, periodS: 6, min: 0.35 } },
    });
    const bottomOff = captureBuffers(off)[TILE.bottom];
    const bottomOn = captureBuffers(on)[TILE.bottom];

    let maxOff = 0;
    let maxOn = 0;
    let sumOff = 0;
    let sumOn = 0;
    for (let i = 0; i < bottomOff.length / 4; i++) {
      const ao = bottomOff[i * 4 + 3];
      const an = bottomOn[i * 4 + 3];
      if (ao > maxOff) maxOff = ao;
      if (an > maxOn) maxOn = an;
      sumOff += ao;
      sumOn += an;
    }
    // The clamped-to-1 centerline peak is identical (core term unchanged)...
    expect(maxOn).toBe(maxOff);
    expect(maxOff).toBeGreaterThan(0);
    // ...but the trough bloom is measurably dimmer, so the strips differ.
    expect(sumOn).toBeLessThan(sumOff);
    expect(bytesEqual(bottomOff, bottomOn)).toBe(false);
  });
});

describe("dark alpha response (I3)", () => {
  it("remaps a mid-bloom pixel's coverage by pow(aGeom, 0.55) within quantization", () => {
    // Isolate the gamma curve: normalize off pins BOTH backgrounds to ring
    // alpha 0.9 (identical frameIntensity), and aGeom is background-independent,
    // so at a shared pixel  light_a = aGeom·0.9  and  dark_a = pow(aGeom,0.55)·0.9.
    const FI = 0.9;
    const light = mk({ seed: 7, palette: { normalize: false } });
    const dark = mk({ seed: 7, palette: { normalize: false, background: "dark" } });
    const lightTop = captureBuffers(light)[TILE.top];
    const darkTop = captureBuffers(dark)[TILE.top];

    let checked = 0;
    for (let i = 0; i < lightTop.length / 4 && checked < 40; i++) {
      const L = lightTop[i * 4 + 3];
      if (L < 60 || L > 180) continue; // mid-bloom band only
      const D = darkTop[i * 4 + 3];
      const aGeom = L / (FI * 255);
      const predicted = Math.round(Math.pow(aGeom, 0.55) * FI * 255);
      // ±2: L-recovery rounding + the dark path's floor-index + D's own round.
      expect(Math.abs(D - predicted)).toBeLessThanOrEqual(2);
      checked++;
    }
    expect(checked).toBeGreaterThan(0); // the mid-bloom band was actually sampled
  });
});

describe("dark inner-edge terminus (I2: high-res darkAlphaLut input)", () => {
  // The dark alpha response LUT is indexed by (aGeom * DARK_ALPHA_LUT_MAX) | 0.
  // At the OLD 256-input resolution the smallest nonzero dark alpha was
  // LUT[1] = pow(1/255, 0.55)·0.9·255 ≈ 11/255, so the faint inner-edge tail
  // ended in an ~11/255 stippled cliff (no inner window can fix an input-
  // quantization step). At 4096 the smallest nonzero drops to ≈ 2.6/255 and the
  // deep tail becomes a smooth ramp the output dither dissolves.
  const darkGolden = (): Uint8ClampedArray[] => {
    const engine = mk({ seed: 42, palette: { background: "dark" } });
    let bufs: Uint8ClampedArray[] = [];
    for (let frame = 0; frame < 30; frame++) {
      engine.step(16.7);
      if (frame === 10) engine.tap({ x: 200, y: 300 });
      if (frame === 15) engine.key(0.5);
      bufs = captureBuffers(engine);
    }
    return bufs;
  };

  it("populates dark alpha bytes below the old 11/255 floor (finer input resolution)", () => {
    // Bytes 2..9 are UNREACHABLE under the old 8-bit input LUT (its smallest
    // nonzero output rounds to ~11); the 4096-input LUT resolves them, so their
    // presence is a direct fingerprint of the higher input resolution.
    const bufs = darkGolden();
    let lowCount = 0;
    for (const buf of bufs) {
      for (let i = 3; i < buf.length; i += 4) {
        const a = buf[i];
        if (a >= 2 && a <= 9) lowCount++;
      }
    }
    expect(lowCount).toBeGreaterThan(100);
  });

  it("caps the natural inner-edge terminus step at ≤ 3/255 (no 11/255 cliff)", () => {
    // On the top strip, a column that DECAYS to the alpha-epsilon break (its
    // deepest lit pixel is faint, ≤ 3) terminates naturally rather than being
    // reach/window-clipped. Across those quiet columns the largest adjacent-
    // depth step in the last 6 px — including the final drop to 0 — is the
    // terminus cliff. It must sit at ≤ 3/255, not the old ~11.
    const bufs = darkGolden();
    const top = bufs[TILE.top];
    const topW = 800 - 2 * RIM;
    let worst = 0;
    let naturalColumns = 0;
    for (let col = 30; col < topW - 30; col++) {
      const alphas: number[] = [];
      for (let d = 0; d < 76; d++) alphas.push(top[(d * topW + col) * 4 + 3]);
      let last = -1;
      for (let d = 75; d >= 0; d--) {
        if (alphas[d] > 0) { last = d; break; }
      }
      if (last < 0 || alphas[last] > 3) continue; // natural terminus only
      naturalColumns++;
      for (let d = Math.max(0, last - 5); d <= last; d++) {
        worst = Math.max(worst, Math.abs(alphas[d] - (alphas[d + 1] ?? 0)));
      }
    }
    expect(naturalColumns).toBeGreaterThan(0); // the regime was actually sampled
    expect(worst).toBeLessThanOrEqual(3);
  });
});

describe("updateOptions", () => {
  it("geometry band change reallocates buffers to a deeper strip", () => {
    const engine = mk({ seed: 8 });
    const beforeTop = captureBuffers(engine)[TILE.top];
    engine.updateOptions({ geometry: { band: 120 } });
    const afterTop = captureBuffers(engine)[TILE.top];
    // A taller band means a taller top strip → strictly more bytes.
    expect(afterTop.length).toBeGreaterThan(beforeTop.length);
  });

  it("palette scalar change rebuilds the LUT (frame bytes change, size unchanged)", () => {
    const engine = mk({ seed: 8 });
    const before = captureFrame(engine);
    const effPastelBefore = engine.getNormalization().effPastel;
    engine.updateOptions({ palette: { pastel: 0.9 } });
    const after = captureFrame(engine);
    expect(before.length).toBe(after.length); // geometry untouched
    expect(bytesEqual(before, after)).toBe(false);
    // getNormalization reflects the re-derive: the effective pastel moved off
    // its default (normalize's step-down settles it below the requested 0.9).
    expect(engine.getNormalization().effPastel).not.toBe(effPastelBefore);
  });

  it("motion change applies (a slower rotation diverges from the default)", () => {
    const control = mk({ seed: 8 });
    const tuned = mk({ seed: 8 });
    tuned.updateOptions({ motion: { rotateIdleS: 2 } });
    for (let i = 0; i < 30; i++) {
      control.step(16.7);
      tuned.step(16.7);
    }
    expect(bytesEqual(captureFrame(control), captureFrame(tuned))).toBe(false);
  });

  it("validates incoming stops exactly like creation (structural garbage throws)", () => {
    const engine = mk({ seed: 8 });
    expect(() =>
      engine.updateOptions({
        palette: { stops: [[0, [1, 2, 3]]] as unknown as EdgeAuraPaletteStops },
      }),
    ).toThrowError(/^edge-aura:/);
  });

  it("ignores `seed` after creation (phases are fixed for the instance's life)", () => {
    const engine = mk({ seed: 42 });
    const before = captureFrame(engine);
    engine.updateOptions({ seed: 43 } as EdgeAuraOptions);
    expect(bytesEqual(before, captureFrame(engine))).toBe(true);
  });

  it("is a no-op after destroy()", () => {
    const engine = mk({ seed: 8 });
    engine.destroy();
    expect(() => engine.updateOptions({ palette: { pastel: 0.5 } })).not.toThrow();
    expect(captureBuffers(engine)).toHaveLength(0); // still draws nothing
  });

  it("commits an in-flight crossfade to its target before applying", () => {
    // Start a long crossfade toward ember, step into the middle of it, then
    // updateOptions — the fade is cancelled and jumped to the ember target, so
    // the frame equals a fresh ember-stops instance stepped to the same elapsed.
    const engine = mk({ seed: 7 });
    engine.step(16);
    engine.setPalette("ember", { crossfadeMs: 1000 });
    engine.step(16); // mid-fade
    engine.updateOptions({}); // empty partial still commits the fade
    const committed = captureFrame(engine);

    const direct = mk({ seed: 7, palette: { stops: EDGE_AURA_PALETTES.ember } });
    direct.step(16);
    direct.step(16);
    expect(bytesEqual(committed, captureFrame(direct))).toBe(true);
  });

  it("keeps a setPalette-selected palette across a palette-section update (no revert to creation stops)", () => {
    // Regression: setPalette must record its stops into the resolved config, so
    // a later updateOptions({ palette }) rebuilds the LUT from the palette on
    // screen — not the creation-time stops. `background: "light"` is the default
    // (a scalar no-op) so it isolates the rebuild path.
    const engine = mk({ seed: 7 });
    engine.setPalette("ocean");
    const oceanFrame = captureFrame(engine);
    const oceanWeight = engine.getNormalization().weight;

    engine.updateOptions({ palette: { background: "light" } });

    // Weight and pixels stay on ocean — a fresh ocean instance is the reference.
    const oceanRef = mk({ seed: 7, palette: { stops: EDGE_AURA_PALETTES.ocean } });
    expect(engine.getNormalization().weight).toBeCloseTo(oceanWeight, 12);
    expect(engine.getNormalization().weight).toBeCloseTo(
      oceanRef.getNormalization().weight,
      12,
    );
    expect(bytesEqual(captureFrame(engine), oceanFrame)).toBe(true);
    // And crucially it did NOT snap back to the creation (opal) default.
    expect(bytesEqual(captureFrame(engine), captureFrame(mk({ seed: 7 })))).toBe(false);
  });

  it("commits an in-flight crossfade to its target even when the same partial rebuilds the LUT", () => {
    // The fade-commit's `paletteLut = fadeToLut` must survive the subsequent
    // applyPalette() — which only holds if setPalette wrote its stops back into
    // the resolved config. A non-empty palette partial exercises applyPalette.
    const engine = mk({ seed: 7 });
    engine.setPalette("ember", { crossfadeMs: 1000 });
    engine.step(16); // mid-fade
    engine.updateOptions({ palette: { background: "light" } });
    const committed = captureFrame(engine);

    const direct = mk({ seed: 7, palette: { stops: EDGE_AURA_PALETTES.ember } });
    direct.step(16);
    expect(bytesEqual(committed, captureFrame(direct))).toBe(true);
  });
});

describe("band self-similarity (bloom depth scale)", () => {
  // The stub viewport is 800×600; the top strip is (W − 2·RIM) wide × BAND tall,
  // row-major, with depth increasing down the rows (see compositeAlpha above).
  const VW = 800;
  const TOP_W = VW - 2 * RIM;
  const MID = Math.floor(TOP_W / 2); // a mid-edge column, far from either corner

  const settleTop = (band: number): Uint8ClampedArray => {
    const engine = mk({ seed: 42, geometry: { band } });
    for (let f = 0; f < 8; f++) engine.step(16.7);
    return captureBuffers(engine)[TILE.top];
  };
  // Alpha byte of the mid column at absolute depth d (row d) of the top strip.
  const midAlphaAt = (top: Uint8ClampedArray, d: number): number =>
    top[(d * TOP_W + MID) * 4 + 3];

  it("(a) matches the mid-column alpha profile at relative depths across bands", () => {
    // The bloom depth falloff is self-similar in `band`, so sampling the SAME
    // relative depths (d/band) on a small band (38) and the default (76) yields
    // the same alpha profile. Tolerance 10/255: the shallowest sample (0.2)
    // carries the largest deviation because the core Gaussian — deliberately
    // NOT band-scaled — still contributes at that shallow absolute depth; the
    // deeper (bloom-dominated) samples match within ~1. Pre-fix the band-38
    // profile was ~{0.2:77, 0.4:34, 0.6:12, 0.8:4} vs band-76 {35,7,2,0} —
    // grossly fatter, i.e. NOT self-similar.
    const small = settleTop(38);
    const def = settleTop(76);
    for (const r of [0.2, 0.4, 0.6, 0.8]) {
      const aSmall = midAlphaAt(small, Math.round(r * 38));
      const aDef = midAlphaAt(def, Math.round(r * 76));
      expect(Math.abs(aSmall - aDef)).toBeLessThanOrEqual(10);
    }
  });

  it("(b) does not hard-crop the inner tail at band 34", () => {
    // Just inside the quartic window end (depth = band − 3 = 31): if the bloom
    // sigma stayed absolute, the still-strong tail would be amputated here,
    // leaving a visible residual (pre-fix worst-case across columns = 5/255).
    // Scaled sigma makes the tail already negligible by this depth, comparable
    // to the default band's residual at its own band − 3 (depth 73 → 0/255).
    const D = 34 - 3;
    const top34 = settleTop(34);
    let maxResidual = 0;
    for (let i = 0; i < TOP_W; i++) {
      const a = top34[(D * TOP_W + i) * 4 + 3];
      if (a > maxResidual) maxResidual = a;
    }
    // Default-band reference residual at its own band − 3.
    const top76 = settleTop(76);
    let defResidual = 0;
    for (let i = 0; i < TOP_W; i++) {
      const a = top76[((76 - 3) * TOP_W + i) * 4 + 3];
      if (a > defResidual) defResidual = a;
    }
    expect(maxResidual).toBeLessThanOrEqual(defResidual + 2); // comparable to default
    expect(maxResidual).toBeLessThan(5); // MUCH smaller than the pre-fix value (5)
  });

  it("(c) the thin preset validates and renders non-zero, NaN-free pixels", () => {
    const engine = mk({ ...EDGE_AURA_PRESETS.thin, seed: 1 });
    engine.step(16.7);
    const frame = captureFrame(engine);
    expect(frame.some((v) => v !== 0)).toBe(true);
    expect(frame.every((v) => Number.isFinite(v))).toBe(true);
    expect(frame.every((v) => v <= 255)).toBe(true);
  });
});
