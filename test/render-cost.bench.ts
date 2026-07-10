// @vitest-environment node
/**
 * Render-cost benchmark — reproducible, IN-PROCESS A/B delta for the corner
 * model's overhead over the single-source baseline.
 *
 * Run with `npm run bench` (vitest bench). NOT part of `npm test`
 * (vitest.config's test.include only matches *.test.ts) and not shipped (the
 * package.json `files` whitelist covers only dist/).
 *
 * Methodology (why this file is not a plain `bench()` pair): the corner budget
 * is a RELATIVE number — live engine vs the pre-additive single-source engine —
 * and two isolated tinybench runs (all A samples, then all B samples) drift
 * apart on thermal/JIT noise, so the ratio can't be substantiated. Instead we
 * vendor main's engine frozen under test/_baseline/ (the single-source
 * baseline), import BOTH, and interleave: each batch times R iterations of the
 * baseline then R of the live engine back-to-back, so any slow drift hits both
 * equally. We collect per-batch medians and report median(live)/median(base) −
 * 1. The A/B pair shares one warmed process; only the corner code differs.
 *
 * The MULTI-SOURCE ADDITIVE corner model sums the two adjacent straights' blooms
 * plus the arc's inward spill at every near-corner pixel (S3/S4/S5). That work
 * scales with BAND² per corner and, corners being a fixed-geometry region, grows
 * as a fraction of the ring on smaller viewports — hence the per-viewport table.
 */
import { bench } from "vitest";
import { installStubDom, newCanvas } from "./harness";
import { createAuraEngine as createLive } from "../src/index";
import { createAuraEngine as createBaseline } from "./_baseline/engine";

installStubDom();

type Bg = "dark" | "light";
interface Case { name: string; w: number; h: number; band: number; bg: Bg }
const cases: Case[] = [
  { name: "desktop 1440x900 band 76", w: 1440, h: 900, band: 76, bg: "dark" },
  { name: "window  800x600  band 76 (GOLDEN)", w: 800, h: 600, band: 76, bg: "dark" },
  { name: "window  800x600  band 120", w: 800, h: 600, band: 120, bg: "dark" },
  { name: "window  800x600  band 76 (light)", w: 800, h: 600, band: 76, bg: "light" },
  { name: "mobile  390x844  band 76", w: 390, h: 844, band: 76, bg: "dark" },
];

const win = globalThis as unknown as { window: { innerWidth: number; innerHeight: number } };

// One engine of `kind`, warmed 30 frames so springs + JIT are settled.
const build = (c: Case, kind: "base" | "live") => {
  win.window.innerWidth = c.w;
  win.window.innerHeight = c.h;
  const make = kind === "base" ? createBaseline : createLive;
  const e = make(newCanvas(), { seed: 42, geometry: { band: c.band }, palette: { background: c.bg } });
  for (let f = 0; f < 30; f++) e.step(16.7);
  return e;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Interleaved A/B measurement: BATCHES batches, each timing R step+render iters
// of the baseline then the live engine back-to-back. Returns per-batch medians.
const measure = (c: Case, R = 60, BATCHES = 25, WARM = 5) => {
  const base = build(c, "base");
  const live = build(c, "live");
  const runN = (e: { step(dt: number): void; render(): void }, n: number) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { e.step(16.7); e.render(); }
    return performance.now() - t0;
  };
  const aT: number[] = [], bT: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const a = runN(base, R);
    const b = runN(live, R);
    if (batch >= WARM) { aT.push(a / R); bT.push(b / R); }
  }
  const ma = median(aT), mb = median(bT);
  return { baseMs: ma, liveMs: mb, deltaPct: (mb / ma - 1) * 100 };
};

// -- cornerFill (v3) overhead: fill mode vs round mode (both LIVE) -----------
// Fill mode is opt-in and uses the SAME additive field as round mode; its only
// extra cost is that the corner-tile pocket pixels — which round mode early-outs
// or feathers to ~0 — now run the arc's outward Gaussian and get written. That
// is ~the square-corner pocket area per corner (≈ RIM² − πCR²/4). Interleaved
// round-live vs fill-live at the requested bands (window 800×600, dark). No hard
// budget — fill is opt-in; these are honest numbers.
const buildFill = (band: number, fill: boolean) => {
  win.window.innerWidth = 800;
  win.window.innerHeight = 600;
  const e = createLive(newCanvas(), { seed: 42, geometry: { band, cornerFill: fill }, palette: { background: "dark" } });
  for (let f = 0; f < 30; f++) e.step(16.7);
  return e;
};
const measureFill = (band: number, R = 60, BATCHES = 25, WARM = 5) => {
  const round = buildFill(band, false);
  const fill = buildFill(band, true);
  const runN = (e: { step(dt: number): void; render(): void }, n: number) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { e.step(16.7); e.render(); }
    return performance.now() - t0;
  };
  const rT: number[] = [], fT: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const r = runN(round, R);
    const f = runN(fill, R);
    if (batch >= WARM) { rT.push(r / R); fT.push(f / R); }
  }
  const mr = median(rT), mf = median(fT);
  return { roundMs: mr, fillMs: mf, deltaPct: (mf / mr - 1) * 100 };
};
/* eslint-disable no-console */
console.log("\n=== cornerFill overhead: fill mode vs round mode (interleaved, per-frame median, 800x600 dark) ===");
console.log("band     round(ms)  fill(ms)   delta");
for (const band of [34, 76, 120]) {
  const r = measureFill(band);
  console.log(
    `${String(band).padEnd(8)} ${r.roundMs.toFixed(3).padStart(8)} ${r.fillMs.toFixed(3).padStart(9)} ` +
    `${(r.deltaPct >= 0 ? "+" : "") + r.deltaPct.toFixed(1) + "%"}`.padStart(9),
  );
}
console.log("");
/* eslint-enable no-console */

// vitest bench executes this file during collection; print the authoritative
// interleaved table here. The single registered bench below is a placeholder so
// `vitest bench` has a benchmark to run (the table above is the real result).
const BUDGET: Record<string, number> = {
  "desktop 1440x900 band 76": 12,
  "window  800x600  band 76 (GOLDEN)": 12,
  "window  800x600  band 120": 15,
  "window  800x600  band 76 (light)": 12,
  "mobile  390x844  band 76": 15,
};
/* eslint-disable no-console */
console.log("\n=== corner-model overhead vs single-source baseline (interleaved, per-frame median) ===");
console.log("case                                     base(ms)  live(ms)   delta   budget");
for (const c of cases) {
  const r = measure(c);
  const bud = BUDGET[c.name] ?? 12;
  const ok = r.deltaPct <= bud ? "ok" : "OVER";
  console.log(
    `${c.name.padEnd(40)} ${r.baseMs.toFixed(3).padStart(8)} ${r.liveMs.toFixed(3).padStart(9)} ` +
    `${(r.deltaPct >= 0 ? "+" : "") + r.deltaPct.toFixed(1) + "%"} `.padStart(9) +
    `  ≤${bud}%  ${ok}`,
  );
}
console.log("");
/* eslint-enable no-console */

// Placeholder so `vitest bench` has a registered benchmark; the interleaved
// table printed above is the authoritative, reproducible delta.
bench("interleaved corner-model delta (see table above)", () => {});
