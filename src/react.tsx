"use client";

import { useEffect, useRef } from "react";
import { createAuraEngine, type AuraEngine, type EdgeAuraOptions } from "./engine";

export type AuraState = "idle" | "typing";

export interface EdgeAuraProps {
  /** Current editing activity state */
  state: AuraState;
  /** Timestamp that changes each time a save succeeds — triggers the saved pulse */
  savedAt: number;
  /** Engine tuning overrides (defaults reproduce the stock appearance). */
  options?: EdgeAuraOptions;
  /**
   * Prefix for the window CustomEvent channel: the component listens to
   * `${prefix}:tap`, `${prefix}:key`, `${prefix}:saved-pulse`.
   * Default "aura".
   */
  eventPrefix?: string;
  /**
   * One-time entrance "kindle": the SAME steady ring is revealed by a wavefront
   * spreading from this viewport point (the 編集 click), settling into the exact
   * steady state — so the post-entrance frame is the steady frame by
   * construction (one renderer, no separate CSS activation). Read once on mount;
   * skipped under prefers-reduced-motion. If null/undefined, the ring starts
   * already steady (direct nav / refresh — no entrance).
   */
  kindleOrigin?: { x: number; y: number } | null;
}

/**
 * Thin React host component — wires DOM events and React props into the pure
 * AuraEngine.  All physics and canvas drawing live in ./engine.
 */
export function EdgeAura({
  state,
  savedAt,
  options,
  eventPrefix = "aura",
  kindleOrigin = null,
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
    } catch {
      return;
    }
    engineRef.current = engine;

    // Expose engine for pixel-level QA in dev without running the full app.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__auraEngine = engine;
    }

    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reducedMotion = mq.matches;

    if (reducedMotion) engine.renderStatic();

    // Edit-entry kindle: the steady ring reveals itself spreading from the 編集
    // click point and settles into its exact steady state (one renderer ⇒ the
    // post-entrance frame IS the steady frame). Reduced motion skips it — the
    // static render must stay calm with no entrance. If no origin was provided
    // (direct nav / refresh), the ring simply starts steady.
    if (kindleOriginRef.current && !reducedMotion) {
      engine.kindle(kindleOriginRef.current.x, kindleOriginRef.current.y);
    }

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (reducedMotion) return;

      const dtMs = now - last;
      last = now;

      // savedAt pulse detection inside the rAF closure so we don't need a
      // separate useEffect that would re-register the whole loop.
      const curSavedAt = savedAtRef.current;
      if (curSavedAt !== prevSavedAt.current && curSavedAt !== 0) {
        prevSavedAt.current = curSavedAt;
        if (stateRef.current !== "typing") {
          engine.savedPulse();
        }
      }

      engine.step(dtMs);
      engine.render();
    };

    raf = requestAnimationFrame(tick);

    // -- Window event wiring --
    const onTap = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number } | null>).detail;
      engine.tap(detail);
    };

    const onKey = (e: Event) => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail;
      if (detail) engine.key(detail.x, detail.y);
    };

    const onSavedPulse = () => {
      engine.savedPulse();
    };

    const onResize = () => {
      engine.resize();
    };

    const onMotionChange = (ev: MediaQueryListEvent) => {
      reducedMotion = ev.matches;
      if (reducedMotion) {
        cancelAnimationFrame(raf);
        engine.renderStatic();
      } else {
        last = performance.now();
        raf = requestAnimationFrame(tick);
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
      cancelAnimationFrame(raf);
      window.removeEventListener(tapEvent, onTap);
      window.removeEventListener(keyEvent, onKey);
      window.removeEventListener(savedEvent, onSavedPulse);
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", onMotionChange);
      engine.destroy();
      engineRef.current = null;
      if (process.env.NODE_ENV !== "production") {
        delete (window as unknown as Record<string, unknown>).__auraEngine;
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
      className="editing-aura"
    >
      {/* Solid 4px ring + all halos drawn by the engine into one canvas.
          (A CSS mask-composite ring proved unreliable across engines.) */}
      <canvas ref={canvasRef} className="aura-canvas" />
    </div>
  );
}

export default EdgeAura;
