// @vitest-environment jsdom
/**
 * React adapter tests. The engine module is mocked (vi.mock) so these tests
 * assert the ADAPTER's wiring — engine creation options, rAF lifecycle,
 * listener cleanup, and reactive props — without exercising canvas rendering
 * (that is engine.test.ts territory).
 */
import { StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDGE_AURA_PALETTES } from "../src/palettes";
import type { EdgeAuraOptions } from "../src/engine";

const { mockEngine, createAuraEngine } = vi.hoisted(() => {
  const mockEngine = {
    step: vi.fn(),
    render: vi.fn(),
    renderStatic: vi.fn(),
    tap: vi.fn(),
    key: vi.fn(),
    pulse: vi.fn(),
    savedPulse: vi.fn(),
    kindle: vi.fn(),
    setTyping: vi.fn(),
    setPalette: vi.fn(),
    getNormalization: vi.fn(() => ({ weight: 0, effRingAlpha: 0.9, effPastel: 0.35 })),
    resize: vi.fn(),
    destroy: vi.fn(),
  };
  // Typed signature so tests can read `mock.calls[0][1]` as EdgeAuraOptions.
  const createAuraEngine = vi.fn(
    (_canvas: HTMLCanvasElement, _options?: EdgeAuraOptions) => mockEngine,
  );
  return { mockEngine, createAuraEngine };
});

vi.mock("../src/engine", () => ({ createAuraEngine }));

// Imported AFTER the mock declaration so ./engine resolves to the mock.
import { EdgeAura } from "../src/react";

// ---------------------------------------------------------------------------
// Controllable environment: recording rAF + prefers-reduced-motion switch.
// ---------------------------------------------------------------------------
const pendingRaf = new Set<number>();
let nextRafId = 1;
let prmMatches = false;

beforeEach(() => {
  vi.clearAllMocks();
  pendingRaf.clear();
  nextRafId = 1;
  prmMatches = false;

  globalThis.requestAnimationFrame = ((_cb: FrameRequestCallback) => {
    const id = nextRafId++;
    pendingRaf.add(id);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    pendingRaf.delete(id);
  }) as typeof cancelAnimationFrame;

  // jsdom has no matchMedia; `matches` is read at call time so tests can set
  // prmMatches BEFORE mounting.
  window.matchMedia = ((query: string) => ({
    matches: prmMatches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
});

describe("mount", () => {
  it("renders div.edge-aura with inline fixed positioning and a canvas, zero props", () => {
    const { container } = render(<EdgeAura />);
    const wrapper = container.querySelector<HTMLDivElement>("div.edge-aura");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.style.position).toBe("fixed");
    expect(wrapper!.style.pointerEvents).toBe("none");
    expect(wrapper!.getAttribute("aria-hidden")).toBe("true");
    const canvas = wrapper!.querySelector("canvas.edge-aura-canvas");
    expect(canvas).not.toBeNull();
    expect(createAuraEngine).toHaveBeenCalledTimes(1);
    expect(createAuraEngine).toHaveBeenCalledWith(canvas, undefined);
    expect(pendingRaf.size).toBe(1); // the loop is running: one scheduled frame
  });

  it("survives StrictMode double-mount with exactly one pending rAF", () => {
    render(
      <StrictMode>
        <EdgeAura />
      </StrictMode>,
    );
    expect(pendingRaf.size).toBe(1);
  });
});

describe("unmount", () => {
  it("cancels the pending rAF, removes listeners, and destroys the engine", () => {
    const removed: string[] = [];
    const removeSpy = vi
      .spyOn(window, "removeEventListener")
      .mockImplementation((type) => {
        removed.push(type as string);
      });

    const { unmount } = render(<EdgeAura />);
    expect(pendingRaf.size).toBe(1);
    unmount();

    expect(pendingRaf.size).toBe(0);
    expect(mockEngine.destroy).toHaveBeenCalledTimes(1);
    for (const type of ["aura:tap", "aura:key", "aura:saved-pulse", "resize"]) {
      expect(removed).toContain(type);
    }
    removeSpy.mockRestore();
  });
});

describe("prefers-reduced-motion", () => {
  it("schedules NO rAF and renders one static frame when PRM is on at mount", () => {
    prmMatches = true;
    render(<EdgeAura />);
    expect(pendingRaf.size).toBe(0);
    expect(mockEngine.renderStatic).toHaveBeenCalledTimes(1);
  });

  it("wins over active: active=true under PRM still runs no loop", () => {
    prmMatches = true;
    render(<EdgeAura active={true} />);
    expect(pendingRaf.size).toBe(0);
  });
});

describe("active prop", () => {
  it("active=false leaves no pending rAF; toggling back to true schedules exactly one", () => {
    const { rerender } = render(<EdgeAura active={false} />);
    expect(pendingRaf.size).toBe(0);

    rerender(<EdgeAura active={true} />);
    expect(pendingRaf.size).toBe(1);

    rerender(<EdgeAura active={false} />);
    expect(pendingRaf.size).toBe(0);
    // The engine (and its last frame) must survive the pause — no teardown.
    expect(mockEngine.destroy).not.toHaveBeenCalled();

    rerender(<EdgeAura active={true} />);
    expect(pendingRaf.size).toBe(1);
    expect(createAuraEngine).toHaveBeenCalledTimes(1); // never re-created
  });
});

describe("palette prop", () => {
  it("overrides options.palette.stops at engine creation without calling setPalette", () => {
    render(<EdgeAura palette="ocean" />);
    expect(createAuraEngine).toHaveBeenCalledTimes(1);
    const options = createAuraEngine.mock.calls[0][1];
    expect(options?.palette?.stops).toBe(EDGE_AURA_PALETTES.ocean);
    expect(mockEngine.setPalette).not.toHaveBeenCalled();
  });

  it("crossfades via setPalette(value, { crossfadeMs: 350 }) on prop change only", () => {
    const { rerender } = render(<EdgeAura palette="ocean" />);
    rerender(<EdgeAura palette="ocean" />); // same value — no call
    expect(mockEngine.setPalette).not.toHaveBeenCalled();

    rerender(<EdgeAura palette="nebula" />);
    expect(mockEngine.setPalette).toHaveBeenCalledTimes(1);
    expect(mockEngine.setPalette).toHaveBeenCalledWith("nebula", { crossfadeMs: 350 });
    expect(createAuraEngine).toHaveBeenCalledTimes(1); // no remount for palette
  });

  it("swaps instantly and repaints the static frame under prefers-reduced-motion", () => {
    // No rAF loop runs under PRM, so a crossfade would freeze at its first
    // frame (old palette) forever — the adapter must fall back to an instant
    // swap followed by a static repaint.
    prmMatches = true;
    const { rerender } = render(<EdgeAura palette="ocean" />);
    expect(mockEngine.renderStatic).toHaveBeenCalledTimes(1); // mount frame

    rerender(<EdgeAura palette="nebula" />);
    expect(mockEngine.setPalette).toHaveBeenCalledTimes(1);
    expect(mockEngine.setPalette).toHaveBeenCalledWith("nebula"); // no crossfade
    expect(mockEngine.renderStatic).toHaveBeenCalledTimes(2); // repainted
    expect(pendingRaf.size).toBe(0); // still no loop
  });

  it("does not throw (and keeps the tree mounted) when setPalette rejects the new palette", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockEngine.setPalette.mockImplementationOnce(() => {
      throw new Error("edge-aura: palette stops must be an array of at least 2 entries");
    });

    const { container, rerender } = render(<EdgeAura palette="ocean" />);
    const garbage = [[0, [1, 2, 3]]] as unknown as Parameters<
      typeof EdgeAura
    >[0]["palette"];
    expect(() => rerender(<EdgeAura palette={garbage} />)).not.toThrow();

    // The overlay is still mounted and the failure was surfaced to devs.
    expect(container.querySelector("div.edge-aura")).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      "edge-aura: setPalette failed",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });
});
