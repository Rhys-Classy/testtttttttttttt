import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Evaluate "600+18", "2*450", "(900-3)/2". Only numbers and + - * / ( ) — no eval. */
export function evaluate(expr: string): number | null {
  const s = expr.replace(/\s+/g, '').replace(/mm$/i, '');
  if (!s) return null;
  let i = 0;
  const peek = () => s[i];
  const num = (): number | null => {
    if (peek() === '(') {
      i++;
      const v = add();
      if (peek() !== ')') return null;
      i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      const v = num();
      return v == null ? null : -v;
    }
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const mul = (): number | null => {
    let v = num();
    while (v != null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = num();
      if (r == null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const add = (): number | null => {
    let v = mul();
    while (v != null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = mul();
      if (r == null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = add();
  return v != null && i === s.length && Number.isFinite(v) ? v : null;
}

const fmt = (n: number, decimals: number) => {
  const f = Math.pow(10, decimals);
  return String(Math.round(n * f) / f);
};

export interface NumberFieldProps {
  value: number;
  onCommit: (v: number) => void;
  /** Live updates while scrubbing; followed by onScrubEnd. */
  onPreview?: (v: number) => void;
  onScrubEnd?: () => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: number;
  scrubLabel?: string;
  disabled?: boolean;
  title?: string;
}

export function NumberField({ value, onCommit, onPreview, onScrubEnd, min = -Infinity, max = Infinity, step = 1, unit = 'mm', decimals = 1, scrubLabel, disabled, title }: NumberFieldProps) {
  const [text, setText] = useState(fmt(value, decimals));
  const [error, setError] = useState(false);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(fmt(value, decimals));
  }, [value, decimals]);
  const clampV = (v: number) => Math.min(max, Math.max(min, v));
  const commitText = () => {
    editing.current = false;
    const v = evaluate(text);
    if (v == null) {
      setError(true);
      setText(fmt(value, decimals));
      setTimeout(() => setError(false), 900);
      return;
    }
    const c = clampV(v);
    setText(fmt(c, decimals));
    if (Math.abs(c - value) > 1e-9) onCommit(c);
  };
  const scrub = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    const x0 = e.clientX;
    const v0 = value;
    let last = v0;
    const live = onPreview ?? onCommit;
    const move = (ev: PointerEvent) => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const v = clampV(Math.round((v0 + (ev.clientX - x0) * step * mult) / (step * (ev.altKey ? 0.1 : 1))) * step * (ev.altKey ? 0.1 : 1));
      if (v !== last) {
        last = v;
        setText(fmt(v, decimals));
        live(v);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (onPreview) onScrubEnd?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={`field${error ? ' error' : ''}`} title={title}>
      {scrubLabel != null && (
        <span className="scrub" onPointerDown={scrub} title="Drag to adjust (Shift ×10, Alt fine)">
          {scrubLabel}
        </span>
      )}
      <input
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            editing.current = false;
            setText(fmt(value, decimals));
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            const v = clampV((evaluate(text) ?? value) + d);
            setText(fmt(v, decimals));
            onCommit(v);
          }
          e.stopPropagation();
        }}
      />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
}

export function TextField({ value, onCommit, placeholder }: { value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="field">
      <input
        className="text"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          e.stopPropagation();
        }}
      />
    </div>
  );
}

export function Row({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="row" title={title}>
      <span className="lbl">{label}</span>
      {children}
    </div>
  );
}

export function Section({ title, extra, children, defaultOpen = true }: { title: string; extra?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <button className="section-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
        {extra != null && <span className="muted">{extra}</span>}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Modal({ title, icon, children, footer, onClose, wide }: { title: string; icon?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          {icon}
          {title}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
