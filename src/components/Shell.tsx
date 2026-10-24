import { useEffect, useMemo, useRef, useState } from "react";
import { api, openUrl, windowAction } from "../lib/api";
import { switchProfile, useStore, type Page } from "../lib/store";
import { Field, hueOf, Icon, Modal, monogram, Tip } from "./ui";

/** Tarefas demoradas: aparecem na barra do topo em qualquer tela, com o progresso. */
const LONG_TASKS: Record<string, { label: string; page: Page; tab?: string }> = {
  hd: { label: "Texturas HD", page: "studio", tab: "hd" },
  theme: { label: "Menu moderno", page: "library" },
  map: { label: "Gerando mapa", page: "studio", tab: "maps" },
  reshade: { label: "Instalando ReShade", page: "library" },
  shaders: { label: "Shaders", page: "library" },
  apply: { label: "Aplicando mods", page: "home" },
  purge: { label: "Restaurando o jogo", page: "home" },
  launch: { label: "Abrindo o jogo", page: "home" },
  update: { label: "Baixando atualização", page: "settings" },
  link: { label: "Baixando mod", page: "library" },
  skin: { label: "Skin de interface", page: "studio" },
};

function TaskDock() {
  const busy = useStore((s) => s.busy);
  const progress = useStore((s) => s.progress);
  const { go, setStudioTab } = useStore.getState();
  const items = Object.keys(busy)
    .map((k) => {
      const meta = LONG_TASKS[k] ?? (k.startsWith("hub:") ? { label: "Baixando do hub", page: "hub" as Page } : null);
      if (!meta) return null;
      const p = progress[k];
      const pct = p && p.total > 0 ? Math.min(100, Math.round((p.step / p.total) * 100)) : null;
      return { k, meta, pct, msg: p?.message };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return null;
  const first = items[0];
  return (
    <button className="task-dock" title={items.map((i) => `${i.meta.label}${i.msg ? `: ${i.msg}` : ""}`).join("\n")}
      onClick={() => { if (first.meta.tab) setStudioTab(first.meta.tab); go(first.meta.page); }}>
      <span className="spin"><Icon name="autorenew" size={16} /></span>
      <span className="lbl">{first.meta.label}{items.length > 1 ? ` +${items.length - 1}` : ""}</span>
      {first.pct !== null && <span className="pct">{first.pct}%</span>}
      <span className="mini-bar"><i style={{ width: `${first.pct ?? 35}%` }} className={first.pct === null ? "ind" : ""} /></span>
    </button>
  );
}

export function SystemBar() {
  const setPalette = useStore((s) => s.setPalette);
  const go = useStore((s) => s.go);
  return (
    <header className="systembar">
      <div className="drag" data-tauri-drag-region />
      <TaskDock />
      <button className="sys-btn" onClick={() => setPalette(true)}>
        <Icon name="search" size={19} /> Ação rápida <span className="kbd">Ctrl+K</span>
      </button>
      <button className="sys-btn" onClick={() => go("studio")} title="Estúdio"><Icon name="construction" size={19} /> Estúdio</button>
      <button className="sys-btn" onClick={() => openUrl("https://github.com/RiqueBitt/CommandProject#readme")}>
        <Icon name="help_center" size={19} /> Ajuda
      </button>
      <button className="winbtn" onClick={() => windowAction("minimize")} aria-label="Minimizar"><Icon name="remove" size={18} /></button>
      <button className="winbtn" onClick={() => windowAction("maximize")} aria-label="Maximizar"><Icon name="crop_square" size={17} /></button>
      <button className="winbtn close" onClick={() => windowAction("close")} aria-label="Fechar"><Icon name="close" size={19} /></button>
    </header>
  );
}

function RailItem({ label, page, onClick, children, selected, badge }: { label: string; page?: Page; onClick?: () => void; children: React.ReactNode; selected?: boolean; badge?: number }) {
  const current = useStore((s) => s.page);
  const go = useStore((s) => s.go);
  return (
    <Tip text={label}>
      <button
        className={`rail-item ${selected ? "selected" : ""}`}
        aria-label={label}
        aria-current={page && current === page ? "page" : undefined}
        onClick={onClick ?? (() => page && go(page))}
      >
        <span className="pill" />
        <span className="content">{children}</span>
        {!!badge && <span className="badge">{badge}</span>}
      </button>
    </Tip>
  );
}

export function Rail() {
  const profiles = useStore((s) => s.profiles);
  const page = useStore((s) => s.page);
  const settings = useStore((s) => s.settings);
  const appUpdate = useStore((s) => s.appUpdate);
  const { back } = useStore.getState();
  const [creating, setCreating] = useState(false);
  const nick = settings?.nickname?.trim() || "Você";

  return (
    <nav className="rail" aria-label="Navegação principal">
      <div className="rail-section">
        <Tip text="Voltar"><button className="rail-back" onClick={back} aria-label="Voltar"><Icon name="arrow_back" size={18} /></button></Tip>
        <RailItem label="Eu e meus perfis" page="me"><span className="avatar">{monogram(nick)}</span></RailItem>
        <RailItem label="Hub de mods" page="hub"><Icon name="store" size={28} /></RailItem>
      </div>
      <div className="rail-divider" />
      <div className="rail-list">
        {profiles?.profiles.map((p) => {
          const h = hueOf(p.id);
          const active = p.id === profiles.active;
          return (
            <RailItem key={p.id} label={`${p.name} (${p.mods.filter((m) => m.enabled).length} mods)`} selected={active && (page === "home" || page === "library")}
              onClick={() => void switchProfile(p.id, p.name, active)}>
              <span className="instance-tile" style={{ ["--tile-a" as string]: `hsl(${h} 42% 38%)`, ["--tile-b" as string]: `hsl(${(h + 35) % 360} 45% 18%)` }}>
                {monogram(p.name)}
              </span>
            </RailItem>
          );
        })}
        <RailItem label="Novo perfil" onClick={() => setCreating(true)}><Icon name="add" /></RailItem>
      </div>
      <div className="rail-divider" />
      <div className="rail-section">
        <RailItem label="Estúdio de criação" page="studio"><Icon name="construction" size={24} /></RailItem>
        <RailItem label="Multiplayer" page="multiplayer"><Icon name="hub" size={24} /></RailItem>
        <RailItem label="Configurações" page="settings" badge={appUpdate ? 1 : 0}><Icon name="settings" size={24} /></RailItem>
      </div>
      {creating && <NewProfile onClose={() => setCreating(false)} />}
    </nav>
  );
}

export function NewProfile({ onClose }: { onClose: () => void }) {
  const profiles = useStore((s) => s.profiles);
  const { run, refresh, go } = useStore.getState();
  const busy = useStore((s) => s.busy.newprofile || s.busy.activate);
  const [name, setName] = useState("");
  const [copy, setCopy] = useState(false);
  const taken = profiles?.profiles.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase());
  return (
    <Modal title="Criar perfil" icon="add" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        const set = await run("newprofile", () => api.createProfile(name.trim(), copy ? profiles?.active : undefined));
        if (!set) return;
        const created = set.profiles[set.profiles.length - 1];
        await run("activate", () => api.setActiveProfile(created.id), `Perfil "${created.name}" criado.`);
        await refresh();
        go("home");
        onClose();
      }}>
        <p className="muted small">Cada perfil guarda quais mods ficam ligados e em que ordem — como uma instância do jogo.</p>
        <Field label="Nome" hint={taken ? "Já existe um perfil com esse nome." : undefined}><input className="input" value={name} placeholder="Ex.: Liga 2v2" onChange={(e) => setName(e.target.value)} /></Field>
        <label className="row small"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Começar com os mods do perfil ativo</label>
        <footer><button type="button" className="btn text" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!name.trim() || busy || taken}>{busy ? "Criando…" : "Criar"}</button></footer>
      </form>
    </Modal>
  );
}

interface Cmd { id: string; label: string; icon: string; hint?: string; run: () => void | Promise<void> }

/** Ação rápida (Ctrl+K): navegar e executar ações pelo teclado. */
export function CommandPalette() {
  const open = useStore((s) => s.palette);
  const mods = useStore((s) => s.mods);
  const profiles = useStore((s) => s.profiles);
  const { setPalette, go, run, refresh, refreshMods } = useStore.getState();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!useStore.getState().palette);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [setPalette]);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const cmds = useMemo<Cmd[]>(() => {
    const nav = (id: Page, label: string, icon: string): Cmd => ({ id: "go-" + id, label, icon, hint: "abrir", run: () => go(id) });
    const list: Cmd[] = [
      { id: "play", label: "Jogar", icon: "play_arrow", hint: "ação", run: async () => { await run("launch", () => api.launchGame(), "Abrindo o jogo…"); await refresh(); } },
      { id: "apply", label: "Aplicar o perfil sem jogar", icon: "published_with_changes", hint: "ação", run: async () => { await run("apply", () => api.applyActive(), "Perfil aplicado."); await refresh(); } },
      { id: "purge", label: "Voltar a pasta do jogo ao original", icon: "restore", hint: "ação", run: async () => { await run("purge", () => api.purge(), "Pasta do jogo restaurada."); await refresh(); } },
      nav("home", "Perfil ativo", "sports_esports"),
      nav("library", "Mods do perfil", "extension"),
      nav("hub", "Hub de mods", "store"),
      nav("multiplayer", "Multiplayer: salas e chat", "hub"),
      nav("studio", "Estúdio de criação", "construction"),
      nav("me", "Meus perfis", "account_circle"),
      nav("settings", "Configurações", "settings"),
      ...(profiles?.profiles ?? []).map<Cmd>((p) => ({
        id: "profile-" + p.id, label: `Usar o perfil ${p.name}`, icon: "swap_horiz", hint: "perfil",
        run: async () => { await switchProfile(p.id, p.name); },
      })),
      ...mods.map<Cmd>((m) => ({
        id: "mod-" + m.manifest.id, label: `${m.enabled ? "Desligar" : "Ligar"} ${m.manifest.name}`, icon: m.enabled ? "toggle_on" : "toggle_off", hint: "mod",
        run: async () => {
          const ok = await run("toggle:" + m.manifest.id, () => api.setModEnabled(m.manifest.id, !m.enabled), `${m.manifest.name} ${m.enabled ? "desligado" : "ligado"}.`);
          if (ok !== undefined) await refreshMods();
        },
      })),
    ];
    const t = q.trim().toLowerCase();
    return t ? list.filter((c) => c.label.toLowerCase().includes(t)) : list;
  }, [q, mods, profiles, go, run, refresh, refreshMods]);

  if (!open) return null;
  const exec = async (c: Cmd) => {
    setPalette(false);
    await c.run();
  };
  return (
    <div className="palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Ação rápida">
        <input ref={input} className="input" placeholder="Digite uma ação, página, perfil ou mod…" value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPalette(false);
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(cmds.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter" && cmds[sel]) void exec(cmds[sel]);
          }} />
        <div className="items" role="listbox">
          {cmds.length === 0 && <p className="muted" style={{ padding: 14 }}>Nada encontrado.</p>}
          {cmds.slice(0, 60).map((c, i) => (
            <button key={c.id} className="menu-item" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => exec(c)}>
              <Icon name={c.icon} /> {c.label} <small>{c.hint}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
