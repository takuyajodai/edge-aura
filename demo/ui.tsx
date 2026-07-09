/**
 * Reusable, keyboard-accessible demo controls. Pure presentation — all state
 * lives in the parent (main.tsx). No engine imports here.
 */

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

// -- Icons ------------------------------------------------------------------
// Inline single-color SVGs (currentColor) so they inherit theme text color.

export function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.2-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.75.81 1.2 1.84 1.2 3.1 0 4.43-2.7 5.4-5.28 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2.5" />
      <path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6" />
    </svg>
  );
}

// -- Segmented control (roving-tabindex radiogroup) -------------------------

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible label (may differ from value; value stays an identifier). */
  label: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (dir: 1 | -1) => {
    const i = options.findIndex((o) => o.value === value);
    const next = (i + dir + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        e.preventDefault();
        onChange(options[0].value);
        refs.current[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        onChange(options[options.length - 1].value);
        refs.current[options.length - 1]?.focus();
        break;
    }
  };

  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? "seg-item is-active" : "seg-item"}
            onClick={() => onChange(o.value)}
            onKeyDown={onKeyDown}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// -- Slider row -------------------------------------------------------------

export function SliderRow({
  label,
  caption,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  /** One-line muted hint under the label — what moving this slider changes visually. */
  caption?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Render the numeric chip (units, "off", fixed decimals, …). */
  format: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <div className="ctl-label-group">
        <label className="ctl-label">{label}</label>
        {caption && <span className="ctl-caption">{caption}</span>}
      </div>
      <div className="slider-wrap">
        <input
          type="range"
          className="slider"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ["--fill" as string]: `${pct}%` }}
        />
        <span className="chip" aria-hidden="true">
          {format(value)}
        </span>
      </div>
    </div>
  );
}

// -- Copy button (width-stable Copy → Copied morph) -------------------------

export function CopyButton({
  text,
  copyLabel,
  copiedLabel,
  className,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard blocked — still flash feedback so the UI feels alive */
    }
    setDone(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), 1600);
  };

  return (
    <button
      type="button"
      className={`copy-btn${done ? " is-done" : ""}${className ? ` ${className}` : ""}`}
      onClick={copy}
      aria-label={done ? copiedLabel : copyLabel}
    >
      <span className="copy-icon">{done ? <CheckIcon /> : <CopyGlyph />}</span>
      <span className="copy-text">{done ? copiedLabel : copyLabel}</span>
    </button>
  );
}

// -- Small labeled control row (label left, control right) ------------------

export function ControlRow({
  label,
  caption,
  children,
}: {
  label: string;
  /** One-line muted hint under the label — what this control changes. */
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="control-row">
      <div className="ctl-label-group">
        <span className="ctl-label">{label}</span>
        {caption && <span className="ctl-caption">{caption}</span>}
      </div>
      <div className="control-right">{children}</div>
    </div>
  );
}
