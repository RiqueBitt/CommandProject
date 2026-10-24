// Peças de interface compartilhadas pelos editores (mapa, modelo, tropa), no estilo de um
// estúdio de jogo: faixa de ferramentas com abas, painéis redimensionáveis, árvore de objetos,
// grade de propriedades, menu de contexto e barra de status.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, Modal } from "../ui";
import { api } from "../../lib/api";
import type { ProjectApi } from "../../lib/useProject";
import type { CreationVersion } from "../../lib/types";

// ------------------------------------------------------------------ faixa de ferramentas

export function Ribbon({ tabs, active, onTab, children, right }: {
  tabs: { id: string; label: string }[];
  active: string;
  onTab: (id: string) => void;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="ribbon">
      <div className="ribbon-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === active} className="ribbon-tab" onClick={() => onTab(t.id)}>{t.label}</button>
        ))}
        <span className="grow" />
        {right}
      </div>
      <div className="ribbon-body" role="toolbar">{children}</div>
    </div>
  );
}

export function RibbonGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-items">{children}</div>
      {label && <span className="ribbon-label">{label}</span>}
    </div>
  );
}

export function RibbonButton({ icon, label, onClick, active, disabled, hint, color, small }: {
  icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean; hint?: string; color?: string; small?: boolean;
}) {
  return (
    <button className={`ribbon-btn ${small ? "small" : ""}`} aria-pressed={active} disabled={disabled} title={hint ?? label} onClick={onClick}
      style={color ? { ["--rc" as string]: color } : undefined}>
      <Icon name={icon} size={small ? 18 : 24} />
      <span>{label}</span>
    </button>
  );
}

// ------------------------------------------------------------------ layout com painéis

function usePersisted(key: string, initial: number): [number, (v: number) => void] {
  const [v, setV] = useState(() => {
    try { const s = Number(localStorage.getItem(key)); return Number.isFinite(s) && s > 0 ? s : initial; } catch { return initial; }
  });
  const set = useCallback((n: number) => {
    setV(n);
    try { localStorage.setItem(key, String(Math.round(n))); } catch { /* ignora */ }
  }, [key]);
  return [v, set];
}

function Splitter({ onDrag }: { onDrag: (dx: number) => void }) {
  const start = useRef<number | null>(null);
  return (
    <div className="splitter" role="separator" aria-orientation="vertical"
      onPointerDown={(e) => { start.current = e.clientX; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => { if (start.current === null) return; onDrag(e.clientX - start.current); start.current = e.clientX; }}
      onPointerUp={() => { start.current = null; }} />
  );
}

/** Esquerda | centro | direita, com as larguras guardadas por editor. */
export function StudioLayout({ id, left, center, right }: { id: string; left?: ReactNode; center: ReactNode; right?: ReactNode }) {
  const [lw, setLw] = usePersisted(`cp.layout.${id}.left`, 270);
  const [rw, setRw] = usePersisted(`cp.layout.${id}.right`, 300);
  const clamp = (v: number) => Math.max(180, Math.min(520, v));
  return (
    <div className="studio-layout" style={{ gridTemplateColumns: `${left ? `${lw}px 6px ` : ""}minmax(0,1fr)${right ? ` 6px ${rw}px` : ""}` }}>
      {left && <div className="studio-pane">{left}</div>}
      {left && <Splitter onDrag={(dx) => setLw(clamp(lw + dx))} />}
      <div className="studio-center">{center}</div>
      {right && <Splitter onDrag={(dx) => setRw(clamp(rw - dx))} />}
      {right && <div className="studio-pane">{right}</div>}
    </div>
  );
}

export function Panel({ title, icon, actions, children, grow, collapsible = true, id }: {
  title: string; icon?: string; actions?: ReactNode; children: ReactNode; grow?: boolean; collapsible?: boolean; id?: string;
}) {
  const key = `cp.panel.${id ?? title}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== "0"; } catch { return true; } });
  return (
    <section className={`spanel ${grow && open ? "grow" : ""}`}>
      <header>
        <button className="spanel-title" onClick={() => {
          if (!collapsible) return;
          setOpen(!open);
          try { localStorage.setItem(key, open ? "0" : "1"); } catch { /* ignora */ }
        }} aria-expanded={open}>
          {collapsible && <Icon name={open ? "expand_more" : "chevron_right"} size={18} />}
          {icon && <Icon name={icon} size={16} />}
          <span>{title}</span>
        </button>
        <span className="grow" />
        {actions}
      </header>
      {open && <div className="spanel-body">{children}</div>}
    </section>
  );
}

// ------------------------------------------------------------------ árvore de objetos

export interface TreeNode { id: string; label: string; icon: string; color?: string; detail?: string; children?: TreeNode[]; hidden?: boolean; locked?: boolean }

export function Tree({ nodes, selected, onSelect, onContext, onToggleHidden, filter }: {
  nodes: TreeNode[];
  selected: Set<string>;
  onSelect: (id: string, mode: "set" | "toggle" | "range") => void;
  onContext?: (id: string, x: number, y: number) => void;
  onToggleHidden?: (id: string) => void;
  filter?: string;
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const f = filter?.trim().toLowerCase() ?? "";
  const match = (n: TreeNode): boolean => !f || n.label.toLowerCase().includes(f) || (n.children ?? []).some(match);
  const render = (n: TreeNode, depth: number): ReactNode => {
    if (!match(n)) return null;
    const kids = n.children ?? [];
    const open = !closed.has(n.id) || !!f;
    return (
      <div key={n.id}>
        <div className={`tree-row ${selected.has(n.id) ? "sel" : ""} ${n.hidden ? "dim" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}
          role="treeitem" aria-selected={selected.has(n.id)} aria-expanded={kids.length ? open : undefined}
          onClick={(e) => onSelect(n.id, e.ctrlKey || e.metaKey ? "toggle" : e.shiftKey ? "range" : "set")}
          onContextMenu={(e) => { if (!onContext) return; e.preventDefault(); onContext(n.id, e.clientX, e.clientY); }}>
          {kids.length ? (
            <button className="tw" aria-label={open ? "Recolher" : "Expandir"} onClick={(e) => {
              e.stopPropagation();
              setClosed((c) => { const s = new Set(c); if (s.has(n.id)) s.delete(n.id); else s.add(n.id); return s; });
            }}><Icon name={open ? "expand_more" : "chevron_right"} size={16} /></button>
          ) : <span className="tw" />}
          <Icon name={n.icon} size={16} style={n.color ? { color: n.color } : undefined} />
          <span className="tl">{n.label}</span>
          {n.detail && <span className="td">{n.detail}</span>}
          {onToggleHidden && depth > 0 && (
            <button className="tv" aria-label={n.hidden ? "Mostrar" : "Esconder"} onClick={(e) => { e.stopPropagation(); onToggleHidden(n.id); }}>
              <Icon name={n.hidden ? "visibility_off" : "visibility"} size={14} />
            </button>
          )}
        </div>
        {open && kids.map((k) => render(k, depth + 1))}
      </div>
    );
  };
  return <div className="tree-view" role="tree">{nodes.map((n) => render(n, 0))}</div>;
}

// ------------------------------------------------------------------ propriedades

export type Prop =
  | { kind: "number"; label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; hint?: string }
  | { kind: "slider"; label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; hint?: string }
  | { kind: "text"; label: string; value: string; onChange: (v: string) => void; placeholder?: string; hint?: string; multiline?: boolean }
  | { kind: "color"; label: string; value: string; onChange: (v: string) => void; hint?: string }
  | { kind: "select"; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: string }
  | { kind: "toggle"; label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }
  | { kind: "vec3"; label: string; value: [number, number, number]; onChange: (v: [number, number, number]) => void; step?: number; hint?: string }
  | { kind: "info"; label: string; value: ReactNode }
  | { kind: "custom"; label: string; node: ReactNode };

/** Campo numérico que só confirma ao sair/Enter (digitar "1." não vira 1 no meio). */
function NumInput({ value, onChange, min, max, step, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string }) {
  const [txt, setTxt] = useState(String(round(value)));
  useEffect(() => { setTxt(String(round(value))); }, [value]);
  const commit = () => {
    const v = Number(txt.replace(",", "."));
    if (!Number.isFinite(v)) { setTxt(String(round(value))); return; }
    const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
    if (c !== value) onChange(c);
    setTxt(String(round(c)));
  };
  return (
    <input className="pinput" aria-label={label} value={txt} inputMode="decimal"
      onChange={(e) => setTxt(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const d = (step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === "ArrowUp" ? 1 : -1);
          onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, round(value + d))));
        }
      }} />
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;

export function PropertyGrid({ sections, empty }: { sections: { title: string; props: Prop[] }[]; empty?: ReactNode }) {
  if (!sections.length) return <div className="pgrid-empty">{empty ?? "Selecione um objeto para ver as propriedades."}</div>;
  return (
    <div className="pgrid">
      {sections.map((s) => (
        <div key={s.title} className="pgrid-section">
          <div className="pgrid-title">{s.title}</div>
          {s.props.map((p, i) => (
            <div key={p.label + i} className="pgrid-row" title={"hint" in p ? p.hint : undefined}>
              <span className="pl">{p.label}</span>
              <span className="pv">
                {p.kind === "number" && <span className="row" style={{ gap: 4 }}><NumInput {...p} />{p.unit && <small className="faint">{p.unit}</small>}</span>}
                {p.kind === "slider" && (
                  <span className="row" style={{ gap: 6 }}>
                    <input type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} aria-label={p.label} onChange={(e) => p.onChange(Number(e.target.value))} />
                    <small className="faint" style={{ minWidth: 34, textAlign: "right" }}>{round(p.value)}{p.unit}</small>
                  </span>
                )}
                {p.kind === "text" && (p.multiline
                  ? <textarea className="pinput" rows={3} value={p.value} placeholder={p.placeholder} aria-label={p.label} onChange={(e) => p.onChange(e.target.value)} />
                  : <input className="pinput" value={p.value} placeholder={p.placeholder} aria-label={p.label} onChange={(e) => p.onChange(e.target.value)} />)}
                {p.kind === "color" && (
                  <span className="row" style={{ gap: 6 }}>
                    <input type="color" value={p.value} aria-label={p.label} onChange={(e) => p.onChange(e.target.value)} />
                    <code className="faint small">{p.value}</code>
                  </span>
                )}
                {p.kind === "select" && (
                  <select className="pinput" value={p.value} aria-label={p.label} onChange={(e) => p.onChange(e.target.value)}>
                    {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {p.kind === "toggle" && <input type="checkbox" checked={p.value} aria-label={p.label} onChange={(e) => p.onChange(e.target.checked)} />}
                {p.kind === "vec3" && (
                  <span className="vec3">
                    {(["X", "Y", "Z"] as const).map((ax, k) => (
                      <label key={ax}><i>{ax}</i><NumInput label={`${p.label} ${ax}`} value={p.value[k]} step={p.step ?? 1}
                        onChange={(v) => { const n = [...p.value] as [number, number, number]; n[k] = v; p.onChange(n); }} /></label>
                    ))}
                  </span>
                )}
                {p.kind === "info" && <span className="faint">{p.value}</span>}
                {p.kind === "custom" && p.node}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ menu de contexto

export interface CtxItem { icon: string; label: string; onClick: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (CtxItem | "-")[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", h);
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("mousedown", h); window.removeEventListener("keydown", k); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 230), top = Math.min(y, window.innerHeight - items.length * 32 - 16);
  return createPortal(
    <div className="menu ctx" ref={ref} role="menu" style={{ position: "fixed", left, top }}>
      {items.map((it, i) => it === "-" ? <div key={i} className="menu-sep" /> : (
        <button key={i} className={`menu-item ${it.danger ? "danger" : ""}`} role="menuitem" disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }}>
          <Icon name={it.icon} /> {it.label} {it.shortcut && <small>{it.shortcut}</small>}
        </button>
      ))}
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ atalhos

/** Atalhos do editor ativo. Ignora quando o foco está num campo de texto. */
export function useHotkeys(active: boolean, map: Record<string, (e: KeyboardEvent) => void>) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.matches?.("input:not([type=range]):not([type=checkbox]), textarea, select, [contenteditable]");
      const key = `${e.ctrlKey || e.metaKey ? "ctrl+" : ""}${e.shiftKey ? "shift+" : ""}${e.altKey ? "alt+" : ""}${e.key.toLowerCase()}`;
      const fn = ref.current[key];
      if (!fn) return;
      if (typing && !key.startsWith("ctrl+")) return;
      if (typing && (key === "ctrl+z" || key === "ctrl+y" || key === "ctrl+a" || key === "ctrl+c" || key === "ctrl+v")) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active]);
}

// ------------------------------------------------------------------ cabeçalho do projeto

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return "agora";
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
};

/** Estado de salvamento, desfazer/refazer, versões e o aviso de recuperação. */
export function ProjectBar<D>({ p, onSave, extra }: { p: ProjectApi<D>; onSave: () => void; extra?: ReactNode }) {
  const [, tick] = useState(0);
  const [versions, setVersions] = useState(false);
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(h); }, []);
  return (
    <>
      <div className="project-bar">
        <button className="btn icon-btn sm-icon" title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={!p.canUndo} onClick={p.undo}><Icon name="undo" /></button>
        <button className="btn icon-btn sm-icon" title="Refazer (Ctrl+Y)" aria-label="Refazer" disabled={!p.canRedo} onClick={p.redo}><Icon name="redo" /></button>
        <span className="save-state">
          {p.saving ? <><Icon name="sync" size={15} /> Salvando…</>
            : p.dirty ? <><i className="dot warn" /> Alterações não salvas</>
              : p.savedAt ? <><Icon name="cloud_done" size={15} /> Salvo {ago(p.savedAt)}</> : <><Icon name="cloud_done" size={15} /> Salvo</>}
        </span>
        <button className="btn sm" onClick={() => setVersions(true)} title="Versões anteriores"><Icon name="history" size={17} /> Versões</button>
        {extra}
        <button className="btn primary sm" onClick={onSave} disabled={p.saving} title="Salvar (Ctrl+S)"><Icon name="save" size={17} /> Salvar</button>
      </div>
      {p.recoveryAt && (
        <div className="recovery-banner" role="alert">
          <Icon name="restore_page" />
          <span>Este projeto tem alterações de {new Date(p.recoveryAt).toLocaleString("pt-BR")} que não foram salvas (o launcher fechou antes).</span>
          <button className="btn sm primary" onClick={() => void p.acceptRecovery()}>Recuperar</button>
          <button className="btn sm text" onClick={() => void p.discardRecovery()}>Descartar</button>
        </div>
      )}
      {versions && p.meta && <VersionsModal id={p.meta.id} onClose={() => setVersions(false)} onRestore={(d) => p.replace(d as D)} />}
    </>
  );
}

function VersionsModal({ id, onClose, onRestore }: { id: string; onClose: () => void; onRestore: (doc: unknown) => void }) {
  const [list, setList] = useState<CreationVersion[] | null>(null);
  useEffect(() => { void api.creationVersions(id).then(setList).catch(() => setList([])); }, [id]);
  return (
    <Modal title="Versões anteriores" icon="history" onClose={onClose}>
      <p className="muted small">Uma versão é guardada quando você salva (no máximo a cada 5 minutos, ou sempre em "Salvar versão"). Voltar para uma versão também guarda a atual, então dá para desfazer.</p>
      <div className="versions">
        {list === null ? <div className="bar indeterminate"><i /></div> : list.length === 0 ? <p className="faint small">Ainda não há versões anteriores.</p> : list.map((v) => (
          <div key={v.file} className="version-row">
            <Icon name="description" size={18} />
            <span className="grow">{new Date(v.savedAt).toLocaleString("pt-BR")}</span>
            <small className="faint">{(v.size / 1024).toFixed(0)} KB</small>
            <button className="btn sm" onClick={async () => { const d = await api.creationRestore<unknown>(id, v.file); onRestore(d); onClose(); }}>Voltar para esta</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ status

export function StatusBar({ children }: { children: ReactNode }) {
  return <footer className="status-bar">{children}</footer>;
}

// ------------------------------------------------------------------ seleção compartilhada

export interface Selection { ids: Set<string>; set: (ids: string[]) => void; toggle: (id: string) => void; clear: () => void }

export function useSelection(): Selection {
  const [ids, setIds] = useState<Set<string>>(new Set());
  return useMemo(() => ({
    ids,
    set: (l: string[]) => setIds(new Set(l)),
    toggle: (id: string) => setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    clear: () => setIds(new Set()),
  }), [ids]);
}

/** O editor está na aba ativa? (atalhos só valem para ela) */
export const ActiveEditor = createContext(true);
export const useActiveEditor = () => useContext(ActiveEditor);
