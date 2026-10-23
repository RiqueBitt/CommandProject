import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useStore } from "../lib/store";

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
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: "warn" | "err" | "info" | "ok"; children: ReactNode }) {
  const Icon = kind === "warn" ? AlertTriangle : kind === "err" ? XCircle : kind === "ok" ? CheckCircle2 : Info;
  const color = kind === "warn" ? "var(--energy)" : kind === "err" ? "var(--cybran)" : kind === "ok" ? "var(--mass)" : "var(--uef)";
  return (
    <div className={`notice ${kind}`} role={kind === "err" ? "alert" : "status"}>
      <Icon size={18} color={color} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
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
        <span className="muted" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p?.message || label || "Trabalhando…"}
        </span>
        {pct !== null && <span className="faint">{Math.round(pct)}%</span>}
      </div>
      <div className={`bar ${pct === null ? "indeterminate" : ""}`}>
        <i style={{ width: `${pct ?? 30}%` }} />
      </div>
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
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

export function Modal({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: string }) {
  useEscape(onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input,textarea,select,button.primary")?.focus();
  }, []);
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal chamfer" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
      </div>
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
          {t.kind === "ok" ? <CheckCircle2 size={18} color="var(--mass)" /> : t.kind === "error" ? <XCircle size={18} color="var(--cybran)" /> : <Info size={18} color="var(--uef)" />}
          <span>{t.text}</span>
          <button className="btn ghost icon-btn x" style={{ width: 24, height: 24 }} onClick={() => dismiss(t.id)} aria-label="Fechar aviso">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Monograma para mods sem ícone. */
export function ModThumb({ name, icon }: { name: string; icon?: string | null }) {
  const letters = name.replace(/[^A-Za-zÀ-ú0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return <div className="mod-thumb">{icon ? <img src={icon} alt="" /> : letters || "M"}</div>;
}
