# edge-aura

An organic, Siri-style screen-edge glow: a rounded-rectangle "neon tube"
hugging the viewport edges — a bright undulating core line plus a soft
asymmetric bloom whose inner face dissolves with no perceptible end. The hue
cycles continuously around the ring; tap, keystroke, and save-pulse inputs
inject energy that swells localized hotspots through spring physics.

The core engine is **framework-agnostic** (plain TypeScript + Canvas 2D,
**zero dependencies**, no React imports). A React adapter is provided as a
separate import path. Born in production — extracted from the editor of a
live product.

```
edge-aura          — server-safe core entry (engine + palettes + keyboard map)
edge-aura/react    — <EdgeAura> React adapter ("use client")
```

## Install

```sh
npm i edge-aura
```

React is an optional peer dependency — only needed if you import
`edge-aura/react`.

The package is **ESM-only** (no CJS build): Node >= 18, modern bundlers, or
native ESM.

## Quick start

### React

```tsx
import { EdgeAura } from "edge-aura/react";

<EdgeAura />
```

That's it — **zero props and zero CSS required**. The component renders
`<div aria-hidden data-aura-state class="edge-aura">` containing
`<canvas class="edge-aura-canvas">`. No stylesheet is shipped; instead the
wrapper carries inline default styles (`position: fixed; inset: 0;
pointer-events: none` — a full-viewport, click-through overlay) and the
canvas fills it. Your `style` prop is merged **after** the defaults, so any
of them can be overridden — set `zIndex` there to control stacking:

```tsx
<EdgeAura
  state={isTyping ? "typing" : "idle"}
  savedAt={savedAtTimestamp}
  style={{ zIndex: 40 }}
/>
```

It owns the rAF loop, window-resize handling, and `prefers-reduced-motion`
(static dimmed frame, no animation).

Props (all optional):

| Prop | Type | Default | Description |
|---|---|---|---|
| `state` | `"idle" \| "typing"` | `"idle"` | Drives palette rotation speed + `data-aura-state` |
| `savedAt` | `number` | `0` | Marker that changes on each successful save; each change to a new non-zero value triggers one ambient pulse (suppressed while `state === "typing"`). The default `0` is a sentinel meaning "never pulse" — the FIRST change to a different value triggers a pulse. A timestamp (`Date.now()`) is the natural choice |
| `options` | `EdgeAuraOptions` | `{}` | Engine tuning overrides (read once at mount) |
| `eventPrefix` | `string` | `"aura"` | CustomEvent channel prefix |
| `kindleOrigin` | `{x,y} \| null` | `null` | One-time entrance: the steady ring is revealed by a wavefront spreading from this viewport point and settles into its exact steady state (the post-entrance frame is byte-identical to steady). `null` → start steady; skipped under `prefers-reduced-motion` |
| `className` | `string` | — | Extra class name(s) appended to the wrapper's `edge-aura` class |
| `style` | `React.CSSProperties` | — | Merged onto the wrapper after the built-in defaults (every default overridable); set `zIndex` here |

### Vanilla

```ts
import { createAuraEngine } from "edge-aura";

const canvas = document.querySelector("canvas")!; // position: fixed, full viewport
const engine = createAuraEngine(canvas);

let last = performance.now();
function tick(now: number) {
  requestAnimationFrame(tick);
  engine.step(now - last);
  last = now;
  engine.render();
}
requestAnimationFrame(tick);

// Feed it input:
engine.tap({ x: 400, y: 300 });   // pointer/caret position (px) — projected to nearest edge
engine.key(0.5);                  // 0..1 fraction across the bottom edge — key column
engine.pulse();                   // ambient pulse (e.g. autosave success); pulse(energy) to override
engine.setTyping(true);           // faster palette rotation while typing
engine.kindle(700, 140);          // entrance: reveal the steady ring spreading from (x,y)
```

`engine.savedPulse()` remains as a deprecated alias of `pulse()`.

The engine sizes the canvas backing store to `window.innerWidth/Height`
itself (and self-heals on render if the viewport changed). Call
`engine.resize()` on window resize, `engine.destroy()` on teardown. For
`prefers-reduced-motion`, skip the loop and call `engine.renderStatic()` once.

### Event channel contract

So that high-frequency input never forces a React render, the adapter listens
for `window` CustomEvents (names below use the default prefix `"aura"`):

| Event | `detail` | Effect |
|---|---|---|
| `aura:tap` | `{ x, y }` in viewport px, or `null` | `engine.tap(detail)` — energy burst; point is projected to the nearest edge and the hotspot glides there |
| `aura:key` | `{ x, y }` normalized 0..1 (e.g. from `keyCodeToPosition`) | `engine.key(detail.x)` — bottom-edge key column; only `x` is consumed (`y` is reserved for custom hosts) |
| `aura:saved-pulse` | — | `engine.pulse()` |

```ts
import { keyCodeToPosition } from "edge-aura";

const pos = keyCodeToPosition(e.code); // null for modifier/nav keys
if (pos) window.dispatchEvent(new CustomEvent("aura:key", { detail: pos }));
```

## Palette presets

Named stop arrays are exported as `EDGE_AURA_PALETTES` (the engine's default
is `EDGE_AURA_PALETTES.siri`). Every preset is a full hue cycle whose first
and last stops match, so the loop wraps seamlessly. Stop arrays are typed
`EdgeAuraPaletteStops` — an array of `EdgeAuraPaletteStop`
(`[position, [r, g, b]]`) entries. (`PaletteStops` is a deprecated alias of
`EdgeAuraPaletteStops`.)

```ts
import { createAuraEngine, EDGE_AURA_PALETTES } from "edge-aura";

const engine = createAuraEngine(canvas, {
  palette: { stops: EDGE_AURA_PALETTES.aurora },
});
```

| Preset | Character |
|---|---|
| `siri` | Stock Siri-style mesh gradient (full rainbow cycle) — the default |
| `aurora` | Cool tones only: emerald / near-white / ice cyan / sky blue |
| `sunset` | Warm dusk oranges and magentas |
| `ocean` | Deep blues and teals |
| `candy` | Bright playful pinks and blues |
| `nebula` | Dark saturated purples and blues |
| `sakura` | Cherry-blossom pinks alternating with near-white blush |

## Options

`createAuraEngine(canvas, options?)` — every option is optional; defaults are
the tuned stock appearance. `defineEdgeAuraOptions({...})` is an identity
helper for authoring typed configs; `EDGE_AURA_DEFAULTS` exports the default
values.

Validation: **structurally invalid palette stops throw** at creation time
(`Error("edge-aura: <reason>")` — stops must be an array of >= 2
`[position, [r, g, b]]` entries, positions finite and non-decreasing, first
exactly 0, last exactly 1, colors 3-tuples of finite numbers). **Numeric
scalar options are instead clamped to safe minimums** (`keySigma`/`tapSigma`
>= 1, `band` >= 8, `cornerRadius`/`inset` >= 0, rotation and kindle
durations >= 0.05 s, `energyCap` > 0, `innerSigmaMax` >= 1), and non-finite
values (`NaN`/`Infinity`) fall back to the defaults — a decorative overlay
should degrade gracefully on garbage numbers, not crash the host.

### Top-level

| Option | Default | Description |
|---|---|---|
| `seed` | — (random) | Deterministic seed for the five per-instance noise phases (tiny mulberry32 PRNG) — for reproducible rendering in tests/QA. Unset → `Math.random()` phases per instance |

### `geometry`

| Option | Default | Description |
|---|---|---|
| `inset` | `3` | Centerline inset from the viewport edges (px) |
| `cornerRadius` | `11` | Rounded-rect corner radius (px); smaller hugs the corner more squarely |
| `topEdgeFade` | `0` | Fade the composited aura to transparent over the topmost N px — for browsers that tint their window chrome by sampling the page's top rows |
| `topCornerFade` | `0` | Radial fade around the two top corners over radius N px — for browsers (e.g. Arc) that tint their chrome from the top-corner patches |
| `band` | `76` | Strip depth (px) — hard end of the inward dissolve (smoothly windowed to 0) |
| `coreSigmaBase` | `1.6` | Core line σ midpoint (px); below ~1.3 a faint pixel-grid shimmer may appear at the thin extreme |
| `coreSigmaVar` | `0.6` | Core σ undulation range (±) |
| `innerSoftBase` | `1.25` | Inward bloom σ multiplier (base) |
| `innerSoftVar` | `0.45` | Inward bloom σ multiplier (noise breathing range) |
| `innerSigmaMax` | `17` | Inward bloom σ cap (px) |

### `palette`

| Option | Default | Description |
|---|---|---|
| `stops` | Siri-style 9 stops | Gradient stops `[position, [r, g, b]]`; first at 0, last at 1 |
| `pastel` | `0.35` | Mix toward white at LUT build time (0 = raw colors) |
| `coreWhiten` | `0.2` | How strongly the core line whitens toward 255 (neon feel) |
| `ringAlpha` | `0.90` | Max alpha cap — the page always shows through slightly |
| `normalize` | `true` | Perceptual weight normalization (see below) |
| `normalizeTarget` | `NORMALIZE_REF` | Target perceptual weight (siri @ pastel 0.35) |

### `motion`

| Option | Default | Description |
|---|---|---|
| `decay` | `1.1` | Tap/ambient energy decay rate (1/s) |
| `keyDecay` | `1.9` | Key energy decay rate (1/s) — faster so the column dies once typing stops |
| `energyCap` | `1.5` | Saturation cap shared by all energy stores |
| `rotateTypingS` | `3` | Full palette rotation duration while typing (s) |
| `rotateIdleS` | `8` | Full palette rotation duration while idle (s) |
| `kindleDurS` | `0.85` | Kindle entrance duration (s) — how long the reveal wavefront takes to sweep from the origin to the ring's far point |
| `kindleSoftPx` | `90` | Soft width (px) of the kindle reveal wavefront — the envelope ramps 0→1 over this arc-distance behind the front |

### `input`

| Option | Default | Description |
|---|---|---|
| `keySigma` | `90` | Key hotspot Gaussian σ along the edge (px) |
| `tapSigma` | `110` | Tap hotspot Gaussian σ along the edge (px) |
| `tapEnergy` | `0.8` | Energy injected per tap |
| `keyEnergy` | `0.9` | Energy injected per keystroke |
| `savedPulseEnergy` | `0.45` | Default energy injected by `pulse()` when no amount is given |
| `keyXMin` | `0.08` | Key column x mapping: left margin fraction |
| `keyXSpan` | `0.84` | Key column x mapping: span fraction (keeps the column out of corner arcs) |

### Perceptual normalization

Palettes differ wildly in distance-from-white: at the same `ringAlpha`, a
dark saturated preset (`nebula`, `ocean`) reads heavy on a white page while a
near-white one (`sakura`, `candy`) washes out. With `normalize` (default on),
the engine equalizes this at creation time:

- **Metric:** after building the 256-entry LUT (post-pastel), perceptual
  weight = mean of `1 − relativeLuminance(r,g,b)` over the entries, with
  `relativeLuminance = (0.2126·r + 0.7152·g + 0.0722·b) / 255` (sRGB-space —
  not gamma-decoded; cheap and monotonic is all that's needed).
- **Two levers:** the effective ring alpha is `clamp(ringAlpha ×
  target/weight, 0.3, 1.0)` — heavy palettes get *alpha scaled down*. If a
  light palette would need alpha > 1, *pastel is reduced* stepwise (−0.07,
  up to 8 LUT rebuilds) to darken the colors instead. Raw stops already near
  white may still fall short at pastel 0 / alpha 1 — best effort applies.
- The target defaults to `NORMALIZE_REF`, the weight of the stock `siri`
  palette at pastel 0.35, so the default palette is pixel-identical with
  normalization on or off.

Disable with `palette: { normalize: false }`, or retune via
`normalizeTarget`. The resolved values are inspectable via
`engine.getNormalization()` → `{ weight, effRingAlpha, effPastel }`
(diagnostic only).

## Demo

```sh
git clone https://github.com/takuyajodai/edge-aura
cd edge-aura && npm i && npm run demo
```

## QA hook

In non-production builds the React adapter exposes the live engine as
`window.__auraEngine`. This allows deterministic, rAF-independent pixel QA:

```js
const eng = window.__auraEngine;
for (let i = 0; i < 60; i++) eng.step(16.7); // advance exactly 1s
eng.render();                                 // draw one frame
// then getImageData(...) on .edge-aura-canvas and assert alpha values
```

For fully reproducible pixels across runs, pass the top-level `seed` option:
it derives the five noise phases from a deterministic PRNG instead of
`Math.random()`, so the same seed + the same `step()` sequence yields the
same frame.

## Performance notes

- **Tiled strips, no overlap:** the ring renders into 8 offscreen buffers —
  4 edge strips plus 4 `(inset+cornerRadius)²` corner quadrants — that tile
  the perimeter pixel-disjointly (ownership split along corner diagonals), so
  source-over `drawImage` compositing never double-draws.
- **Early-break columns:** each per-column inner loop breaks as soon as the
  pixel is past the centerline and below 1/255 alpha; per-frame cost is
  roughly `2(W+H) × ~30` pixel writes regardless of viewport area.
- **Zero per-frame allocation:** the neon profile is computed into a single
  closure-level scratch object; buffers are allocated only on resize.
  No `Math.pow` in the hot path (the rational tail uses `u·√u`).
- The palette LUT (256×3 `Uint8Array`) is built once per engine instance.

## License

[MIT](./LICENSE) © 2026 Takuya Jodai
