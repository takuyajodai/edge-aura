"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type Ref,
} from "react";
import {
  createAuraEngine,
  type AuraEngine,
  type EdgeAuraOptions,
  type EdgeAuraPaletteStops,
} from "./engine";
import { EDGE_AURA_PALETTES, type EdgeAuraPaletteName } from "./palettes";

export type AuraState = "idle" | "typing";

/**
 * Imperative handle exposed through the `ref` prop. Lets SPA consumers fire the
 * entrance kindle at gesture time — e.g. before/while a route transition is
 * still in flight — instead of only at mount via `kindleOrigin`.
 */
export interface EdgeAuraHandle {
  /**
   * One-shot entrance reveal from a viewport point: the SAME steady ring is
   * revealed by a wavefront spreading from `(x, y)` and settling into its exact
   * steady state (identical to the `kindleOrigin` mount path — one renderer, no
   * separate activation). Coordinates are viewport pixels (e.g. a click's
   * `clientX` / `clientY`).
   *
   * No-op under `prefers-reduced-motion` (the static frame must stay calm —
   * mirrors the mount path's reduced-motion skip). No-op before the engine
   * exists or after unmount. Independent of `kindleOrigin`: both may be used,
   * and `kindleOrigin` stays mount-time-only — this neither reads nor alters it.
   */
  kindle(x: number, y: number): void;
}

export interface EdgeAuraProps {
  /** Current activity state. Default "idle". */
  state?: AuraState;
  /**
   * Monotonic marker for "a save (or similar success) just happened" — each
   * CHANGE to a new non-zero value triggers one ambient pulse. The default 0
   * means "never pulse"; the FIRST change to a different value triggers a
   * pulse. A timestamp (e.g. `Date.now()`) is the natural choice.
   */
  savedAt?: number;
  /**
   * Engine tuning overrides (defaults reproduce the stock appearance).
   * REACTIVE: on change the engine is live-tuned via `updateOptions`,
   * diffed section-wise (geometry / palette / motion / input) — only the
   * sections whose object changed are re-applied. Sections are compared by
   * reference first (pass a memoized/stable object to skip re-applies), then
   * by a cheap JSON compare, so re-declaring a value-equal object every render
   * is a no-op. Like the engine's `updateOptions`, this MERGES rather than
   * replaces: removing a key or a whole section does NOT revert it to the
   * default — set the value explicitly to change it back. While the `palette`
   * prop is set it governs the ring's stops, so `options.palette.stops` is
   * ignored (other palette scalars still apply). `options.seed` is read only
   * at mount; changing it requires remounting the component (e.g. a changed
   * React `key`).
   */
  options?: EdgeAuraOptions;
  /**
   * Ring palette — a preset name (e.g. "ocean") or a raw stop array. REACTIVE:
   * at mount it overrides `options.palette.stops` for engine creation; on any
   * later change the engine crossfades to the new palette (350 ms). Takes
   * precedence over `options.palette.stops` while set; changing it back to
   * undefined does NOT revert the ring (set an explicit palette instead).
   */
  palette?: EdgeAuraPaletteName | EdgeAuraPaletteStops;
  /**
   * Whether the animation loop runs. Default true. REACTIVE: false stops the
   * rAF loop and freezes the last rendered frame (the canvas is NOT cleared);
   * true (re)starts it. Under prefers-reduced-motion the loop never runs
   * regardless of this prop (the static frame wins).
   */
  active?: boolean;
  /**
   * Throttled frame rate (fps) while the effect is "quiescent" — idle
   * (`state !== "typing"`) with no energy or config input for the last few
   * seconds. Default 20. At the idle rotation the per-frame delta stays below
   * the perceptual threshold (the default 8 s/rev drift advances ~2.3° of hue
   * angle per 20 fps frame — across a soft gradient with no sharp angular
   * features), so the throttle is visually indistinguishable from full rate while
   * roughly halving the rAF wakeups on a 60 Hz panel (more on 120 Hz) — it
   * exists purely to spare battery and low-end hardware. ANY input restores
   * full rate for a grace window (tap / key / save pulse, a `state` / `palette`
   * / `options` change, a kindle, or a resize). Numeric values are clamped up
   * to a sane floor (5 fps); pass `false` to opt out and always run at full
   * display rate. Never affects the reduced-motion / hidden-tab /
   * `active={false}` paths — those stop the loop entirely, so there is nothing
   * to throttle.
   */
  quiescentFps?: number | false;
  /**
   * Prefix for the window CustomEvent channel: the component listens to
   * `${prefix}:tap`, `${prefix}:key`, `${prefix}:saved-pulse`.
   * Default "aura".
   */
  eventPrefix?: string;
  /**
   * One-time entrance "kindle": the SAME steady ring is revealed by a
   * wavefront spreading from this viewport point (the viewport point of the
   * gesture that activated the effect), settling into the exact steady
   * state — so the post-entrance frame is the steady frame by construction
   * (one renderer, no separate CSS activation). Read once on mount; skipped
   * under prefers-reduced-motion. If null/undefined, the ring starts already
   * steady (direct nav / refresh — no entrance).
   */
  kindleOrigin?: { x: number; y: number } | null;
  /** Extra class name(s) appended to the wrapper's "edge-aura" class. */
  className?: string;
  /**
   * Inline styles merged onto the wrapper div AFTER the built-in defaults,
   * so any default (position, inset, pointerEvents) can be overridden.
   * Set `zIndex` here to control stacking against your app's layers.
   */
  style?: CSSProperties;
  /**
   * Imperative handle for firing the entrance kindle after mount (React 19
   * `ref`-as-prop — no forwardRef). Attach a `Ref<EdgeAuraHandle>` and call
   * `ref.current?.kindle(x, y)` to trigger the reveal at the moment of a
   * gesture (a click that starts a route transition), rather than at mount via
   * `kindleOrigin`. See `EdgeAuraHandle` for the exact semantics (one-shot,
   * reduced-motion-safe, no-op after unmount, independent of `kindleOrigin`).
   */
  ref?: Ref<EdgeAuraHandle>;
}

// Zero-config defaults: a full-viewport, click-through overlay. The user's
// `style` prop is spread after these so every value can be overridden.
const WRAPPER_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
};

// -- Quiescent-rate throttle (issue #3) ------------------------------------
// Default throttled frame rate while the effect is "quiescent" (see below). At
// the idle rotation the per-frame delta stays below the perceptual threshold
// (the default 8 s/rev drift is ~2.3° of hue angle per 20 fps frame, across a
// soft gradient with no sharp angular features), so 20 fps is visually
// indistinguishable from full rate yet roughly halves the rAF wakeups on a
// 60 Hz panel — more on 120 Hz — purely to spare battery and low-end hardware.
const DEFAULT_QUIESCENT_FPS = 20;
// Floor so a misconfigured prop can never stall the ring to a slideshow (or, at
// fps ≤ 0, divide the throttle window by zero). 5 fps (200 ms) is the slowest we
// ever run while nominally "animating".
const MIN_QUIESCENT_FPS = 5;
// Grace period after the last energy/config input before the loop may throttle.
// The engine's slowest energy store decays at 1.1/s (tap), so a swell is
// ~e^-5.5 ≈ 0.4% of peak after 5 s — imperceptible — and the 0.85 s kindle
// wavefront and 0.35 s palette crossfade both finish far inside this window.
// Deliberately larger than any transient so swells, gliding hotspots and the
// kindle never render at reduced rate; only the truly steady ring is throttled.
const QUIESCE_AFTER_MS = 5000;

// Resolve the `quiescentFps` prop to either `false` (throttling off) or a
// clamped positive fps. Non-finite / ≤ floor values snap to the floor rather
// than disabling throttling; only an explicit `false` opts out.
function resolveQuiescentFps(v: number | false): number | false {
  if (v === false) return false;
  return Number.isFinite(v)
    ? Math.max(MIN_QUIESCENT_FPS, v)
    : DEFAULT_QUIESCENT_FPS;
}

// Resolve a preset name to its stop array; raw stop arrays pass through.
// (The engine validates the stops structurally at creation/setPalette time.)
function resolvePaletteStops(
  palette: EdgeAuraPaletteName | EdgeAuraPaletteStops,
): EdgeAuraPaletteStops {
  return typeof palette === "string" ? EDGE_AURA_PALETTES[palette] : palette;
}

// -- Reactive-options diffing ----------------------------------------------
// The `options` prop is applied live via engine.updateOptions. Each section is
// compared by reference first (the memoized-object fast path), then by a cheap
// JSON compare (so a re-declared value-equal object is a no-op). Same-reference
// (incl. both undefined) short-circuits before any JSON work.
function sectionEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build the minimal updateOptions partial for an `options` prop change, or
 * null when nothing actionable changed. Sections absent from `next` are
 * skipped, not reverted: updateOptions key-merges and cannot express "reset to
 * default", so a cleared section keeps its last value (documented on the prop).
 * When `paletteStopsGoverned` (a `palette` prop currently owns the ring's
 * stops), `palette.stops` is stripped so it can't clobber that prop — the other
 * palette scalars still apply, since updateOptions merges within the section.
 */
function buildOptionsPartial(
  prev: EdgeAuraOptions | undefined,
  next: EdgeAuraOptions | undefined,
  paletteStopsGoverned: boolean,
): EdgeAuraOptions | null {
  let partial: EdgeAuraOptions | null = null;
  const add = <K extends keyof EdgeAuraOptions>(k: K, v: EdgeAuraOptions[K]) => {
    (partial ??= {})[k] = v;
  };

  if (next?.geometry !== undefined && !sectionEqual(prev?.geometry, next.geometry))
    add("geometry", next.geometry);
  if (next?.motion !== undefined && !sectionEqual(prev?.motion, next.motion))
    add("motion", next.motion);
  if (next?.input !== undefined && !sectionEqual(prev?.input, next.input))
    add("input", next.input);

  if (next?.palette !== undefined && !sectionEqual(prev?.palette, next.palette)) {
    if (paletteStopsGoverned && next.palette.stops !== undefined) {
      const { stops: _stops, ...rest } = next.palette;
      if (Object.keys(rest).length > 0) add("palette", rest);
    } else {
      add("palette", next.palette);
    }
  }

  return partial;
}

const CANVAS_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  display: "block",
};

/**
 * Thin React host component — wires DOM events and React props into the pure
 * AuraEngine. All physics and canvas drawing live in ./engine.
 *
 * Zero-config full-viewport overlay: the wrapper ships inline default styles
 * (`position: fixed; inset: 0; pointer-events: none`) so it works with no
 * consumer CSS — no stylesheet is shipped or required. Use `className` and
 * `style` to customize; `style` is merged after the defaults and can
 * override any of them (e.g. `zIndex` for stacking).
 */
export function EdgeAura({
  state = "idle",
  savedAt = 0,
  options,
  palette,
  active = true,
  quiescentFps = DEFAULT_QUIESCENT_FPS,
  eventPrefix = "aura",
  kindleOrigin = null,
  className,
  style,
  ref,
}: EdgeAuraProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const engineRef   = useRef<AuraEngine | null>(null);
  const stateRef    = useRef<AuraState>(state);
  const savedAtRef  = useRef(savedAt);
  const prevSavedAt = useRef(savedAt);
  const optionsRef  = useRef(options);
  // Mount-time value only — read once when the engine is created.
  const kindleOriginRef = useRef(kindleOrigin);
  // Last applied palette prop: used at engine creation (so a re-created
  // engine keeps the current palette) and to skip the setPalette call on the
  // initial render — only CHANGES crossfade.
  const paletteRef = useRef(palette);
  // Current `active` prop for the main effect's closure, plus a handle to its
  // loop-sync function so the small [active] effect can start/stop the loop
  // without widening the main effect's dependency array.
  const activeRef   = useRef(active);
  const syncLoopRef = useRef<(() => void) | null>(null);
  // Resolved (clamped, or `false`) quiescent fps for the tick's throttle, kept
  // in a ref so the [eventPrefix] loop closure sees prop changes without a
  // remount. `lastActivityAt` is stamped `performance.now()` on every energy or
  // config input (see the stamp sites below); the tick treats the ring as
  // quiescent only once QUIESCE_AFTER_MS has elapsed since the last stamp.
  const quiescentFpsRef = useRef<number | false>(resolveQuiescentFps(quiescentFps));
  const lastActivityAt  = useRef(0);
  // Whether prefers-reduced-motion is currently in effect — written by the
  // main effect (at mount and on media change) so the palette effect can pick
  // the right swap strategy without owning its own media query.
  const reducedMotionRef = useRef(false);

  // Sync props into refs so the rAF closure always sees current values.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    savedAtRef.current = savedAt;
  }, [savedAt]);

  useEffect(() => {
    quiescentFpsRef.current = resolveQuiescentFps(quiescentFps);
  }, [quiescentFps]);

  // ------------------------------------------------------------------
  // Single effect: create engine, drive rAF loop, wire events
  // ------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // The palette prop overrides options.palette.stops for creation, so the
    // engine starts on the declared palette with no visible swap after mount.
    const baseOptions = optionsRef.current;
    const paletteOverride = paletteRef.current;
    const creationOptions: EdgeAuraOptions | undefined =
      paletteOverride != null
        ? {
            ...baseOptions,
            palette: {
              ...baseOptions?.palette,
              stops: resolvePaletteStops(paletteOverride),
            },
          }
        : baseOptions;

    let engine: AuraEngine;
    try {
      engine = createAuraEngine(canvas, creationOptions);
    } catch (err) {
      // Decorative overlay: never take the app down, but tell developers.
      // Same inlined dev check as the __auraEngine block below.
      if (
        typeof process !== "undefined" &&
        !!process.env &&
        process.env.NODE_ENV !== "production"
      ) {
        console.warn("edge-aura: engine initialization failed", err);
      }
      return;
    }
    engineRef.current = engine;

    // Expose engine for pixel-level QA in dev without running the full app.
    // The env check is inlined at the use site (never hoisted into a module
    // const): with the condition ending in the textual `process.env.NODE_ENV`
    // comparison, a bundler `define` of NODE_ENV="production" makes the whole
    // condition statically falsy, so minifiers drop this block from production
    // bundles. The `typeof` guard keeps it crash-safe in unbundled browsers.
    if (
      typeof process !== "undefined" &&
      !!process.env &&
      process.env.NODE_ENV !== "production"
    ) {
      (window as unknown as Record<string, unknown>).__auraEngine = engine;
    }

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = mq.matches;
    reducedMotionRef.current = reducedMotion;

    if (reducedMotion) engine.renderStatic();

    // Entrance kindle: the steady ring reveals itself spreading from the
    // activating gesture's viewport point and settles into its exact steady
    // state (one renderer ⇒ the post-entrance frame IS the steady frame).
    // Reduced motion skips it — the static render must stay calm with no
    // entrance. If no origin was provided (direct nav / refresh), the ring
    // simply starts steady.
    if (kindleOriginRef.current && !reducedMotion) {
      engine.kindle(kindleOriginRef.current.x, kindleOriginRef.current.y);
      // The entrance wavefront is activity — full rate until it settles.
      lastActivityAt.current = performance.now();
    }

    // rAF loop lifecycle: `running` gates tick's self-rescheduling so the loop
    // can be stopped without racing a pending callback, start() is idempotent
    // (never two concurrent loops), and stop() both cancels the pending frame
    // and flips the flag — nothing fires after stop() in any state.
    let raf = 0;
    let running = false;
    // Timestamp of the last RENDERED frame. On a throttled (skipped) frame it is
    // deliberately NOT advanced, so `now - last` keeps accumulating the elapsed
    // time until the throttle window passes — the eventual step() then receives
    // the full delta and the physics integrate correctly over the larger step.
    let last = 0;

    const tick = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(tick);

      // (a) savedAt pulse detection FIRST — it must run even on a frame we are
      // about to throttle away, so a save during quiescence pulses promptly
      // instead of waiting out the throttle window. This lives in the rAF
      // closure (not a separate useEffect that would re-register the loop). A
      // fired pulse stamps activity, which clears quiescence in (b) so this very
      // frame renders.
      const curSavedAt = savedAtRef.current;
      if (curSavedAt !== prevSavedAt.current && curSavedAt !== 0) {
        prevSavedAt.current = curSavedAt;
        if (stateRef.current !== "typing") {
          engine.pulse();
          lastActivityAt.current = now;
        }
      }

      // (b) quiescence throttle: skip this frame when idle AND no energy/config
      // input has landed within QUIESCE_AFTER_MS AND the throttle window
      // (1000/fps) has not yet elapsed since the last rendered frame. `false`
      // disables it (`fps !== false` is also what narrows fps to a number for
      // the division). On a skip we return WITHOUT advancing `last`, so `dtMs`
      // accumulates the skipped time for the next rendered step (see `last`).
      const fps = quiescentFpsRef.current;
      const dtMs = now - last;
      if (
        fps !== false &&
        stateRef.current !== "typing" &&
        now - lastActivityAt.current > QUIESCE_AFTER_MS &&
        dtMs < 1000 / fps
      ) {
        return;
      }

      // (c) rendered frame: advance `last` and drive the engine with the full
      // (possibly accumulated) delta.
      last = now;
      engine.step(dtMs);
      engine.render();
    };

    const start = () => {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // Single predicate for whether the loop should run, composing every gate
    // instead of scattering the booleans: the `active` prop must permit it,
    // motion must be allowed (prefers-reduced-motion always wins → static frame
    // only), and the document must be visible (a hidden/background tab burns no
    // rAF budget). Every place that flips one of these routes through syncLoop.
    const shouldRun = () =>
      activeRef.current && !reducedMotion && !document.hidden;

    // Single decision point: start when shouldRun(), otherwise stop.
    // start()/stop() are idempotent, so calling this redundantly (StrictMode
    // double-effects, prop toggles to the same value) is safe. Stopping
    // freezes the last frame — the canvas is intentionally NOT cleared.
    const syncLoop = () => {
      if (shouldRun()) {
        start();
      } else {
        stop();
      }
    };
    syncLoopRef.current = syncLoop;

    // Under reduced motion the static frame above is all we show — no loop.
    syncLoop();

    // -- Window event wiring --
    const onTap = (e: Event) => {
      lastActivityAt.current = performance.now();
      const detail = (e as CustomEvent<{ x: number; y: number } | null>).detail;
      engine.tap(detail);
    };

    const onKey = (e: Event) => {
      lastActivityAt.current = performance.now();
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (detail) engine.key(detail.x);
    };

    const onSavedPulse = () => {
      // Stamp activity even when the pulse is typing-suppressed below — cheap,
      // harmless, and it keeps the "an input just arrived" signal honest.
      lastActivityAt.current = performance.now();
      // Same typing-suppression gate as the savedAt prop path (in tick):
      // an ambient "saved" pulse must not fire over active typing energy,
      // regardless of which channel delivered it.
      if (stateRef.current !== "typing") engine.pulse();
    };

    const onResize = () => {
      lastActivityAt.current = performance.now();
      engine.resize();
      // resize() reallocates the canvas backing store (clearing it); under
      // reduced motion no rAF tick follows, so repaint the static frame here
      // or the ring vanishes until the next transition.
      if (reducedMotion) engine.renderStatic();
    };

    const onMotionChange = (ev: MediaQueryListEvent) => {
      reducedMotion = ev.matches;
      reducedMotionRef.current = reducedMotion;
      // syncLoop() stops the loop when reduced motion is now on and resumes it
      // (if active + visible) when it is off — shouldRun() folds in the new
      // reducedMotion. Entering reduced motion also needs the calm static frame
      // painted once, since no rAF tick will follow.
      syncLoop();
      if (reducedMotion) engine.renderStatic();
    };

    // Pause the loop while the tab is hidden and resume it on return, but only
    // if policy still allows (active + motion). Routed through syncLoop so the
    // decision stays in one predicate. The frozen last frame is left on the
    // canvas while hidden (stop() never clears), so returning needs no repaint.
    const onVisibility = () => syncLoop();

    const tapEvent   = `${eventPrefix}:tap`;
    const keyEvent   = `${eventPrefix}:key`;
    const savedEvent = `${eventPrefix}:saved-pulse`;

    window.addEventListener(tapEvent, onTap);
    window.addEventListener(keyEvent, onKey);
    window.addEventListener(savedEvent, onSavedPulse);
    window.addEventListener("resize", onResize);
    mq.addEventListener("change", onMotionChange);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      // Only clear the handle if it still points at THIS effect's closure
      // (mirrors the __auraEngine guard below).
      if (syncLoopRef.current === syncLoop) syncLoopRef.current = null;
      window.removeEventListener(tapEvent, onTap);
      window.removeEventListener(keyEvent, onKey);
      window.removeEventListener(savedEvent, onSavedPulse);
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
      engine.destroy();
      engineRef.current = null;
      // Same inlined dev check as above — see the comment there. Only clear
      // the QA handle if it still points at THIS engine, so unmounting a
      // stale instance can't yank a newer instance's handle.
      if (
        typeof process !== "undefined" &&
        !!process.env &&
        process.env.NODE_ENV !== "production"
      ) {
        const w = window as unknown as Record<string, unknown>;
        if (w.__auraEngine === engine) {
          delete w.__auraEngine;
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventPrefix]);

  // setTyping is driven by prop change — separate effect so the loop doesn't
  // need to be torn down and recreated on every typing state transition.
  useEffect(() => {
    engineRef.current?.setTyping(state === "typing");
    // Both directions are activity: entering "typing" injects energy, and the
    // idle transition starts palette-rotation deceleration — neither should be
    // observed through the throttle. (Stamping on the mount run is harmless: it
    // just gives the ring its full-rate grace window at startup.)
    lastActivityAt.current = performance.now();
  }, [state]);

  // Reactive options: live-tune the engine on `options` prop change. The ref
  // holds the last-applied options; equality against it skips the initial
  // render (the engine was created with these options) and StrictMode's double
  // run. The ref is advanced even when we skip applying, so a later eventPrefix
  // remount recreates the engine with the latest options. `paletteRef` is read
  // (not depended on) to keep the `palette` prop's stops from being clobbered
  // by options.palette.stops while it is set — even mid-transition, when this
  // effect runs before the palette effect (declaration order), the current
  // `palette` prop OR the still-old ref catches an in-force palette prop.
  useEffect(() => {
    const prev = optionsRef.current;
    if (prev === options) return;
    const partial = buildOptionsPartial(
      prev,
      options,
      palette != null || paletteRef.current != null,
    );
    optionsRef.current = options;
    const engine = engineRef.current;
    if (!engine || !partial) return;
    try {
      engine.updateOptions(partial);
      // A live config change is activity — full rate until it settles.
      lastActivityAt.current = performance.now();
      // A geometry partial reallocates the tile buffers and clears the canvas
      // (per updateOptions' C5 contract), but no rAF tick follows when the loop
      // is stopped — under reduced motion, while inactive, or on a hidden tab —
      // so the ring would blank until the next transition. Repaint the static
      // frame whenever the loop is not running, mirroring onMotionChange. This
      // also reflects palette/motion/input changes made while paused.
      const loopRunning =
        activeRef.current && !reducedMotionRef.current && !document.hidden;
      if (!loopRunning) engine.renderStatic();
    } catch (err) {
      // Decorative overlay: a runtime-invalid option keeps the current config
      // instead of unmounting the host tree (an error thrown in a commit effect
      // is uncaught by default). Mirrors the mount-time createAuraEngine and
      // setPalette catches — same inlined dev check.
      if (
        typeof process !== "undefined" &&
        !!process.env &&
        process.env.NODE_ENV !== "production"
      ) {
        console.warn("edge-aura: updateOptions failed", err);
      }
    }
  }, [options, palette]);

  // Reactive palette: crossfade the live engine to the new palette on prop
  // CHANGE only. The equality guard skips the initial render (the engine was
  // already created with this palette) and StrictMode's double effect run.
  useEffect(() => {
    if (paletteRef.current === palette) return;
    paletteRef.current = palette;
    // A change back to undefined has no target palette — the engine keeps
    // its current one (documented on the prop).
    if (palette == null) return;
    const engine = engineRef.current;
    if (!engine) return;
    try {
      if (reducedMotionRef.current) {
        // No rAF loop runs under reduced motion, so a crossfade would stay
        // frozen at its first frame (the OLD palette) indefinitely — swap
        // instantly and repaint the static frame instead.
        engine.setPalette(palette);
        engine.renderStatic();
      } else {
        engine.setPalette(palette, { crossfadeMs: 350 });
      }
      // The 350 ms crossfade must run at full rate; the QUIESCE_AFTER_MS margin
      // covers it. (Under reduced motion there is no loop, so this is a no-op
      // for throttling — harmless.)
      lastActivityAt.current = performance.now();
    } catch (err) {
      // Decorative overlay: a runtime-invalid palette keeps the current one
      // instead of unmounting the host tree (an error thrown during a commit
      // effect is uncaught by default). Mirrors the mount-time catch around
      // createAuraEngine — same inlined dev check.
      if (
        typeof process !== "undefined" &&
        !!process.env &&
        process.env.NODE_ENV !== "production"
      ) {
        console.warn("edge-aura: setPalette failed", err);
      }
    }
  }, [palette]);

  // Reactive active: start/stop the main effect's loop via its sync handle.
  // syncLoop reads activeRef, so update the ref first. At mount this runs
  // after the main effect (declaration order) and is a no-op re-sync.
  useEffect(() => {
    activeRef.current = active;
    syncLoopRef.current?.();
  }, [active]);

  // Imperative kindle handle. The closure reads only stable refs, so the handle
  // object is built once (empty deps). It mirrors the mount-path gate exactly:
  // no engine yet / after unmount → engineRef is null (no-op); reduced motion →
  // bail before touching the engine so the static frame stays calm. It does not
  // touch kindleOrigin — that stays mount-time-only.
  useImperativeHandle(
    ref,
    (): EdgeAuraHandle => ({
      kindle(x, y) {
        const engine = engineRef.current;
        if (!engine) return;
        if (reducedMotionRef.current) return;
        engine.kindle(x, y);
        // Only stamp when the kindle actually fired (past the guards above) —
        // the reveal wavefront must render at full rate until it settles.
        lastActivityAt.current = performance.now();
      },
    }),
    [],
  );

  return (
    <div
      aria-hidden="true"
      data-aura-state={state}
      className={className ? `edge-aura ${className}` : "edge-aura"}
      style={{ ...WRAPPER_STYLE, ...style }}
    >
      {/* Solid 4px ring + all halos drawn by the engine into one canvas.
          (A CSS mask-composite ring proved unreliable across engines.) */}
      <canvas ref={canvasRef} className="edge-aura-canvas" style={CANVAS_STYLE} />
    </div>
  );
}

export default EdgeAura;
