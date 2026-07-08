# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

Initial release — Siri-style organic screen-edge glow: zero-dependency
Canvas 2D engine (spring physics, palette LUT with perceptual
normalization) plus a thin React adapter.
