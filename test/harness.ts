/**
 * Shared stub-canvas harness for engine tests (node environment — no jsdom).
 *
 * The engine's only platform dependencies are `window.innerWidth/Height`,
 * `document.createElement("canvas")` (offscreen tile buffers) and the 2D
 * context surface it actually calls. The stubs below provide exactly that:
 * `createImageData` returns real Uint8ClampedArray-backed ImageData-shaped
 * objects, and `putImageData` RECORDS a copy of every written buffer into
 * `sinkRef.sink` when a capture is active — the engine composites its 8
 * pixel-disjoint tiles (4 strips + 4 corners) via putImageData, so the
 * concatenation of those 8 buffers IS the frame's rendered bytes.
 *
 * Ported from the Phase 1-3 QA smoke scripts (scratchpad smoke*.mjs /
 * pixel-regression*.mjs), which validated this stubbing approach against
 * the real built package.
 */
import { createHash } from "node:crypto";

export interface SinkRef {
  sink: Uint8ClampedArray[] | null;
}

/** Shared sink: offscreen buffers created via the stub document record here. */
export const sinkRef: SinkRef = { sink: null };

/* eslint-disable @typescript-eslint/no-explicit-any */
export function makeStubCanvas(ref: SinkRef): HTMLCanvasElement {
  const canvas: any = { width: 0, height: 0, style: {} };
  const ctx: any = {
    canvas,
    createImageData: (w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
    putImageData(img: { data: Uint8ClampedArray }) {
      if (ref.sink) ref.sink.push(Uint8ClampedArray.from(img.data));
    },
    clearRect() {},
    drawImage() {},
    save() {},
    restore() {},
    fillRect() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  canvas.getContext = () => ctx;
  return canvas as HTMLCanvasElement;
}

/**
 * Install the minimal window/document globals the engine touches. Offscreen
 * canvases created through the stub `document` share the module-level
 * `sinkRef`, so captureFrame sees every tile the engine writes.
 */
export function installStubDom(width = 800, height = 600): void {
  (globalThis as any).window = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as any).document = {
    createElement: () => makeStubCanvas(sinkRef),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A fresh main canvas for createAuraEngine (never records — only tiles do). */
export function newCanvas(): HTMLCanvasElement {
  return makeStubCanvas({ sink: null });
}

export function concatBuffers(bufs: Uint8ClampedArray[]): Uint8ClampedArray {
  const total = bufs.reduce((acc, b) => acc + b.length, 0);
  const out = new Uint8ClampedArray(total);
  let offset = 0;
  for (const b of bufs) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

/**
 * Render one frame and return the concatenated bytes of all putImageData
 * calls it produced (the engine's 8 tile buffers, in draw order).
 */
export function captureFrame(engine: { render(): void }): Uint8ClampedArray {
  sinkRef.sink = [];
  engine.render();
  const bufs = sinkRef.sink;
  sinkRef.sink = null;
  return concatBuffers(bufs);
}

/** Like captureFrame but returns the raw buffer list (to assert tile count). */
export function captureBuffers(engine: { render(): void }): Uint8ClampedArray[] {
  sinkRef.sink = [];
  engine.render();
  const bufs = sinkRef.sink;
  sinkRef.sink = null;
  return bufs;
}

export function bytesEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function sha256Hex(bytes: Uint8ClampedArray): string {
  return createHash("sha256")
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest("hex");
}
