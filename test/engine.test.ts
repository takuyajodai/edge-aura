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
    engine.setPalette("nebula", { crossfadeMs: 400 });
    // No step yet — the blend origin is an exact snapshot of the old LUT.
    expect(bytesEqual(captureFrame(engine), startFrame)).toBe(true);

    for (let i = 0; i < 12; i++) engine.step(16); // 192 ms ≈ midpoint of 400
    const mid = captureFrame(engine);
    for (let i = 0; i < 15; i++) engine.step(16); // 432 ms total — past the end
    const end = captureFrame(engine);
    expect(bytesEqual(mid, startFrame)).toBe(false);
    expect(bytesEqual(mid, end)).toBe(false);

    // Same seed + same total elapsed → identical steady output by contract.
    const direct = mk({ seed: 7, palette: { stops: EDGE_AURA_PALETTES.nebula } });
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

  it('never runs the pastel step-down under the dark metric (nebula + "dark" keeps effPastel 0.35)', () => {
    // Regression: the step-down loop lowers pastel to DARKEN colors, which
    // only converges under the light metric. Under the dark metric it would
    // diverge (each step lowers weight, growing alphaScale) and crush the
    // user's pastel to 0 — a heavy palette on "dark" must keep it untouched
    // and rely on the alpha clamp alone.
    const dark = mk({
      palette: { stops: EDGE_AURA_PALETTES.nebula, background: "dark" },
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
   * To regenerate after an INTENTIONAL default-appearance change: run this
   * test, copy the "received" hash from the failure output, and update the
   * constant. Any unintentional mismatch is a pixel regression in the default
   * rendering path.
   */
  const SNAPSHOT_SHA256 =
    "32659ee642646576a06da41c2fe41e6c1a1ed64c88c1d477e94819f42e3c669c";

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
  const DARK_SNAPSHOT_SHA256 =
    "aaed867482b51ba7381e82129dacf6b99b221a91024ab8206de20c3bbe6a4243";

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

describe("corner fill (opt-in): square-tube L-path distance field", () => {
  // v0.4.1 rework. cornerFill no longer pastes a radial Gaussian blob over the
  // rounded tube — it switches the corner tile's signed distance to the L-shaped
  // sharp-corner centerline path (tIn = min(ax, ay) in the interior, −hypot in
  // the exterior vertex quadrant) so the SAME tube flows straight through the
  // 90° corner. The arc-sample index keeps the arc's angular parameterization
  // (continuous, converging to the shared vertex/arc-midpoint profile on the
  // diagonal), and the outward feather is disabled. These tests assert the
  // integration: no seam at the tile boundaries, no discontinuity on the
  // diagonal, a near-solid exterior, and a core that runs unbroken through the
  // corner. The stub viewport is 800×600.
  const W = 800, H = 600;
  const CORNERS = [TILE.TL, TILE.TR, TILE.BR, TILE.BL];
  // Engine corner-kind flags, indexed by TILE corner (TL/TR/BR/BL).
  const XNEG: Record<number, boolean> = { [TILE.TL]: true, [TILE.TR]: false, [TILE.BR]: false, [TILE.BL]: true };
  const YNEG: Record<number, boolean> = { [TILE.TL]: true, [TILE.TR]: true, [TILE.BR]: false, [TILE.BL]: false };
  // Tile global origin (top-left) on the composited canvas.
  const ORIGIN: Record<number, [number, number]> = {
    [TILE.TL]: [0, 0], [TILE.TR]: [W - RIM, 0], [TILE.BR]: [W - RIM, H - RIM], [TILE.BL]: [0, H - RIM],
  };

  // The fixed dark 30-frame golden sequence (tap + key), returning the 8 tiles.
  const darkGolden = (options?: EdgeAuraOptions): Uint8ClampedArray[] => {
    const engine = mk({ seed: 42, palette: { background: "dark" }, ...options });
    let bufs: Uint8ClampedArray[] = [];
    for (let frame = 0; frame < 30; frame++) {
      engine.step(16.7);
      if (frame === 10) engine.tap({ x: 200, y: 300 });
      if (frame === 15) engine.key(0.5);
      bufs = captureBuffers(engine);
    }
    return bufs;
  };
  const fillGolden = (band: number) => darkGolden({ geometry: { band, cornerFill: true } });

  // Alpha at global (gx, gy), dispatching to whichever pixel-disjoint tile owns
  // it (4 corners + 4 strips), so seam pixels on either side of a tile boundary
  // read from the same coordinate space. `band` = strip depth.
  const alphaG = (bufs: Uint8ClampedArray[], gx: number, gy: number, band: number): number => {
    const topW = W - 2 * RIM;
    if (gx < RIM && gy < RIM) return bufs[TILE.TL][(gy * RIM + gx) * 4 + 3];
    if (gx >= W - RIM && gy < RIM) return bufs[TILE.TR][(gy * RIM + (gx - (W - RIM))) * 4 + 3];
    if (gx >= W - RIM && gy >= H - RIM) return bufs[TILE.BR][((gy - (H - RIM)) * RIM + (gx - (W - RIM))) * 4 + 3];
    if (gx < RIM && gy >= H - RIM) return bufs[TILE.BL][((gy - (H - RIM)) * RIM + gx) * 4 + 3];
    if (gy < band && gx >= RIM && gx < W - RIM) return bufs[TILE.top][(gy * topW + (gx - RIM)) * 4 + 3];
    if (gy >= H - band && gx >= RIM && gx < W - RIM) return bufs[TILE.bottom][((gy - (H - band)) * topW + (gx - RIM)) * 4 + 3];
    if (gx < band && gy >= RIM && gy < H - RIM) return bufs[TILE.left][((gy - RIM) * band + gx) * 4 + 3];
    if (gx >= W - band && gy >= RIM && gy < H - RIM) return bufs[TILE.right][((gy - RIM) * band + (gx - (W - band))) * 4 + 3];
    throw new Error(`no tile owns global (${gx}, ${gy})`);
  };
  const aTile = (bufs: Uint8ClampedArray[], kind: number, lx: number, ly: number) => bufs[kind][(ly * RIM + lx) * 4 + 3];

  // L-path interior-positive perpendicular distances from the two centerlines
  // (the engine's fill-mode metric): ax from the vertical edge, ay from the
  // horizontal edge; tIn = min(ax, ay) interior, −hypot in the vertex quadrant.
  const axay = (kind: number, lx: number, ly: number): [number, number] => {
    const lcx = XNEG[kind] ? RIM : 0, lcy = YNEG[kind] ? RIM : 0;
    const sx = XNEG[kind] ? 1 : -1, sy = YNEG[kind] ? 1 : -1;
    return [CR + sx * (lx + 0.5 - lcx), CR + sy * (ly + 0.5 - lcy)];
  };
  // Diagonal MIRROR of a pixel (swaps ax↔ay → identical tIn, reflected across
  // the medial-axis diagonal). Main diagonal for TL/BR, anti-diagonal for TR/BL.
  const mirror = (kind: number, lx: number, ly: number): [number, number] =>
    kind === TILE.TL || kind === TILE.BR ? [ly, lx] : [RIM - 1 - ly, RIM - 1 - lx];

  it("default off is byte-identical to omitting the option (light and dark)", () => {
    for (const bg of ["light", "dark"] as const) {
      const omit = mk({ seed: 42, palette: { background: bg } });
      const off = mk({ seed: 42, palette: { background: bg }, geometry: { cornerFill: false } });
      omit.step(16.7);
      off.step(16.7);
      expect(bytesEqual(captureFrame(omit), captureFrame(off))).toBe(true);
    }
  });

  it("on: fills the square viewport-corner exterior where off leaves it transparent", () => {
    const off = darkGolden();
    const on = darkGolden({ geometry: { cornerFill: true } });
    for (const kind of CORNERS) {
      // The physical screen-corner tip pixel (the outermost corner of the tile,
      // in the exterior vertex quadrant) rounds off to transparent, but with the
      // square tube it renders near-solid — the glow flows into the corner.
      const [ox, oy] = ORIGIN[kind];
      const tx = ox === 0 ? 0 : RIM - 1;
      const ty = oy === 0 ? 0 : RIM - 1;
      expect(off[kind][(ty * RIM + tx) * 4 + 3]).toBe(0);
      expect(on[kind][(ty * RIM + tx) * 4 + 3]).toBeGreaterThan(0);
    }
  });

  it("on: tile boundaries meet both adjacent strips within 3/255 (bands 34/76/120, dark)", () => {
    // Each corner tile abuts a horizontal strip (top/bottom) across its vertical
    // seam and a vertical strip (left/right) across its horizontal seam. In fill
    // mode the interior L-path metric min(ax, ay) is EXACTLY the perpendicular
    // depth the strips use, and the arc-sample endpoints match the strips' arc
    // position, so both seams (screen edge → deepest interior) stay continuous.
    for (const band of [34, 76, 120]) {
      const on = fillGolden(band);
      let worst = 0;
      for (const kind of CORNERS) {
        const [ox, oy] = ORIGIN[kind];
        const onLeft = ox === 0;   // tile on the left half → horiz strip to the right
        const onTop = oy === 0;    // tile on the top half → vert strip below
        const tileGx = onLeft ? ox + RIM - 1 : ox;
        const stripGx = onLeft ? ox + RIM : ox - 1;
        for (let gy = oy; gy < oy + RIM; gy++)
          worst = Math.max(worst, Math.abs(alphaG(on, tileGx, gy, band) - alphaG(on, stripGx, gy, band)));
        const tileGy = onTop ? oy + RIM - 1 : oy;
        const stripGy = onTop ? oy + RIM : oy - 1;
        for (let gx = ox; gx < ox + RIM; gx++)
          worst = Math.max(worst, Math.abs(alphaG(on, gx, tileGy, band) - alphaG(on, gx, stripGy, band)));
      }
      expect(worst).toBeLessThanOrEqual(3);
    }
  });

  it("on: the diagonal is seamless — no discontinuity, mirror asymmetry ≤ 6/255 (bands 34/76/120, dark)", () => {
    // The medial-axis diagonal (ax == ay) is where the nearest centerline is
    // ambiguous. The angular arc-sample parameterization is CONTINUOUS across it
    // (it converges to the arc-midpoint profile on the diagonal), so there is no
    // step. Two checks: (1) reflected pixels at EQUAL tIn (swap ax↔ay) differ
    // only by the tube's own hue transition — a slope, not a jump; (2) the max
    // adjacent-pixel step among pairs STRADDLING the diagonal is no larger than
    // among all interior pairs, i.e. the diagonal adds no discontinuity (both are
    // just the steep radial core gradient).
    for (const band of [34, 76, 120]) {
      const on = fillGolden(band);
      let mirrorMax = 0, straddleMax = 0, generalMax = 0;
      for (const kind of CORNERS) {
        for (let ly = 0; ly < RIM; ly++) for (let lx = 0; lx < RIM; lx++) {
          const [ax, ay] = axay(kind, lx, ly);
          if (Math.min(ax, ay) <= 0.5) continue; // interior, off the centerline
          // (1) equal-tIn reflection asymmetry, restricted to pixels near the
          // diagonal (the crossing region).
          if (Math.abs(ax - ay) <= 1.5) {
            const [mx, my] = mirror(kind, lx, ly);
            if (mx !== lx || my !== ly)
              mirrorMax = Math.max(mirrorMax, Math.abs(aTile(on, kind, lx, ly) - aTile(on, kind, mx, my)));
          }
          // (2) adjacent-step comparison: straddling the diagonal vs all pairs.
          for (const [nx, ny] of [[lx + 1, ly], [lx, ly + 1]] as const) {
            if (nx >= RIM || ny >= RIM) continue;
            const [ax1, ay1] = axay(kind, nx, ny);
            if (Math.min(ax1, ay1) <= 0.5) continue;
            const step = Math.abs(aTile(on, kind, lx, ly) - aTile(on, kind, nx, ny));
            generalMax = Math.max(generalMax, step);
            if (Math.sign(ax - ay) !== Math.sign(ax1 - ay1)) straddleMax = Math.max(straddleMax, step);
          }
        }
      }
      expect(mirrorMax).toBeLessThanOrEqual(6);
      // No extra step at the diagonal: straddling pairs jump no more than the
      // worst interior pair anywhere (the radial core gradient), so the diagonal
      // is not a visible seam.
      expect(straddleMax).toBeLessThanOrEqual(generalMax);
    }
  });

  it("on: exterior vertex renders near-solid, matching the straights' outward margin (dark)", () => {
    // The exterior vertex quadrant (both ax, ay < 0 → tIn = −hypot) keeps the
    // flat centerline value (t = 0, no feather), so it renders near-solid — the
    // same way a straight's outward margin (also t = 0, feather ≡ 1) reads. Also
    // asserts every filled corner buffer stays finite and never over-opaque.
    const on = fillGolden(76);
    // Straight outward margin: the top strip's shallowest row (gy = 0, tIn=-2.5).
    const margin: number[] = [];
    for (let gx = RIM; gx < RIM + 60; gx++) margin.push(alphaG(on, gx, 0, 76));
    const marginVal = margin.reduce((a, b) => a + b, 0) / margin.length;
    let vMin = 255, vMax = 0;
    for (const kind of CORNERS) {
      expect(on[kind].every((v) => Number.isFinite(v) && v <= 255)).toBe(true);
      for (let ly = 0; ly < RIM; ly++) for (let lx = 0; lx < RIM; lx++) {
        const [ax, ay] = axay(kind, lx, ly);
        if (ax < 0 && ay < 0) {
          const v = aTile(on, kind, lx, ly);
          vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
        }
      }
    }
    expect(vMin).toBeGreaterThan(0); // genuinely near-solid, not transparent
    expect(Math.abs(vMin - marginVal)).toBeLessThanOrEqual(2);
    expect(Math.abs(vMax - marginVal)).toBeLessThanOrEqual(2);
  });

  it("on: the core line runs continuously through the corner — no dip > 3/255 (dark)", () => {
    // The core line lives at the centerline (tIn ≈ 0.5). In fill mode it runs
    // straight along each edge into the 90° corner (tIn stays ≈ 0.5 through the
    // vertex junction), so the near-centerline alpha must not dip at the corner
    // relative to a mid-edge strip column. Collect the tile's near-centerline
    // pixels (both L arms) and the top strip's centerline, and bound the spread.
    const on = fillGolden(76);
    const core: number[] = [];
    for (const kind of CORNERS)
      for (let ly = 0; ly < RIM; ly++) for (let lx = 0; lx < RIM; lx++) {
        const [ax, ay] = axay(kind, lx, ly);
        if (Math.abs(Math.min(ax, ay) - 0.5) < 1e-6) core.push(aTile(on, kind, lx, ly));
      }
    for (let i = 0; i < 40; i++) core.push(alphaG(on, RIM + i, INSET, 76)); // strip centerline (tIn ≈ 0.5)
    expect(core.length).toBeGreaterThan(0);
    expect(Math.max(...core) - Math.min(...core)).toBeLessThanOrEqual(3);
  });

  it("is togglable live via updateOptions (matches a fresh cornerFill instance)", () => {
    const engine = mk({ seed: 42, geometry: { cornerFill: false } });
    engine.step(16.7);
    // TL screen-corner tip is buffer pixel (0, 0).
    const tipIdx = 3;
    const tipBefore = captureBuffers(engine)[TILE.TL][tipIdx];
    expect(tipBefore).toBe(0); // rounded off before the toggle

    engine.updateOptions({ geometry: { cornerFill: true } });
    // Equals a fresh instance created with cornerFill on, stepped the same.
    const fresh = mk({ seed: 42, geometry: { cornerFill: true } });
    // engine already stepped once; step both to the same elapsed and compare.
    fresh.step(16.7);
    engine.step(16.7);
    fresh.step(16.7);
    expect(bytesEqual(captureFrame(engine), captureFrame(fresh))).toBe(true);
    const tipAfter = captureBuffers(engine)[TILE.TL][tipIdx];
    expect(tipAfter).toBeGreaterThan(0); // corner now filled
  });
});

describe("corner-continuity seam (v0.4: live corner tile + deep-only diagonal crossfade)", () => {
  // v0.4 restructure. The corner TILE now renders the periodic ring field LIVE
  // per pixel (drawCorner does neonAt(s0 + f·ARC) again), so the undulation
  // flows through the corner interior instead of freezing to a snapshot — that
  // was the whole point of the v0.4 seamless work, and it is what these tests
  // must not silently allow to regress.
  //
  // Two residual seams remain and are gated here:
  //  • The 45° ownership DIAGONAL between two strips is an intrinsic
  //    medial-axis discontinuity in the arc-position parameterization (the
  //    nearest-centerline point branches there; the two owning strips sample
  //    arc positions that diverge with depth). Periodicity does NOT remove it —
  //    measured with the crossfade deleted it reaches 16–31/255 on dark — so a
  //    MINIMAL deep-only crossfade to a shared per-corner midpoint profile is
  //    retained, converging both owners exactly at the cut depth (≤ 2/255).
  //  • The TL TILE BOUNDARY is the s = 0 / perimeter wrap side. The periodic
  //    field is continuous across it and the tile + strips are both live there,
  //    so the step stays small (≤ 3/255; ~2 of that is genuine live-field
  //    variation across the ~1 px arc-end plus the ±0.5-LSB dither on each
  //    side — no longer a frozen-snapshot match, so it cannot be driven to 0).
  //
  // The stub viewport is 800×600 (installStubDom() default); the engine sizes
  // its canvas from window.innerWidth/Height.
  const VW = 800, VH = 600;

  // Source-over composite of the 8 disjoint tiles into a W×H alpha grid — the
  // real engine composites via drawImage (transparent pixels don't overwrite),
  // so only paint where the source alpha > 0.
  const compositeAlpha = (
    bufs: Uint8ClampedArray[],
    W: number,
    H: number,
    BAND: number,
  ): Float64Array => {
    const A = new Float64Array(W * H);
    const CQ = RIM;
    const put = (buf: Uint8ClampedArray, bw: number, bh: number, ox: number, oy: number) => {
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const bi = (y * bw + x) * 4;
          if (buf[bi + 3] === 0) continue;
          A[(oy + y) * W + (ox + x)] = buf[bi + 3];
        }
      }
    };
    const topW = W - 2 * RIM, leftH = H - 2 * RIM;
    put(bufs[TILE.top], topW, BAND, RIM, 0);
    put(bufs[TILE.bottom], topW, BAND, RIM, H - BAND);
    put(bufs[TILE.left], BAND, leftH, 0, RIM);
    put(bufs[TILE.right], BAND, leftH, W - BAND, RIM);
    put(bufs[TILE.TL], CQ, CQ, 0, 0);
    put(bufs[TILE.TR], CQ, CQ, W - CQ, 0);
    put(bufs[TILE.BR], CQ, CQ, W - CQ, H - CQ);
    put(bufs[TILE.BL], CQ, CQ, 0, H - CQ);
    return A;
  };

  // Max |Δalpha| across the 45° ownership diagonal at each corner, over ring
  // depths [RIM, dHi]: the two owning strips' pixels straddling the diagonal sit
  // at equal ring depth and must agree (both converge to the shared corner
  // profile at the cut depth). Property preserved from the previous whole-column
  // blend; here it must survive the switch to a depth crossfade.
  const maxDiagonalSeam = (A: Float64Array, W: number, H: number, BAND: number): number => {
    const at = (x: number, y: number) => A[y * W + x];
    const dHi = Math.min(BAND - 1, 70);
    let m = 0;
    for (let D = RIM; D <= dHi; D++) {
      const k = D - RIM;
      // TL: top (RIM+k, RIM+k) vs left (RIM+k, RIM+k+1)
      m = Math.max(m, Math.abs(at(RIM + k, RIM + k) - at(RIM + k, RIM + k + 1)));
      // TR: top (W-1-(RIM+k), RIM+k) vs right (W-1-(RIM+k), RIM+k+1)
      m = Math.max(
        m,
        Math.abs(at(W - 1 - (RIM + k), RIM + k) - at(W - 1 - (RIM + k), RIM + k + 1)),
      );
      // BR: bottom (W-1-(RIM+k), H-1-(RIM+k)) vs right (…, -1 in y)
      m = Math.max(
        m,
        Math.abs(
          at(W - 1 - (RIM + k), H - 1 - (RIM + k)) -
            at(W - 1 - (RIM + k), H - 1 - (RIM + k) - 1),
        ),
      );
      // BL: bottom (RIM+k, H-1-(RIM+k)) vs left (…, -1 in y)
      m = Math.max(
        m,
        Math.abs(at(RIM + k, H - 1 - (RIM + k)) - at(RIM + k, H - 1 - (RIM + k) - 1)),
      );
    }
    return m;
  };

  // TL corner-tile boundary step: tile right edge (x=RIM-1) vs top strip left
  // column (x=RIM) over shallow rows, and tile bottom edge (y=RIM-1) vs left
  // strip top row (y=RIM) over shallow cols. This is the s=0 noise-wrap side.
  const tlTileBoundaryStep = (A: Float64Array, W: number): number => {
    const at = (x: number, y: number) => A[y * W + x];
    let m = 0;
    for (let y = 0; y < RIM; y++) m = Math.max(m, Math.abs(at(RIM - 1, y) - at(RIM, y)));
    for (let x = 0; x < RIM; x++) m = Math.max(m, Math.abs(at(x, RIM - 1) - at(x, RIM)));
    return m;
  };

  // Fraction of near-corner column pairs that DIFFER at inner-bloom depths — a
  // proxy for live per-column noise (a frozen band would render every near-
  // corner column identically → ~0). Columns are compared 8 APART (i vs i+8),
  // not adjacent: the G2b ordered dither keys on (px&7, py&7), so 8-px-apart
  // columns fall in the SAME Bayer cell and the dither cancels exactly — any
  // surviving byte difference is real field variation, not dither. (Comparing
  // adjacent columns would trivially "pass" from the 1-LSB dither alone,
  // defeating the guard.) With the live field this sits near the natural
  // mid-edge rate; a re-frozen corner would collapse it back toward 0.
  const nearCornerLiveness = (top: Uint8ClampedArray, W: number): number => {
    const topW = W - 2 * RIM;
    const rowStride = topW * 4;
    let distinct = 0, total = 0;
    for (let d = 8; d <= 30; d++) {
      for (let i = 12; i < 60; i++) {
        const a = d * rowStride + i * 4;
        const b = d * rowStride + (i + 8) * 4;
        const same =
          top[a] === top[b] && top[a + 1] === top[b + 1] &&
          top[a + 2] === top[b + 2] && top[a + 3] === top[b + 3];
        if (!same) distinct++;
        total++;
      }
    }
    return distinct / total;
  };

  const settle = (band: number) => {
    const engine = mk({ seed: 42, geometry: { band }, palette: { background: "dark" } });
    for (let f = 0; f < 8; f++) engine.step(16.7);
    return engine;
  };

  // band 34 added with the bloom-scale fix: the scaled sbIn drives the corner
  // reach / diagonal-cut clip, so the seam must stay nulled at small band too.
  it.each([34, 76, 120])(
    "nulls the diagonal seam at all four corners (band %i, dark) ≤ 2/255",
    (band) => {
      const bufs = captureBuffers(settle(band));
      const A = compositeAlpha(bufs, VW, VH, band);
      expect(maxDiagonalSeam(A, VW, VH, band)).toBeLessThanOrEqual(2);
    },
  );

  it.each([34, 76, 120])(
    "keeps the TL corner-tile boundary step ≤ 3/255 (band %i, dark)",
    (band) => {
      const bufs = captureBuffers(settle(band));
      const A = compositeAlpha(bufs, VW, VH, band);
      expect(tlTileBoundaryStep(A, VW)).toBeLessThanOrEqual(3);
    },
  );

  it.each([34, 76, 120])(
    "keeps live per-column noise near the corners (band %i)",
    (band) => {
      const bufs = captureBuffers(settle(band));
      // Dither-cancelled metric (columns 8 apart): a re-frozen corner collapses
      // this toward 0, the live periodic field keeps it well above the 0.05
      // gate.
      expect(nearCornerLiveness(bufs[TILE.top], VW)).toBeGreaterThan(0.05);
    },
  );
});

describe("palette determinism (stops, not name)", () => {
  it("'spectrum' by name renders byte-identically to the same stops passed inline", () => {
    // Proves the engine keys rendering off the stop values, not the preset
    // name: a manually-supplied array equal to spectrum must be byte-equal.
    // hueDriftDeg 0 + highlight off keeps the frame purely stops-driven.
    const inlineSpectrum: EdgeAuraPaletteStops = [
      [0, [33, 212, 154]],
      [0.12, [20, 212, 196]],
      [0.26, [56, 170, 255]],
      [0.4, [139, 92, 246]],
      [0.52, [236, 72, 153]],
      [0.63, [249, 115, 22]],
      [0.73, [251, 191, 36]],
      [0.85, [74, 222, 128]],
      [1.0, [33, 212, 154]],
    ];
    const byName = mk({
      seed: 1,
      palette: { stops: EDGE_AURA_PALETTES.spectrum },
      motion: { hueDriftDeg: 0 },
    });
    const byStops = mk({
      seed: 1,
      palette: { stops: inlineSpectrum },
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
    // Start a long crossfade toward nebula, step into the middle of it, then
    // updateOptions — the fade is cancelled and jumped to the nebula target, so
    // the frame equals a fresh nebula-stops instance stepped to the same elapsed.
    const engine = mk({ seed: 7 });
    engine.step(16);
    engine.setPalette("nebula", { crossfadeMs: 1000 });
    engine.step(16); // mid-fade
    engine.updateOptions({}); // empty partial still commits the fade
    const committed = captureFrame(engine);

    const direct = mk({ seed: 7, palette: { stops: EDGE_AURA_PALETTES.nebula } });
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
    engine.setPalette("nebula", { crossfadeMs: 1000 });
    engine.step(16); // mid-fade
    engine.updateOptions({ palette: { background: "light" } });
    const committed = captureFrame(engine);

    const direct = mk({ seed: 7, palette: { stops: EDGE_AURA_PALETTES.nebula } });
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
