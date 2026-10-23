import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../lib/store";

/** Ícone do Material Icons (mesmo conjunto do ProjectMC). */
export function Icon({ name, size, className = "", style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={`mi ${className}`} aria-hidden style={{ ...(size ? { fontSize: size } : {}), ...style }}>
      {name}
    </span>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="switch" title={label}>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
    </label>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: "warn" | "err" | "info" | "ok"; children: ReactNode }) {
  const icon = kind === "warn" ? "warning" : kind === "err" ? "error" : kind === "ok" ? "check_circle" : "info";
  return (
    <div className={`notice ${kind}`} role={kind === "err" ? "alert" : "status"}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <Icon name={icon} />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Barra de progresso ligada a uma tarefa do backend. */
export function TaskProgress({ task, label }: { task: string; label?: string }) {
  const p = useStore((s) => s.progress[task]);
  const busy = useStore((s) => s.busy[task]);
  if (!busy && !p) return null;
  const pct = p && p.total > 0 ? Math.min(100, (p.step / p.total) * 100) : null;
  return (
    <div className="col" style={{ gap: 6 }} aria-live="polite">
      <div className="row small">
        <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.message || label || "Trabalhando…"}</span>
        {pct !== null && <span className="faint">{Math.round(pct)}%</span>}
      </div>
      <div className={`bar ${pct === null ? "indeterminate" : ""}`}><i style={{ width: `${pct ?? 30}%` }} /></div>
    </div>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function Drawer({ onClose, children, label }: { onClose: () => void; children: ReactNode; label: string }) {
  useEscape(onClose);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={label}>
        <div className="row">
          <h2 style={{ flex: 1 }}>{label}</h2>
          <button className="btn icon-btn sm" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function Modal({ onClose, children, title, icon = "tune", wide }: { onClose: () => void; children: ReactNode; title: string; icon?: string; wide?: boolean }) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input,textarea,select")?.focus();
  }, []);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} style={wide ? { width: "min(820px, 100%)" } : undefined}>
        <div className="modal-head">
          <span className="ico"><Icon name={icon} size={20} /></span>
          <h2>{title}</h2>
          <button className="btn icon-btn sm" onClick={onClose} aria-label="Fechar"><Icon name="close" size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Menu flutuante ancorado num botão. */
export function Menu({ anchor, onClose, children, placement = "above" }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; placement?: "above" | "below" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ right: number; top?: number; bottom?: number }>({ right: 0 });
  useEscape(onClose);
  useEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    setPos(placement === "above" ? { right: window.innerWidth - r.right, bottom: window.innerHeight - r.top + 8 } : { right: window.innerWidth - r.right, top: r.bottom + 6 });
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, [anchor, onClose, placement]);
  return createPortal(
    <div className="menu" ref={ref} role="menu" style={{ position: "fixed", ...pos }} onClick={onClose}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, disabled }: { icon: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button className="menu-item" role="menuitem" onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
      {children}
    </button>
  );
}

/** Dica flutuante (usada no trilho de navegação). */
export function Tip({ text, children }: { text: string; children: ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({ x: r.right + 8, y: r.top + r.height / 2 });
      }}
      onMouseLeave={() => setAt(null)}
      onMouseDown={() => setAt(null)}
    >
      {children}
      {at && createPortal(<div className="tip" style={{ left: at.x, top: at.y, transform: "translateY(-50%)" }}>{text}</div>, document.body)}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <Icon name={t.kind === "ok" ? "check_circle" : t.kind === "error" ? "error" : "info"} />
          <span>{t.text}</span>
          <button className="btn icon-btn sm x" style={{ width: 24, height: 24 }} onClick={() => dismiss(t.id)} aria-label="Fechar aviso"><Icon name="close" size={16} /></button>
        </div>
      ))}
    </div>
  );
}

/** Cor estável a partir de um texto (para miniaturas sem imagem). */
export function hueOf(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function monogram(name: string) {
  return name.replace(/^\[\d+\]\s*/, "").replace(/[^A-Za-zÀ-ú0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "M";
}

export function ModThumb({ name, icon, size = 40 }: { name: string; icon?: string | null; size?: number }) {
  const h = hueOf(name);
  return (
    <div className="thumb" style={{ width: size, height: size, background: icon ? undefined : `linear-gradient(135deg, hsl(${h} 45% 40%), hsl(${(h + 40) % 360} 50% 22%))` }}>
      {icon ? <img src={icon} alt="" /> : monogram(name)}
    </div>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn sm" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    }}><Icon name={done ? "check" : "content_copy"} /> {done ? "Copiado" : label}</button>
  );
}

/** Comparador antes/depois: arraste a divisória. */
export function Compare({ before, after, beforeLabel, afterLabel, pixelated, ratio = "16 / 9" }: { before: string; after: string; beforeLabel: string; afterLabel: string; pixelated?: boolean; ratio?: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className={`compare ${pixelated ? "pixelated" : ""}`} style={{ ["--pos" as string]: `${pos}%`, aspectRatio: ratio }}>
      <img src={before} alt={beforeLabel} draggable={false} />
      <img className="after" src={after} alt={afterLabel} draggable={false} />
      <span className="divider" aria-hidden="true"><Icon name="code" /></span>
      <span className="chip dark tag-l">{beforeLabel}</span>
      <span className="chip dark tag-r">{afterLabel}</span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Comparar antes e depois" />
    </div>
  );
}
