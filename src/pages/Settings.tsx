import { useEffect, useRef, useState } from "react";
import { Field, Icon, Notice, Switch, TaskProgress } from "../components/ui";
import { api, openUrl, pickFile } from "../lib/api";
import { community } from "../lib/community";
import { errorText, fmtBytes, useStore } from "../lib/store";
import type { FileStatus, MaptkStatus, MemoryStatus, Settings } from "../lib/types";
import { RELEASES_URL } from "../lib/update";
import { LANGS, locale, setLang, t, tr, useLang } from "../lib/i18n";

const ORIGIN: Record<FileStatus["origin"], string> = {
  stock: "do jogo",
  unmanaged: "instalado à mão",
  managed: "colocado pelo launcher",
  new: "novo",
};

const SECTIONS = [
  { id: "jogo", label: "Jogo", icon: "sports_esports" },
  { id: "local", label: "Modo local e cópias", icon: "cloud_off" },
  { id: "visual", label: "Visual", icon: "palette" },
  { id: "diagnostico", label: "Diagnóstico", icon: "monitor_heart" },
  { id: "comunidade", label: "Comunidade", icon: "hub" },
  { id: "hub", label: "Hub de mods", icon: "store" },
  { id: "mapas", label: "Estúdio de Mapas", icon: "map" },
  { id: "arquivos", label: "Arquivos do jogo", icon: "folder_zip" },
  { id: "atualizacoes", label: "Atualizações", icon: "system_update" },
  { id: "sobre", label: "Sobre", icon: "info" },
];

export default function SettingsPage() {
  const saved = useStore((s) => s.settings);
  const d = useStore((s) => s.dashboard);
  const info = useStore((s) => s.info);
  const appUpdate = useStore((s) => s.appUpdate);
  const busyCheck = useStore((s) => s.busy.checkupdate);
  const { run, refresh } = useStore.getState();
  const [s, setS] = useState<Settings | null>(saved);
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<FileStatus[] | null>(null);
  const [py, setPy] = useState<MaptkStatus | null>(null);
  const [serverTest, setServerTest] = useState<string | null>(null);
  const [section, setSection] = useState(() => useStore.getState().settingsSection ?? "jogo");
  const scroller = useRef<HTMLDivElement>(null);

  // salva sozinho: cada mudança vai para o disco (textos esperam a pessoa parar de digitar)
  const pending = useRef<number | undefined>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => { if (pending.current === undefined) setS(saved); }, [saved]);
  const latest = useRef<Settings | null>(null);
  // saiu da tela com algo esperando para salvar: salva na hora
  useEffect(() => () => {
    if (pending.current !== undefined && latest.current) {
      window.clearTimeout(pending.current);
      void api.saveSettings(latest.current).then((r) => useStore.setState({ settings: r })).catch(() => {});
    }
  }, []);
  useEffect(() => { api.maptkStatus().then(setPy).catch(() => setPy(null)); }, [saved?.pythonPath]);
  // aberto por um atalho ("Configurar servidor", "Atualizar agora"…): vai direto à seção
  useEffect(() => {
    const target = useStore.getState().settingsSection;
    if (!target) return;
    useStore.setState({ settingsSection: null });
    const timer = window.setTimeout(() => { scroller.current?.querySelector(`#sec-${target}`)?.scrollIntoView({ block: "start" }); }, 30);
    return () => window.clearTimeout(timer);
  }, []);
  if (!s) return null;

  const lang = useLang((x) => x.lang);
  const commit = (next: Settings, delay = 0) => {
    setS(next);
    latest.current = next;
    // endereço digitado pela metade não vai para o disco (seria recusado a cada tecla)
    const typing = next.serverUrl && !/^https:\/\/[^/\s]+\.[^/\s]+|^http:\/\/(localhost|127\.0\.0\.1)/.test(next.serverUrl);
    if (typing) { window.clearTimeout(pending.current); pending.current = undefined; return; }
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      setSaveState("saving");
      chain.current = chain.current.then(async () => {
        try {
          const before = useStore.getState().settings;
          const r = await api.saveSettings(next);
          useStore.setState({ settings: r });
          setSaveState("saved");
          if (before?.gamePath !== r.gamePath || before?.launchMode !== r.launchMode) await refresh();
        } catch (e) {
          setSaveState("idle");
          useStore.getState().toast("error", t("Não deu para salvar: {error}", { error: errorText(e) }));
        }
      });
    }, delay);
  };
  const jump = (id: string) => {
    setSection(id);
    scroller.current?.querySelector(`#sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <aside className="side-panel">
        <div className="overline" style={{ padding: "4px 12px" }}>{t("Configurações")}</div>
        <nav className="nav-list">
          {SECTIONS.map((x) => (
            <button key={x.id} className="nav-link" aria-current={section === x.id ? "page" : undefined} onClick={() => jump(x.id)}>
              <Icon name={x.icon} /> {t(x.label)}
              {x.id === "atualizacoes" && appUpdate && <span className="chip err" style={{ marginLeft: "auto" }}>1</span>}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className={`save-state ${saveState}`} aria-live="polite">
          <Icon name={saveState === "saving" ? "sync" : "cloud_done"} size={17} />
          {saveState === "saving" ? t("Salvando…") : t("Tudo salvo automaticamente")}
        </span>
      </aside>

      <div className="scroll" ref={scroller}>
        <div className="page" style={{ maxWidth: 900 }}>
          <section id="sec-jogo" className="col">
            <h2>{t("Jogo")}</h2>
            <div className="card pad col">
              <Field label={t("Pasta do Supreme Commander 2")} hint={s.gamePath ? t("Escolhida manualmente.") : t("Detectada automaticamente (Steam/GOG).")}>
                <div className="row">
                  <input className="input" style={{ flex: 1 }} readOnly value={s.gamePath ?? d?.game?.root ?? t("não encontrada")} />
                  <button className="btn" onClick={async () => { const dir = await pickFile([], true); if (dir) commit({ ...s, gamePath: dir }); }}><Icon name="folder_open" /> {t("Escolher")}</button>
                  {s.gamePath && <button className="btn text" onClick={() => commit({ ...s, gamePath: null })}><Icon name="autorenew" /> {t("Automático")}</button>}
                </div>
              </Field>
              <div className="setting-row">
                <div className="txt"><b>{t("Abrir o jogo pela Steam")}</b><span>{t("Recomendado: mantém lobbies, amigos e conquistas. Desligue para abrir o .exe direto (GOG ou argumentos extras).")}</span></div>
                <Switch checked={s.launchMode === "steam"} onChange={(v) => commit({ ...s, launchMode: v ? "steam" : "direct" })} label={t("Abrir pela Steam")} />
              </div>
              {s.launchMode === "direct" && (
                <Field label={t("Argumentos extras")} hint={t("Separados por espaço. Ex.: /windowed")}>
                  <input className="input" value={s.launchArgs.join(" ")} onChange={(e) => commit({ ...s, launchArgs: e.target.value.split(/\s+/).filter(Boolean) }, 700)} />
                </Field>
              )}
              <div className="setting-row">
                <div className="txt"><b>{t("Aplicar o perfil antes de jogar")}</b><span>{t("O botão Jogar instala e remove os mods do perfil ativo antes de abrir o jogo.")}</span></div>
                <Switch checked={s.applyBeforeLaunch} onChange={(v) => commit({ ...s, applyBeforeLaunch: v })} label={t("Aplicar antes de jogar")} />
              </div>
              <div className="setting-row">
                <div className="txt"><b>{t("Modelo 3D na tela inicial")}</b><span>{t("Mostra uma unidade do seu jogo girando na tela inicial (lida da sua instalação). Clique no nome dela para trocar.")}</span></div>
                <Switch checked={s.showcase} onChange={(v) => commit({ ...s, showcase: v })} label={t("Modelo 3D na tela inicial")} />
              </div>
              <MemoryLimit />
              <div className="setting-row">
                <div className="txt"><b>{t("Voltar ao original quando o jogo fechar")}</b><span>{t("Útil se você também joga sem o launcher ou usa “Verificar integridade” da Steam.")}</span></div>
                <Switch checked={s.restoreOnExit} onChange={(v) => commit({ ...s, restoreOnExit: v })} label={t("Restaurar ao fechar")} />
              </div>
            </div>
          </section>

          <section id="sec-local" className="col">
            <h2>{t("Modo local e cópias de segurança")}</h2>
            <div className="card pad col">
              <div className="setting-row">
                <div className="txt"><b>{t("Modo local (sem internet)")}</b><span>{t("Desliga tudo que usa rede: hub de mods, servidor da comunidade, busca de atualizações do launcher e dos mods. Mapas, tropas, modelos, texturas e ícones funcionam 100% no computador de qualquer jeito.")}</span></div>
                <Switch checked={!!s.offline} onChange={(v) => commit({ ...s, offline: v, checkAppUpdates: v ? false : s.checkAppUpdates, checkModUpdates: v ? false : s.checkModUpdates })} label={t("Modo local")} />
              </div>
              <div className="setting-row">
                <div className="txt"><b>{t("Cópia de segurança automática dos projetos")}</b><span>{t("Um .zip na pasta de dados com todos os projetos e as configurações. As 5 mais recentes ficam guardadas.")}</span></div>
                <select className="select dense" value={s.autoBackupDays ?? 7} onChange={(e) => commit({ ...s, autoBackupDays: Number(e.target.value) })}>
                  <option value={0}>{t("desligada")}</option><option value={1}>{t("todo dia")}</option><option value={3}>{t("a cada 3 dias")}</option><option value={7}>{t("toda semana")}</option><option value={14}>{t("a cada 2 semanas")}</option><option value={30}>{t("todo mês")}</option>
                </select>
              </div>
              <div className="row" style={{ gap: 8 }}><button className="btn" onClick={() => useStore.getState().go("files")}><Icon name="folder_open" /> {t("Arquivos, cópias e lixeira")}</button></div>
            </div>
          </section>

          <section id="sec-visual" className="col">
            <h2>{t("Visual")}</h2>
            <div className="card pad col">
              <div className="setting-row">
                <div className="txt"><b>Idioma · Language</b><span>{t("Idioma do launcher. Em português (Brasil), o jogo também fica em português.")}</span></div>
                <div className="chips" style={{ padding: 0 }}>
                  {LANGS.map((l) => (
                    <button key={l.id} className="chip" aria-pressed={lang === l.id} onClick={() => { setLang(l.id); commit({ ...s, uiPrefs: { ...(s.uiPrefs ?? {}), lang: l.id } }); }}>
                      <b className="lang-flag">{l.flag}</b> {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div className="txt"><b>{t("Estilo da interface")}</b><span>{t('"Comando" usa painéis táticos, botões chanfrados e moldura de comando inspirados no jogo (arte própria do launcher). "Clássico" é o visual anterior.')}</span></div>
                <div className="chips" style={{ padding: 0 }}>
                  {[["sc", "Comando"], ["classic", "Clássico"]].map(([k, l]) => <button key={k} className="chip" aria-pressed={(s.uiPrefs?.skin ?? "sc") === k} onClick={() => commit({ ...s, uiPrefs: { ...(s.uiPrefs ?? {}), skin: k } })}>{t(l)}</button>)}
                </div>
              </div>
              <div className="setting-row">
                <div className="txt"><b>{t("Cor de destaque")}</b><span>{t("Cores das facções para o estilo Comando.")}</span></div>
                <div className="chips" style={{ padding: 0 }}>
                  {[["uef", "UEF", "#4cb8ff"], ["cybran", "Cybran", "#ff5a5a"], ["illuminate", "Illuminate", "#f2c14e"], ["original", "Original", "#a3e635"]].map(([k, l, c]) => (
                    <button key={k} className="chip" aria-pressed={(s.uiPrefs?.faction ?? "uef") === k} onClick={() => commit({ ...s, uiPrefs: { ...(s.uiPrefs ?? {}), faction: k } })}><i className="swatch-dot" style={{ background: c }} /> {k === "original" ? t(l) : l}</button>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <div className="txt"><b>{t("Arte do jogo no launcher")}</b><span>{t("Usa as imagens dos menus do próprio Supreme Commander 2 (lidas da sua instalação) nos cabeçalhos e janelas.")}</span></div>
                <Switch checked={s.uiPrefs?.gameArt !== false} onChange={(v) => commit({ ...s, uiPrefs: { ...(s.uiPrefs ?? {}), gameArt: v } })} label={t("Arte do jogo no launcher")} />
              </div>
              <div className="setting-row">
                <div className="txt"><b>{t("Menos animações")}</b><span>{t("Tira as transições e brilhos (o sistema também pode pedir isso).")}</span></div>
                <Switch checked={!!s.uiPrefs?.reduceMotion} onChange={(v) => commit({ ...s, uiPrefs: { ...(s.uiPrefs ?? {}), reduceMotion: v } })} label={t("Menos animações")} />
              </div>
            </div>
          </section>

          <section id="sec-diagnostico" className="col">
            <h2>{t("Diagnóstico")}</h2>
            <div className="card pad col">
              <p className="muted small">{t("Desempenho do jogo, memória, prioridade, relatórios de travamento, conflitos entre mods e opções gráficas ficam no Otimizador.")}</p>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => useStore.getState().go("performance")}><Icon name="speed" /> {t("Abrir o Otimizador")}</button>
                <button className="btn" onClick={() => useStore.getState().go("files")}><Icon name="storage" /> {t("Espaço em disco")}</button>
              </div>
            </div>
          </section>

          <section id="sec-comunidade" className="col">
            <h2>{t("Comunidade")}</h2>
            <div className="card pad col">
              <Field label={t("Servidor da comunidade")} hint={t("Endereço de um cp-server: salas, chat e hub de mods. Só https (http só para localhost).")}>
                <div className="row">
                  <input className="input" style={{ flex: 1 }} placeholder={t("https://sc2.exemplo.com")} value={s.serverUrl ?? ""} onChange={(e) => { commit({ ...s, serverUrl: e.target.value || null }, 700); setServerTest(null); }} />
                  <button className="btn" disabled={!s.serverUrl} onClick={async () => {
                    try {
                      const i = await community.info(s.serverUrl!);
                      setServerTest(`ok:${i.hub ? t("{name} — {n} sala(s), com hub de mods", { name: i.name, n: i.rooms }) : t("{name} — {n} sala(s)", { name: i.name, n: i.rooms })}`);
                    } catch (e) {
                      setServerTest(`err:${errorText(e)}`);
                    }
                  }}>{t("Testar")}</button>
                </div>
              </Field>
              {serverTest && <Notice kind={serverTest.startsWith("ok:") ? "ok" : "err"}>{serverTest.slice(3)}</Notice>}
              <Field label={t("Apelido")} hint={t("Como você aparece nas salas e no chat (2 a 20 caracteres).")}>
                <input className="input" value={s.nickname} maxLength={20} onChange={(e) => commit({ ...s, nickname: e.target.value }, 700)} />
              </Field>
            </div>
          </section>

          <section id="sec-hub" className="col">
            <h2>{t("Hub de mods")}</h2>
            <div className="card pad col">
              <p className="muted small">{t("Índices de mods (JSON) além do hub do servidor da comunidade. Só https.")}</p>
              {s.hubUrls.map((u) => (
                <div key={u} className="row">
                  <span className="mono selectable" style={{ flex: 1 }}>{u}</span>
                  <button className="btn icon-btn sm" aria-label={t("Remover {name}", { name: u })} onClick={() => commit({ ...s, hubUrls: s.hubUrls.filter((x) => x !== u) })}><Icon name="delete" size={18} /></button>
                </div>
              ))}
              <form className="row" onSubmit={(e) => { e.preventDefault(); commit({ ...s, hubUrls: [...s.hubUrls, url.trim()] }); setUrl(""); }}>
                <input className="input" style={{ flex: 1 }} placeholder="https://…/index.json" value={url} onChange={(e) => setUrl(e.target.value)} aria-label={t("Novo hub")} />
                <button className="btn" disabled={!url.trim().startsWith("https://") || s.hubUrls.includes(url.trim())}><Icon name="add" /> {t("Adicionar")}</button>
              </form>
              <div className="setting-row">
                <div className="txt"><b>{t("Procurar atualizações de mods ao abrir")}</b></div>
                <Switch checked={s.checkModUpdates} onChange={(v) => commit({ ...s, checkModUpdates: v })} label={t("Procurar atualizações de mods")} />
              </div>
            </div>
          </section>

          <section id="sec-mapas" className="col">
            <h2>{t("Estúdio de Mapas")}</h2>
            <div className="card pad col">
              {py?.ready ? <Notice kind="ok">{t("Pronto — usando Python {version}.", { version: py.python?.version ?? "" })}</Notice> : <Notice kind="warn">{py?.message ? tr(py.message) : t("Verificando o Python…")}</Notice>}
              <Field label={t("Python (opcional)")} hint={t("Deixe vazio para usar o Python que vem com o app ou o do sistema.")}>
                <div className="row">
                  <input className="input" style={{ flex: 1 }} value={s.pythonPath ?? ""} placeholder="C:\…\python.exe" onChange={(e) => commit({ ...s, pythonPath: e.target.value || null }, 700)} />
                  <button className="btn" onClick={async () => { const p = await pickFile([{ name: "Python", extensions: ["exe", ""] }]); if (p) commit({ ...s, pythonPath: p }); }}>{t("Procurar")}</button>
                </div>
              </Field>
            </div>
          </section>

          <section id="sec-arquivos" className="col">
            <div className="row"><h2 style={{ flex: 1 }}>{t("Arquivos do jogo")}</h2><button className="btn sm" disabled={!d?.game} onClick={async () => setFiles((await run("files", () => api.fileStatus())) ?? null)}>{files ? t("Atualizar") : t("Mostrar")}</button></div>
            <p className="muted small">{t("Na primeira vez, o launcher registra como estava cada .scd da pasta. É isso que permite voltar ao original byte a byte.")}</p>
            {files && (
              <div className="list">
                {files.map((f) => (
                  <div key={f.name} className="list-row" style={{ padding: "8px 14px" }}>
                    <span className={`dot ${f.state === "ok" ? "ok" : f.state === "modified" ? "warn" : "err"}`} title={f.state} />
                    <span className="mono grow">{f.name}</span>
                    <span className="muted small">{t(ORIGIN[f.origin])}{f.modId ? ` (${f.modId})` : ""}</span>
                    <span className="faint small" style={{ width: 80, textAlign: "right" }}>{fmtBytes(f.size)}</span>
                    {f.state !== "ok" && <span className={`chip ${f.state === "missing" ? "err" : "warn"}`}>{f.state === "missing" ? t("faltando") : t("alterado")}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="sec-atualizacoes" className="col">
            <h2>{t("Atualizações")}</h2>
            <div className="card pad col">
              {appUpdate ? <UpdateNow /> : (
                <div className="row wrap">
                  <p className="muted small" style={{ flex: 1 }}>{t("Você está na versão {version}. As versões novas saem em", { version: info?.version ?? "" })} <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(RELEASES_URL); }}>GitHub Releases</a>.</p>
                  <button className="btn sm" disabled={busyCheck} onClick={async () => {
                    const up = await run("checkupdate", () => api.appUpdateCheck());
                    if (up === undefined) return;
                    useStore.setState({ appUpdate: up });
                    if (!up) useStore.getState().toast("ok", t("Você já está na versão mais nova ({version}).", { version: info?.version ?? "" }));
                  }}><Icon name="refresh" /> {busyCheck ? t("Procurando…") : t("Procurar agora")}</button>
                </div>
              )}
              <div className="setting-row">
                <div className="txt"><b>{t("Avisar quando sair uma versão nova do launcher")}</b></div>
                <Switch checked={s.checkAppUpdates} onChange={(v) => commit({ ...s, checkAppUpdates: v })} label={t("Avisar sobre versões novas")} />
              </div>
            </div>
          </section>

          <section id="sec-sobre" className="col">
            <h2>{t("Sobre")}</h2>
            <div className="card pad col">
              <p>{t("CommandProject {version}. Projeto independente e de código aberto (MIT).", { version: info?.version ?? "" })}</p>
              <p className="small muted">
                {t("O Estúdio de Mapas usa o")} <a href="#" onClick={(e) => { e.preventDefault(); openUrl("https://github.com/plutonics72/supcom2-map-toolkit"); }}>SC2 Map Toolkit</a> {t("de plutonics72 (MIT).")}{" "}
                {t("Supreme Commander 2 é marca registrada de seus respectivos donos; este app não contém nem distribui arquivos do jogo.")}
              </p>
              {info && <div className="row"><span className="mono faint selectable" style={{ flex: 1 }}>{info.dataDir}</span><button className="btn sm" onClick={() => void run("open", () => api.openPath(info.dataDir))}><Icon name="folder_open" /> {t("Abrir pasta de dados")}</button></div>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/** Atualizar o launcher sem sair dele: baixa, instala em modo rápido e reabre sozinho. */
function UpdateNow() {
  const up = useStore((s) => s.appUpdate)!;
  const busy = useStore((s) => s.busy.update);
  const { run } = useStore.getState();
  return (
    <Notice kind="info">
      <b>{t("CommandProject {version} disponível.", { version: up.version })}</b>
      {up.notes && <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: 6, maxHeight: 160, overflow: "auto" }}>{up.notes}</p>}
      {busy ? (
        <div style={{ marginTop: 10 }}><TaskProgress task="update" label={t("Preparando o download…")} /></div>
      ) : (
        <div className="row wrap" style={{ marginTop: 10 }}>
          {up.assetUrl ? (
            <button className="btn primary sm" onClick={() => void run("update", () => api.appUpdateInstall(up), t("Instalando a atualização. O launcher vai reabrir sozinho."))}>
              <Icon name="system_update" /> {t("Atualizar agora")}{up.size ? ` (${fmtBytes(up.size)})` : ""}
            </button>
          ) : null}
          <button className="btn text sm" onClick={() => void openUrl(up.url)}><Icon name="open_in_new" /> {t("Ver no GitHub")}</button>
        </div>
      )}
      <p className="faint small" style={{ marginTop: 6 }}>{t("Baixa direto do GitHub, confere o arquivo e instala sem perguntas. Seus mods, perfis e configurações ficam como estão.")}</p>
    </Notice>
  );
}

const fmtGb = (mb: number) => `${(mb / 1024).toLocaleString(locale(), { maximumFractionDigits: 1 })} GB`;

/** Quanta memória o jogo pode usar: de 2 GB (original) até 4 GB (máximo de um jogo de 32 bits). */
export function MemoryLimit() {
  const { run } = useStore.getState();
  const busy = useStore((s) => s.busy.memory);
  const [st, setSt] = useState<MemoryStatus | null | undefined>(undefined);
  useEffect(() => { api.memoryStatus().then(setSt).catch(() => setSt(null)); }, []);
  if (st === undefined) return null;
  if (st === null || !st.laa) {
    return (
      <div className="setting-row">
        <div className="txt"><b>{t("Memória do jogo")}</b><span>{t("Configure a pasta do jogo para escolher quanta memória ele pode usar.")}</span></div>
      </div>
    );
  }
  const laa = st.laa;
  const locked = laa.is64bit || (laa.enabled && !laa.patchedByUs);
  const set = async (mb: number) => {
    const r = await run("memory", () => api.memorySet(mb), mb <= 2048 ? t("Memória: 2 GB (original). O executável voltou ao original.") : t("Memória do jogo: até {size}.", { size: fmtGb(mb) }));
    if (r) {
      setSt(r);
      useStore.setState({ settings: await api.getSettings() });
    }
  };
  return (
    <div className="memory-box" id="modo-4gb">
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="txt" style={{ flex: 1 }}>
          <b>{t("Memória que o jogo pode usar")}</b>
          <span className="muted small">
            {t("O SC2 é um programa de 32 bits: sozinho ele usa até 2 GB, e o máximo possível para ele é 4 GB (mesmo num PC com mais RAM).")}{" "}
            {t('Escolha um teto: acima de 2 GB o launcher libera o "modo 4 GB" no executável e, quando o jogo abre, aplica o limite escolhido.')}
          </span>
        </div>
        <div className="mem-pc">
          <span className="overline">{t("Seu PC")}</span>
          <b>{fmtGb(st.system.totalMb)}</b>
          <span className="faint small">{t("{size} livres agora", { size: fmtGb(st.system.availableMb) })}</span>
        </div>
      </div>
      <div className="mem-choices" role="radiogroup" aria-label={t("Memória do jogo")}>
        {st.choices.map((mb) => (
          <button key={mb} role="radio" aria-checked={st.limitMb === mb} className="mem-choice" disabled={busy || (locked && mb !== st.limitMb)} onClick={() => void set(mb)}>
            <b>{fmtGb(mb)}</b>
            <span>{[mb === 2048 ? t("original") : mb === 4096 ? t("máximo") : "", mb === st.recommendedMb ? t("recomendado") : ""].filter(Boolean).join(" · ") || "\u00a0"}</span>
          </button>
        ))}
      </div>
      <div className="chips">
        {laa.is64bit ? <span className="chip ok">{t("O executável já é 64 bits")}</span> : laa.enabled ? <span className="chip ok"><Icon name="memory" /> {t("Modo 4 GB ligado no executável")}</span> : <span className="chip">{t("Executável original (2 GB)")}</span>}
        {st.limitMb > 2048 && st.limitMb < 4096 && <span className="chip info">{t("Limite de {size} aplicado quando o jogo abrir", { size: fmtGb(st.limitMb) })}</span>}
        {laa.enabled && !laa.patchedByUs && <span className="chip info">{t("Já vinha ligado")}</span>}
        {laa.revertedByUpdate && <span className="chip warn">{t("A Steam restaurou o executável: será reaplicado ao jogar")}</span>}
        {laa.steamStub && <span className="chip warn">{t("Executável com proteção da Steam: se o jogo não abrir, volte para 2 GB")}</span>}
        {st.system.totalMb > 0 && st.limitMb > st.system.totalMb * 0.6 && <span className="chip warn">{t("Seu PC tem pouca RAM para esse limite: feche outros programas")}</span>}
      </div>
    </div>
  );
}
