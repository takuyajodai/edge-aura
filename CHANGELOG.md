# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-07-11

### Changed

- **Visual — bent-tube corners:** the corner neighborhood renders as light
  from a physically bent tube (multi-source additive model: both adjacent
  straights + the arc, p=3 norm with an explicit concentration ceiling).
  The bend interior now glows slightly brighter than a straight section at
  equal distance (as a real bent tube does), the organic undulation flows
  through the bend at full amplitude (the deep frozen-crossfade zone is
  gone), and all corner seams stay ≤ 2/255 by construction. Frame cost
  +≈12% at the reference scene, up to +27% at extreme band/small
  viewports (inherent to genuinely three-branch corner pixels; measured
  with a new in-process A/B benchmark, `npm run bench`).
- **Breaking — `cornerFill` v3:** fill mode now keeps the rounded bend
  (`cornerRadius` fully meaningful) and lights the pocket beyond the arc
  with the same additive field — seamless at the arc by construction, the
  pocket decaying toward the corner tip. The 0.4.x square-tube (L-path)
  fill look is gone. Fill overhead vs round: +1–3% (opt-in).
- **Breaking — palettes pruned to 7:** new `ember` (molten crimson→
  white-hot flare; dramatic on dark) and `ultraviolet` (electric violet
  synthwave); removed `spectrum` (legacy rainbow), `candy` (overlapped
  sakura) and `nebula` (superseded by ultraviolet).
- Demo: sliding-pill segmented controls (240 ms, gentle overshoot,
  keyboard/wrap/reduced-motion safe); segmented rows stay on one line on
  mobile via hidden-scrollbar horizontal scroll with edge-fade
  affordances; hero subtitle fits one line at desktop ("edge of your
  screen"); beam-style footer attribution; optically balanced copy-button
  padding.

## [0.4.1] - 2026-07-11

### Changed

- `cornerFill` reworked from a pasted-on radial glow into a single L-path
  distance field: in fill mode the corner IS the same tube flowing through
  a square 90° corner (exact signed distance to the sharp-corner
  centerline; identical core+bloom profile as the straights; exterior
  vertex near-solid within 0.5/255 of the straights' outward margin; core
  continuity through the corner within 1/255). Default off remains
  byte-identical.
- Demo design pass: hero/wordmark set in Lora (roman — a Plantin-class
  old-style substitute, chosen over Source Serif 4 / PT Serif / STIX Two by
  side-by-side comparison); segmented-control active state flattened to a
  hairline ring (accent underline removed); the scrolled header background
  and divider bleed full viewport width; Palette/Preset rows centered and
  single-line in EN; breathing room above the Corners row; the ja footer
  says "Made by".

## [0.4.0] - 2026-07-10

### Added

- `geometry.cornerFill?: boolean` (default `false`) — opt-in: fill the
  square viewport corners with a smooth radial continuation of the glow
  (Gaussian falloff with σ = max(outward bloom σ, 0.75·cornerRadius), C0/C1
  continuous at the arc) instead of rounding off. Live-togglable via
  `updateOptions`; the demo gains a Rounded/Filled control.
- 8×8 Bayer ordered dithering at alpha quantization — breaks the 1/255
  mach-band contours at the bloom tail so the inner edge dissolves
  imperceptibly into the background (mean-preserving, ≤1 LSB everywhere).

### Changed

- **Visual:** the five noise streams are now periodic in the ring (integer
  harmonics of the ring angle, re-derived with geometry) — the undulation
  flows continuously through the corners and the palette-wrap seam is
  structurally zero; corner tiles render the live field instead of a frozen
  arc-midpoint snapshot. The 45° ownership diagonal is an intrinsic
  medial-axis discontinuity of the arc parameterization (not a noise
  artifact) and keeps a minimal depth-crossfade (measured ≤1/255).
- **Visual:** the inner window is C1 — `smoothstep(1 − x⁴)` reaches zero
  with zero slope (the old `1 − x⁴` ended at slope −4, a perceptible edge).
- `darkAlphaGamma` LUT input resolution raised 256 → 4096: the smallest
  non-zero dark alpha drops ~12/255 → ~2.6/255, removing the stippled
  terminus cliff on dark backgrounds (terminal step now ≤3/255).
- Default rendered pixels change by design (both golden snapshots
  regenerated). Frame cost +≈9% (within the 10% budget).
- Demo: hero title and wordmark set in Fraunces (editorial serif);
  the highlight slider now displays its arc as a percentage of the ring and
  the hue-drift caption explains the hue-wheel unit.

## [0.3.2] - 2026-07-10

### Fixed

- Small `band` values looked hard-cropped: the bloom's depth-falloff sigmas
  were absolute pixels, so a thin band amputated a still-strong tail and the
  inner-edge undulation stayed absolute (relatively flat). The depth profile
  is now self-similar in `band` — the sigma family (base, noise range,
  energy swells, clamp bounds, `innerSigmaMax`) scales by `band / 76` — so a
  thin ring keeps the same organic dissolve, proportionally. `band: 76`
  (default) is byte-identical (both golden snapshots unchanged). The `thin`
  preset drops its manual `innerSigmaMax` override, which hand-approximated
  exactly this scaling and would now double-shrink.

## [0.3.1] - 2026-07-10

### Fixed

- Dark backgrounds rendered at half the intended alpha: the demo spread
  `EDGE_AURA_DEFAULTS.palette` into its options, pinning the *light*
  `normalizeTarget` (and `coreWhiten`) as explicit user values, which
  clamped `effRingAlpha` to the 0.45 floor. The engine's by-background
  default resolution was already correct and is now locked by regression
  tests (default opal on dark → `effRingAlpha` 0.90; live background flips
  re-resolve the default; explicit user targets survive flips).
- Near-corner "frozen noise" bands at large `band` values: the corner-seam
  profile snapshot froze entire columns; now a depth crossfade keeps shallow
  pixels on each column's live noise and converges to the shared corner
  profile exactly at the ownership-diagonal cut (seam stays 0/255 at
  band 76 and 120; mid-edge pixels byte-identical).

### Changed

- Dark-background defaults tuned brighter: `coreWhiten` 0.35 (was 0.32),
  `darkChroma` 1.25 (was 1.15).
- Demo: the glow overlay now paints above the page chrome and the header is
  transparent-inset (no more header/edge overlap), gaining a translucent
  panel only after scroll; hairline shadows replace the heavy ones; every
  playground control has a one-line EN/JA caption; the dark theme showcases
  `blendMode: "plus-lighter"` (reflected in the generated snippet).

## [0.3.0] - 2026-07-09

### Added

- Dark-background rendering pipeline (all gated on
  `palette.background: "dark"`): `darkAlphaGamma` (default `0.55`) remaps the
  emitted alpha through a concave curve so the bloom survives sRGB
  source-over compositing on dark pages (the halo was previously 2.8–6.9×
  too dark); `darkChroma` (default `1.15`) applies a lightness-preserving
  Oklab chroma lift to the LUT; the dark default `coreWhiten` rises to
  `0.32` and the normalization alpha floor to `0.45`; opt-in
  `palette.blendMode: "screen" | "plus-lighter"` sets an additive
  `mix-blend-mode` on the canvas (never applied on light backgrounds).
- `palette.interpolation: "srgb" | "oklab"` — opt-in Oklab LUT
  interpolation for custom palettes with widely-spaced stops.
- Organic motion: `motion.hueDriftDeg` / `hueDriftPeriodS` (defaults
  `10` / `12`) add a slow bounded hue oscillation on top of the ring
  rotation; opt-in `motion.highlight { arcDeg, periodS, min }` sweeps a
  raised-cosine bloom highlight around the perimeter.
- `engine.updateOptions(partial)` — live option tuning (geometry realloc,
  palette/LUT rebuild, motion/input scalars) with creation-equivalent
  validation; `seed` is ignored after creation. The React `options` prop is
  now **reactive** (section-wise diff applied via `updateOptions`).
- React adapter now stops the animation loop while the document is hidden
  (`visibilitychange`), composing with `active` and
  `prefers-reduced-motion`.
- Demo rebuilt as a product landing page: EN/日本語 language toggle and
  light/dark theme toggle in the header, live playground sliders, an
  auto-generated copyable `<EdgeAura …/>` snippet reflecting the current
  controls, and installation/usage sections.

### Changed

- **Breaking:** the default palette `siri` is renamed **`opal`** and its
  stops are redesigned (non-uniform mesh with a warm knot and a long cool
  exhale, replacing the uniform rainbow). The previous rainbow stops remain
  available as **`spectrum`**. `NORMALIZE_REF` / `NORMALIZE_REF_DARK` are
  recomputed for the new default.
- **Breaking (visual):** viewport corners now round off — the glow ends with
  a 1.5 px feather ~`inset` px beyond the centerline arc instead of
  flat-filling the square corner with peak alpha. Straight edges are
  byte-identical.
- Package description and keywords no longer reference third-party
  assistant brands.

### Fixed

- Corner bloom continuity: eliminated the 45° brightness seam along the
  corner ownership diagonals (up to 40/255) and the larger noise-wrap seam
  at one corner-tile boundary (62/255) by evaluating corner-zone bloom
  profiles from a shared per-corner snapshot with a smoothstep crossfade.
  Mid-edge pixels are unchanged.

## [0.2.0] - 2026-07-08

### Added

- `engine.setPalette(palette, { crossfadeMs? })` — swap the ring's palette at
  runtime. Accepts a preset name or a raw stop array (validated like the
  creation-time option); the LUT is rebuilt through the same
  perceptual-normalization pipeline as creation. `crossfadeMs > 0` blends
  linearly from the old palette to the new one, advanced by `step()`.
- `palette.background: "light" | "dark"` option — normalization can now
  equalize palettes against dark pages (weight metric flips to
  distance-from-black). New `NORMALIZE_REF_DARK` export is the
  dark-background default `normalizeTarget`.
- `EDGE_AURA_PRESETS` appearance presets (`subtle`, `vivid`, `calm`, `thin`)
  and the `EdgeAuraPresetName` type — plain `EdgeAuraOptions` bundles meant
  to be spread and overridden.
- React `palette` prop (reactive): overrides `options.palette.stops` at
  mount; later changes crossfade the live engine to the new palette (350 ms).
- React `active` prop (reactive, default `true`): `false` stops the
  animation loop and freezes the last frame; `true` restarts it.
  `prefers-reduced-motion` still wins.
- `pulse(energy?)` — ambient pulse with an optional energy override.
- Top-level `seed` option: deterministic noise phases (mulberry32) for
  reproducible rendering in tests/QA.
- `kindleSoftPx` motion option: soft width of the kindle reveal wavefront
  (previously hardcoded).
- Palette-stop validation: structurally invalid stops throw
  `Error("edge-aura: …")` at creation/`setPalette` time; numeric scalar
  options are clamped to safe ranges and non-finite values fall back to the
  defaults instead of crashing the host.
- Vitest test suite (`test/`): engine tests on a stub-canvas harness (seed
  determinism, validation, dt guard, `setPalette`, background normalization,
  a golden pixel-snapshot hash) and a React adapter suite (jsdom, mocked
  engine). `npm test` / `npm run test:watch`.
- GitHub Actions CI: typecheck, build, `check:dist`, tests, and demo build on
  every push and pull request.
- `check:dist` publish gate (wired into `prepublishOnly`): dist entry paths
  exist, the `"use client"` directive survives, and the core chunk graph is
  react-free.
- This changelog.

### Changed

- **Breaking:** `engine.key(x, y)` → `engine.key(x)` — `x` is the documented
  0..1 bottom-edge fraction; the dead `y` parameter is gone
  (`keyCodeToPosition` still returns `{ x, y }`, and now also covers JIS/ISO
  international keys).
- **Breaking:** wrapper class names renamed `editing-aura` / `aura-canvas` →
  `edge-aura` / `edge-aura-canvas`.
- `<EdgeAura>` props `state` / `savedAt` are now optional (`"idle"` / `0`
  defaults) and the component ships default inline styles — a zero-config
  full-viewport click-through overlay — with new `className` / `style`
  passthrough (`style` is merged after the defaults, so any of them can be
  overridden).
- `engine.savedPulse()` is deprecated in favor of `pulse()` (kept as an
  alias).
- `PaletteStops` type is deprecated in favor of `EdgeAuraPaletteStops`;
  `EdgeAuraPaletteStop` is now a strict `[position, [r, g, b]]` tuple.
- `destroy()` sets a destroyed flag: `step`/`render`/`renderStatic`/
  `setPalette` become no-ops, so a stray host callback can never draw into a
  cleared canvas.
- `step()` guards against negative/`NaN` `dtMs` (treated as 0).

### Fixed

- tsdown upgraded to 0.22.3 so the declared `.d.ts` entry paths are actually
  emitted — TypeScript consumers of 0.1.0 got TS7016 because
  `dist/index.d.ts` / `dist/react.d.ts` did not exist.
- `process.env.NODE_ENV` access is `typeof`-guarded, so importing the
  published ESM without a bundler define (CDN module script, import map,
  Deno) no longer throws `ReferenceError`.
- React adapter no longer leaks rAF loops across `prefers-reduced-motion`
  transitions: no loop under reduced motion, exactly one loop otherwise, and
  nothing fires after unmount in any transition order.

### Removed

- **Breaking:** `EDIT_AURA_PALETTE` — unused leftover editor config
  referencing a nonexistent file.
- Remaining editor-extraction residue and editor vocabulary from the
  published API and docs.

## [0.1.0] - 2026-07-07

Initial release — organic screen-edge glow: zero-dependency
Canvas 2D engine (spring physics, palette LUT with perceptual
normalization) plus a thin React adapter.
