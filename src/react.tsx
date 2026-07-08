"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { createAuraEngine, type AuraEngine, type EdgeAuraOptions } from "./engine";

export type AuraState = "idle" | "typing";

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
  /** Engine tuning overrides (defaults reproduce the stock appearance). */
  options?: EdgeAuraOptions;
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
}

// Zero-config defaults: a full-viewport, click-through overlay. The user's
// `style` prop is spread after these so every value can be overridden.
const WRAPPER_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
};

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
  eventPrefix = "aura",
  kindleOrigin = null,
  className,
  style,
}: EdgeAuraProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const engineRef   = useRef<AuraEngine | null>(null);
  const stateRef    = useRef<AuraState>(state);
  const savedAtRef  = useRef(savedAt);
  const prevSavedAt = useRef(savedAt);
  const optionsRef  = useRef(options);
  // Mount-time value only — read once when the engine is created.
  const kindleOriginRef = useRef(kindleOrigin);

  // Sync props into refs so the rAF closure always sees current values.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    savedAtRef.current = savedAt;
  }, [savedAt]);

  // ------------------------------------------------------------------
  // Single effect: create engine, drive rAF loop, wire events
  // ------------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let engine: AuraEngine;
    try {
      engine = createAuraEngine(canvas, optionsRef.current);
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

    if (reducedMotion) engine.renderStatic();

    // Entrance kindle: the steady ring reveals itself spreading from the
    // activating gesture's viewport point and settles into its exact steady
    // state (one renderer ⇒ the post-entrance frame IS the steady frame).
    // Reduced motion skips it — the static render must stay calm with no
    // entrance. If no origin was provided (direct nav / refresh), the ring
    // simply starts steady.
    if (kindleOriginRef.current && !reducedMotion) {
      engine.kindle(kindleOriginRef.current.x, kindleOriginRef.current.y);
    }

    // rAF loop lifecycle: `running` gates tick's self-rescheduling so the loop
    // can be stopped without racing a pending callback, start() is idempotent
    // (never two concurrent loops), and stop() both cancels the pending frame
    // and flips the flag — nothing fires after stop() in any state.
    let raf = 0;
    let running = false;
    let last = 0;

    const tick = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(tick);

      const dtMs = now - last;
      last = now;

      // savedAt pulse detection inside the rAF closure so we don't need a
      // separate useEffect that would re-register the whole loop.
      const curSavedAt = savedAtRef.current;
      if (curSavedAt !== prevSavedAt.current && curSavedAt !== 0) {
        prevSavedAt.current = curSavedAt;
        if (stateRef.current !== "typing") {
          engine.pulse();
        }
      }

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

    // Under reduced motion the static frame above is all we show — no loop.
    if (!reducedMotion) start();

    // -- Window event wiring --
    const onTap = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number } | null>).detail;
      engine.tap(detail);
    };

    const onKey = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (detail) engine.key(detail.x);
    };

    const onSavedPulse = () => {
      engine.pulse();
    };

    const onResize = () => {
      engine.resize();
      // resize() reallocates the canvas backing store (clearing it); under
      // reduced motion no rAF tick follows, so repaint the static frame here
      // or the ring vanishes until the next transition.
      if (reducedMotion) engine.renderStatic();
    };

    const onMotionChange = (ev: MediaQueryListEvent) => {
      reducedMotion = ev.matches;
      if (reducedMotion) {
        stop();
        engine.renderStatic();
      } else {
        start();
      }
    };

    const tapEvent   = `${eventPrefix}:tap`;
    const keyEvent   = `${eventPrefix}:key`;
    const savedEvent = `${eventPrefix}:saved-pulse`;

    window.addEventListener(tapEvent, onTap);
    window.addEventListener(keyEvent, onKey);
    window.addEventListener(savedEvent, onSavedPulse);
    window.addEventListener("resize", onResize);
    mq.addEventListener("change", onMotionChange);

    return () => {
      stop();
      window.removeEventListener(tapEvent, onTap);
      window.removeEventListener(keyEvent, onKey);
      window.removeEventListener(savedEvent, onSavedPulse);
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", onMotionChange);
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
  }, [state]);

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
