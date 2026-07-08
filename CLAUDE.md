# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

`edge-aura` — a Siri-style organic screen-edge glow, published on npm.
Zero-dependency Canvas 2D engine (TypeScript, spring physics, palette LUT
with perceptual normalization) plus a thin React adapter. Extracted from a
production editor where it runs daily.

## Commands

```sh
npm run typecheck   # tsc --noEmit (covers src/, demo/, test/)
npm test            # vitest run — test/: engine suite (node + stub-canvas harness) and React adapter suite (jsdom, mocked engine)
npm run build       # tsdown → dist/ (ESM + .d.ts)
npm run check:dist  # dist/ gate: entry paths, "use client", react-free core
npm run demo        # Vite dev server for demo/ (resolves package names to src/)
npm run demo:build  # verify the demo compiles
npm publish         # prepublishOnly runs typecheck + build + check:dist
```

## Architecture rules

- `src/index.ts` is the **server-safe core entry** — it must never import
  React (or anything else). `src/react.tsx` is the only React-aware file and
  must keep the `"use client"` directive; **verify it survives into
  `dist/react.js` after any build-config change** (Next.js App Router
  consumers depend on it).
- The engine has **zero runtime dependencies**. Keep it that way.
- Effect tuning goes through `EdgeAuraOptions` — do not bake app-specific
  values into `engine.ts` defaults. The spring constants in engine.ts are
  coupled to the decay rates; change them only with pixel-level QA
  (`window.__auraEngine` is exposed in non-production builds: drive
  `step()`/`render()` manually, then `getImageData` and assert alphas).
- `demo/` imports the package by its published names (`edge-aura`,
  `edge-aura/react`) via Vite aliases to `src/` — new public API must work
  through those entry points, not deep imports.

## Tests & CI

- Tests live in `test/` (vitest): `engine.test.ts` runs in node against the
  stub-canvas harness in `test/harness.ts` (recording 2d context — real
  `Uint8ClampedArray` buffers, includes a golden pixel-snapshot hash);
  `react.test.tsx` runs under jsdom with `./engine` mocked via `vi.mock`.
  `test/` is not shipped (the package.json `files` whitelist covers this).
- CI is `.github/workflows/ci.yml`: on every push and pull request it runs
  `npm ci`, typecheck, build, `check:dist`, `npm test`, and `demo:build`.

## Releasing

1. Bump `version` in package.json (semver).
2. Add a CHANGELOG.md entry (Keep a Changelog format — Added / Changed /
   Fixed / Removed; flag breaking changes) and update README if the API
   changed.
3. `npm publish` — prepublishOnly runs typecheck + build + check:dist.
4. Tag: `git tag v<version> && git push --tags`.
