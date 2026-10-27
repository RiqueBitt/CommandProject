import { useEffect, useMemo, useRef, useState } from "react";
import { UNITS_ENABLED } from "../lib/features";
import { api, openUrl, windowAction } from "../lib/api";
import { switchProfile, useStore, type Page } from "../lib/store";
import { KIND_META, useTabs } from "../lib/tabs";
import type { CreationMeta, MatchMap } from "../lib/types";
import { confirmDialog } from "../lib/api";
import { t, tr } from "../lib/i18n";
import { Field, hueOf, Icon, Modal, monogram, Tip } from "./ui";

/** Tarefas demoradas: aparecem na barra do topo em qualquer tela, com o progresso. */
const LONG_TASKS: Record<string, { label: string; page: Page; tab?: string }> = {
  hd: { label: "Remaster HD", page: "studio", tab: "hd" },
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
    <button className="task-dock" title={items.map((i) => `${t(i.meta.label)}${i.msg ? `: ${tr(i.msg)}` : ""}`).join("\n")}
      onClick={() => { if (first.meta.tab) setStudioTab(first.meta.tab); go(first.meta.page); }}>
      <span className="spin"><Icon name="autorenew" size={16} /></span>
      <span className="lbl">{t(first.meta.label)}{items.length > 1 ? ` +${items.length - 1}` : ""}</span>
      {first.pct !== null && <span className="pct">{first.pct}%</span>}
      <span className="mini-bar"><i style={{ width: `${first.pct ?? 35}%` }} className={first.pct === null ? "ind" : ""} /></span>
    </button>
  );
}

/** Abas do topo: o launcher e cada projeto aberto (mapa, tropa, modelo). */
function TabStrip() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  const { activate, close } = useTabs.getState();
  const go = useStore((s) => s.go);
  const closeTab = async (id: string) => {
    const tab = useTabs.getState().tabs.find((x) => x.id === id);
    if (tab?.dirty) {
      const save = await confirmDialog(t('"{title}" tem alterações não salvas. Salvar antes de fechar?', { title: tab.title }), t("Salvar e fechar"), t("Fechar sem salvar"));
      if (save) {
        const ok = await useTabs.getState().savers[id]?.();
        if (ok === false) return;
      }
    }
    close(id);
  };
  if (!tabs.length) return null;
  return (
    <div className="tab-strip" role="tablist" aria-label={t("Abas")}>
      <button role="tab" aria-selected={active === null} className="ptab home" onClick={() => activate(null)} title="Launcher">
        <Icon name="rocket_launch" size={16} /> <span>Launcher</span>
      </button>
      {tabs.map((tab) => (
        <div key={tab.id} role="tab" aria-selected={active === tab.id} className="ptab" title={tab.title}
          style={{ ["--kc" as string]: KIND_META[tab.kind].color }}
          onClick={() => activate(tab.id)}
          onAuxClick={(e) => { if (e.button === 1) void closeTab(tab.id); }}>
          <Icon name={KIND_META[tab.kind].icon} size={15} className="kic" />
          <span className="tt">{tab.title}</span>
          {tab.dirty && <i className="dirty" aria-label={t("não salvo")} />}
          <button className="tx" aria-label={t("Fechar {title}", { title: tab.title })} onClick={(e) => { e.stopPropagation(); void closeTab(tab.id); }}><Icon name="close" size={14} /></button>
        </div>
      ))}
      <button className="ptab add" title={t("Novo projeto")} aria-label={t("Novo projeto")} onClick={() => go("create")}><Icon name="add" size={17} /></button>
    </div>
  );
}

export function SystemBar() {
  const setPalette = useStore((s) => s.setPalette);
  const go = useStore((s) => s.go);
  return (
    <header className="systembar">
      <TabStrip />
      {/* logo do jogo (da instalação do usuário, quando a arte do jogo está ligada) */}
      <i className="sys-logo" aria-hidden data-tauri-drag-region />
      <div className="drag" data-tauri-drag-region />
      <TaskDock />
      <button className="sys-btn" onClick={() => setPalette(true)}>
        <Icon name="search" size={19} /> {t("Ação rápida")} <span className="kbd">Ctrl+K</span>
      </button>
      <button className="sys-btn" onClick={() => go("create")} title={t("Criar mapas, tropas e modelos")}><Icon name="add_box" size={19} /> {t("Criar")}</button>
      <button className="sys-btn" onClick={() => openUrl("https://github.com/RiqueBitt/CommandProject#readme")}>
        <Icon name="help_center" size={19} /> {t("Ajuda")}
      </button>
      <button className="winbtn" onClick={() => windowAction("minimize")} aria-label={t("Minimizar")}><Icon name="remove" size={18} /></button>
      <button className="winbtn" onClick={() => windowAction("maximize")} aria-label={t("Maximizar")}><Icon name="crop_square" size={17} /></button>
      <button className="winbtn close" onClick={() => windowAction("close")} aria-label={t("Fechar")}><Icon name="close" size={19} /></button>
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

/** Áreas do launcher (trilho da esquerda, no estilo do painel de comando do jogo). */
function AreaItem({ label, icon, active, onClick, badge, off }: { label: string; icon: string; active: boolean; onClick: () => void; badge?: number; off?: boolean }) {
  return (
    <button className={`area-item ${active ? "on" : ""} ${off ? "off" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick} title={off ? t("{label} (modo local ligado)", { label }) : label}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
      {!!badge && <i className="badge">{badge}</i>}
    </button>
  );
}

export function Rail() {
  const profiles = useStore((s) => s.profiles);
  const page = useStore((s) => s.page);
  const createKind = useStore((s) => s.createKind);
  const settings = useStore((s) => s.settings);
  const appUpdate = useStore((s) => s.appUpdate);
  const { back, go, goCreate } = useStore.getState();
  const [creating, setCreating] = useState(false);
  const nick = settings?.nickname?.trim() || t("Você");
  const offline = !!settings?.offline;
  const area = (k: "map" | "unit" | "model") => page === "create" && createKind === k;

  return (
    <nav className="rail" aria-label={t("Navegação principal")}>
      <div className="rail-section">
        <Tip text={t("Voltar")}><button className="rail-back" onClick={back} aria-label={t("Voltar")}><Icon name="arrow_back" size={18} /></button></Tip>
        <RailItem label={t("Eu e meus perfis")} page="me"><span className="avatar">{monogram(nick)}</span></RailItem>
      </div>
      <div className="rail-areas">
        <AreaItem label={t("Início")} icon="sports_esports" active={page === "home"} onClick={() => go("home")} />
        <AreaItem label={t("Partida grande")} icon="groups" active={page === "bigmatch"} onClick={() => go("bigmatch")} />
        <AreaItem label={t("Arquivos")} icon="folder_open" active={page === "files"} onClick={() => go("files")} />
        <AreaItem label={t("Mapas")} icon="map" active={area("map")} onClick={() => goCreate("map")} />
        {UNITS_ENABLED && <AreaItem label={t("Tropas")} icon="smart_toy" active={area("unit")} onClick={() => goCreate("unit")} />}
        <AreaItem label={t("Modelos")} icon="view_in_ar" active={area("model") || page === "studio"} onClick={() => goCreate("model")} />
        <AreaItem label={t("Ícones")} icon="photo_camera" active={page === "icons"} onClick={() => go("icons")} />
        <AreaItem label={t("Mods")} icon="extension" active={page === "library" || page === "hub"} onClick={() => go("library")} />
        <AreaItem label={t("Forja")} icon="construction" active={page === "forja"} onClick={() => go("forja")} />
        <AreaItem label={t("Rede")} icon="hub" active={page === "multiplayer"} onClick={() => go("multiplayer")} off={offline} />
        <AreaItem label={t("Sistema")} icon="settings" active={page === "settings" || page === "performance"} onClick={() => go("settings")} badge={appUpdate ? 1 : 0} />
      </div>
      <div className="rail-divider" />
      <div className="rail-list">
        {profiles?.profiles.map((p) => {
          const h = hueOf(p.id);
          const active = p.id === profiles.active;
          return (
            <RailItem key={p.id} label={t("Perfil {name} ({n} mods)", { name: p.name, n: p.mods.filter((m) => m.enabled).length })} selected={active && (page === "home" || page === "library")}
              onClick={() => void switchProfile(p.id, p.name, active)}>
              <span className="instance-tile" style={{ ["--tile-a" as string]: `hsl(${h} 42% 38%)`, ["--tile-b" as string]: `hsl(${(h + 35) % 360} 45% 18%)` }}>
                {monogram(p.name)}
              </span>
            </RailItem>
          );
        })}
        <RailItem label={t("Novo perfil")} onClick={() => setCreating(true)}><Icon name="add" /></RailItem>
      </div>
      {offline && <Tip text={t("Modo local: sem internet. Mude em Sistema → Configurações.")}><span className="rail-offline"><Icon name="cloud_off" size={16} /> LOCAL</span></Tip>}
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
    <Modal title={t("Criar perfil")} icon="add" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        const set = await run("newprofile", () => api.createProfile(name.trim(), copy ? profiles?.active : undefined));
        if (!set) return;
        const created = set.profiles[set.profiles.length - 1];
        await run("activate", () => api.setActiveProfile(created.id), t('Perfil "{name}" criado.', { name: created.name }));
        await refresh();
        go("home");
        onClose();
      }}>
        <p className="muted small">{t("Cada perfil guarda quais mods ficam ligados e em que ordem — como uma instância do jogo.")}</p>
        <Field label={t("Nome")} hint={taken ? t("Já existe um perfil com esse nome.") : undefined}><input className="input" value={name} placeholder={t("Ex.: Liga 2v2")} onChange={(e) => setName(e.target.value)} /></Field>
        <label className="row small"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> {t("Começar com os mods do perfil ativo")}</label>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" disabled={!name.trim() || busy || taken}>{busy ? t("Criando…") : t("Criar")}</button></footer>
      </form>
    </Modal>
  );
}

interface Cmd { id: string; label: string; icon: string; hint?: string; run: () => void | Promise<void> }

/** Seções das Configurações (mesmos ids da página), para a busca. */
const SETTINGS_SECTIONS: [string, string, string][] = [
  ["jogo", "Jogo: pasta, modo de abrir, memória e prioridade", "sports_esports"],
  ["local", "Modo local e cópias de segurança", "cloud_off"],
  ["visual", "Visual: tema, facção, idioma e animações", "palette"],
  ["diagnostico", "Diagnóstico", "monitor_heart"],
  ["comunidade", "Comunidade", "hub"],
  ["hub", "Índices do Hub de mods", "store"],
  ["mapas", "Estúdio de Mapas", "map"],
  ["arquivos", "Arquivos do jogo", "folder_zip"],
  ["atualizacoes", "Atualizações do launcher", "system_update"],
  ["sobre", "Sobre o CommandProject", "info"],
];

/** Sem acento e em minúsculas: "nevasca" acha "Nevasca", "configuracoes" acha "Configurações". */
function fold(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Ação rápida (Ctrl+K): navegar e executar ações pelo teclado. */
export function CommandPalette() {
  const open = useStore((s) => s.palette);
  const mods = useStore((s) => s.mods);
  const profiles = useStore((s) => s.profiles);
  const { setPalette, go, run, refresh, refreshMods } = useStore.getState();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // busca global: criações e mapas são lidos na primeira vez que a busca abre
  const [creations, setCreations] = useState<CreationMeta[]>([]);
  const [maps, setMaps] = useState<MatchMap[]>([]);
  const loaded = useRef(false);
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    void api.creations().then(setCreations).catch(() => undefined);
    void api.bigMatchMaps().then(setMaps).catch(() => undefined);
  }, [open]);

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
    const nav = (id: Page, label: string, icon: string): Cmd => ({ id: "go-" + id, label, icon, hint: t("abrir"), run: () => go(id) });
    const list: Cmd[] = [
      { id: "play", label: t("Jogar"), icon: "play_arrow", hint: t("ação"), run: async () => { await run("launch", () => api.launchGame(), t("Abrindo o jogo…")); await refresh(); } },
      { id: "apply", label: t("Aplicar o perfil sem jogar"), icon: "published_with_changes", hint: t("ação"), run: async () => { await run("apply", () => api.applyActive(), t("Perfil aplicado.")); await refresh(); } },
      { id: "purge", label: t("Voltar a pasta do jogo ao original"), icon: "restore", hint: t("ação"), run: async () => { await run("purge", () => api.purge(), t("Pasta do jogo restaurada.")); await refresh(); } },
      nav("home", t("Perfil ativo"), "sports_esports"),
      nav("library", t("Mods do perfil"), "extension"),
      nav("hub", t("Hub de mods"), "store"),
      nav("forja", t("Forja: carregador de mods e criar mods"), "construction"),
      nav("bigmatch", t("Partida grande: mais de 8 jogadores, times à vontade"), "groups"),
      nav("multiplayer", t("Multiplayer: salas e chat"), "hub"),
      nav("create", t("Criar: mapas, tropas e modelos 3D"), "add_box"),
      nav("files", t("Arquivos: espaço, cópias de segurança e lixeira"), "folder_open"),
      nav("icons", t("Gerador de ícones de tropas"), "photo_camera"),
      nav("studio", t("Estúdio de criação"), "construction"),
      nav("performance", t("Desempenho e diagnóstico"), "speed"),
      nav("me", t("Meus perfis"), "account_circle"),
      nav("settings", t("Configurações"), "settings"),
      ...(profiles?.profiles ?? []).map<Cmd>((p) => ({
        id: "profile-" + p.id, label: t("Usar o perfil {name}", { name: p.name }), icon: "swap_horiz", hint: t("perfil"),
        run: async () => { await switchProfile(p.id, p.name); },
      })),
      { id: "news", label: t("Novidades desta versão"), icon: "new_releases", hint: t("ação"), run: () => useStore.setState({ showNews: true }) },
      ...SETTINGS_SECTIONS.map<Cmd>(([id, label, icon]) => ({ id: "set-" + id, label: t(label), icon, hint: t("configuração"), run: () => useStore.getState().openSettings(id) })),
      ...creations.map<Cmd>((c) => ({
        id: "cre-" + c.id, label: c.name, icon: KIND_META[c.kind]?.icon ?? "draft", hint: t(KIND_META[c.kind]?.label ?? "projeto"),
        run: () => useTabs.getState().open(c),
      })),
      ...maps.map<Cmd>((m) => ({
        id: "map-" + m.path, label: t("Partida grande em {map} ({n} bases)", { map: m.name, n: m.armies.length }), icon: "map", hint: t("mapa"),
        run: () => { try { localStorage.setItem("cp-bigmatch-map", m.path); } catch { /* ok */ } go("bigmatch"); },
      })),
      ...mods.map<Cmd>((m) => ({
        id: "mod-" + m.manifest.id, label: m.enabled ? t("Desligar {name}", { name: m.manifest.name }) : t("Ligar {name}", { name: m.manifest.name }), icon: m.enabled ? "toggle_on" : "toggle_off", hint: "mod",
        run: async () => {
          const ok = await run("toggle:" + m.manifest.id, () => api.setModEnabled(m.manifest.id, !m.enabled), (m.enabled ? t("{name} desligado.", { name: m.manifest.name }) : t("{name} ligado.", { name: m.manifest.name })));
          if (ok !== undefined) await refreshMods();
        },
      })),
    ];
    const term = fold(q.trim());
    // sem busca: só as ações e páginas (criações e mapas aparecem ao digitar)
    if (!term) return list.filter((c) => !c.id.startsWith("cre-") && !c.id.startsWith("map-") && !c.id.startsWith("set-"));
    const words = term.split(/\s+/);
    const scored = list
      .map((c) => {
        const hay = fold(c.label + " " + (c.hint ?? ""));
        if (!words.every((w) => hay.includes(w))) return null;
        // começa com o termo > palavra que começa com o termo > contém
        const label = fold(c.label);
        const score = label.startsWith(term) ? 0 : new RegExp("\\b" + words[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(label) ? 1 : 2;
        return { c, score };
      })
      .filter((x): x is { c: Cmd; score: number } => !!x);
    return scored.sort((a, b) => a.score - b.score).map((x) => x.c);
  }, [q, mods, profiles, creations, maps, go, run, refresh, refreshMods]);

  if (!open) return null;
  const exec = async (c: Cmd) => {
    setPalette(false);
    await c.run();
  };
  return (
    <div className="palette-wrap" onMouseDown={(e) => e.target === e.currentTarget && setPalette(false)}>
      <div className="palette" role="dialog" aria-label={t("Ação rápida")}>
        <input ref={input} className="input" placeholder={t("Buscar páginas, ações, mods, projetos, mapas e configurações…")} value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPalette(false);
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(cmds.length - 1, s + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === "Enter" && cmds[sel]) void exec(cmds[sel]);
          }} />
        <div className="items" role="listbox">
          {cmds.length === 0 && <p className="muted" style={{ padding: 14 }}>{t("Nada encontrado.")}</p>}
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
