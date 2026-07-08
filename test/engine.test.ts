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
  EDGE_AURA_PALETTES,
  EDGE_AURA_PRESETS,
  NORMALIZE_REF,
  NORMALIZE_REF_DARK,
  type EdgeAuraOptions,
  type EdgeAuraPaletteStops,
} from "../src/index";

const mk = (options?: EdgeAuraOptions) => createAuraEngine(newCanvas(), options);

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

  it("keeps the stock siri palette at scale exactly 1 on both backgrounds", () => {
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
   * To regenerate after an INTENTIONAL default-appearance change: run this
   * test, copy the "received" hash from the failure output, and update the
   * constant (or temporarily `console.log(hash)` below). Any unintentional
   * mismatch is a pixel regression in the default rendering path.
   */
  const SNAPSHOT_SHA256 =
    "4ba17f92239a04a0bc9c35795ee8669adc9a15e5cc7aaff89e2c672e112fd0ee";

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
