import { useEffect, useRef, useState } from "react";
import { Field, Icon, Notice, Switch, TaskProgress } from "../components/ui";
import { api, openUrl, pickFile } from "../lib/api";
import { community } from "../lib/community";
import { errorText, fmtBytes, useStore } from "../lib/store";
import type { FileStatus, MaptkStatus, MemoryStatus, Settings } from "../lib/types";
import { RELEASES_URL } from "../lib/update";

const ORIGIN: Record<FileStatus["origin"], string> = {
  stock: "do jogo",
  unmanaged: "instalado à mão",
  managed: "colocado pelo launcher",
  new: "novo",
};

const SECTIONS = [
  { id: "jogo", label: "Jogo", icon: "sports_esports" },
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
    const t = window.setTimeout(() => { scroller.current?.querySelector(`#sec-${target}`)?.scrollIntoView({ block: "start" }); }, 30);
    return () => window.clearTimeout(t);
  }, []);
  if (!s) return null;

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
          useStore.getState().toast("error", `Não deu para salvar: ${errorText(e)}`);
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
        <div className="overline" style={{ padding: "4px 12px" }}>Configurações</div>
        <nav className="nav-list">
          {SECTIONS.map((x) => (
            <button key={x.id} className="nav-link" aria-current={section === x.id ? "page" : undefined} onClick={() => jump(x.id)}>
              <Icon name={x.icon} /> {x.label}
              {x.id === "atualizacoes" && appUpdate && <span className="chip err" style={{ marginLeft: "auto" }}>1</span>}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className={`save-state ${saveState}`} aria-live="polite">
          <Icon name={saveState === "saving" ? "sync" : "cloud_done"} size={17} />
          {saveState === "saving" ? "Salvando…" : "Tudo salvo automaticamente"}
        </span>
      </aside>

      <div className="scroll" ref={scroller}>
        <div className="page" style={{ maxWidth: 900 }}>
          <section id="sec-jogo" className="col">
            <h2>Jogo</h2>
            <div className="card pad col">
              <Field label="Pasta do Supreme Commander 2" hint={s.gamePath ? "Escolhida manualmente." : "Detectada automaticamente (Steam/GOG)."}>
                <div className="row">
                  <input className="input" style={{ flex: 1 }} readOnly value={s.gamePath ?? d?.game?.root ?? "não encontrada"} />
                  <button className="btn" onClick={async () => { const dir = await pickFile([], true); if (dir) commit({ ...s, gamePath: dir }); }}><Icon name="folder_open" /> Escolher</button>
                  {s.gamePath && <button className="btn text" onClick={() => commit({ ...s, gamePath: null })}><Icon name="autorenew" /> Automático</button>}
                </div>
              </Field>
              <div className="setting-row">
                <div className="txt"><b>Abrir o jogo pela Steam</b><span>Recomendado: mantém lobbies, amigos e conquistas. Desligue para abrir o .exe direto (GOG ou argumentos extras).</span></div>
                <Switch checked={s.launchMode === "steam"} onChange={(v) => commit({ ...s, launchMode: v ? "steam" : "direct" })} label="Abrir pela Steam" />
              </div>
              {s.launchMode === "direct" && (
                <Field label="Argumentos extras" hint="Separados por espaço. Ex.: /windowed">
                  <input className="input" value={s.launchArgs.join(" ")} onChange={(e) => commit({ ...s, launchArgs: e.target.value.split(/\s+/).filter(Boolean) }, 700)} />
                </Field>
              )}
              <div className="setting-row">
                <div className="txt"><b>Aplicar o perfil antes de jogar</b><span>O botão Jogar instala e remove os mods do perfil ativo antes de abrir o jogo.</span></div>
                <Switch checked={s.applyBeforeLaunch} onChange={(v) => commit({ ...s, applyBeforeLaunch: v })} label="Aplicar antes de jogar" />
              </div>
              <div className="setting-row">
                <div className="txt"><b>Modelo 3D na tela inicial</b><span>Mostra uma unidade do seu jogo girando na tela inicial (lida da sua instalação). Clique no nome dela para trocar.</span></div>
                <Switch checked={s.showcase} onChange={(v) => commit({ ...s, showcase: v })} label="Modelo 3D na tela inicial" />
              </div>
              <MemoryLimit />
              <div className="setting-row">
                <div className="txt"><b>Voltar ao original quando o jogo fechar</b><span>Útil se você também joga sem o launcher ou usa “Verificar integridade” da Steam.</span></div>
                <Switch checked={s.restoreOnExit} onChange={(v) => commit({ ...s, restoreOnExit: v })} label="Restaurar ao fechar" />
              </div>
            </div>
          </section>

          <section id="sec-comunidade" className="col">
            <h2>Comunidade</h2>
            <div className="card pad col">
              <Field label="Servidor da comunidade" hint="Endereço de um cp-server: salas, chat e hub de mods. Só https (http só para localhost).">
                <div className="row">
                  <input className="input" style={{ flex: 1 }} placeholder="https://sc2.exemplo.com" value={s.serverUrl ?? ""} onChange={(e) => { commit({ ...s, serverUrl: e.target.value || null }, 700); setServerTest(null); }} />
                  <button className="btn" disabled={!s.serverUrl} onClick={async () => {
                    try {
                      const i = await community.info(s.serverUrl!);
                      setServerTest(`ok:${i.name} — ${i.rooms} sala(s)${i.hub ? ", com hub de mods" : ""}`);
                    } catch (e) {
                      setServerTest(`err:${(e as Error).message}`);
                    }
                  }}>Testar</button>
                </div>
              </Field>
              {serverTest && <Notice kind={serverTest.startsWith("ok:") ? "ok" : "err"}>{serverTest.slice(3)}</Notice>}
              <Field label="Apelido" hint="Como você aparece nas salas e no chat (2 a 20 caracteres).">
                <input className="input" value={s.nickname} maxLength={20} onChange={(e) => commit({ ...s, nickname: e.target.value }, 700)} />
              </Field>
            </div>
          </section>

          <section id="sec-hub" className="col">
            <h2>Hub de mods</h2>
            <div className="card pad col">
              <p className="muted small">Índices de mods (JSON) além do hub do servidor da comunidade. Só https.</p>
              {s.hubUrls.map((u) => (
                <div key={u} className="row">
                  <span className="mono selectable" style={{ flex: 1 }}>{u}</span>
                  <button className="btn icon-btn sm" aria-label={`Remover ${u}`} onClick={() => commit({ ...s, hubUrls: s.hubUrls.filter((x) => x !== u) })}><Icon name="delete" size={18} /></button>
                </div>
              ))}
              <form className="row" onSubmit={(e) => { e.preventDefault(); commit({ ...s, hubUrls: [...s.hubUrls, url.trim()] }); setUrl(""); }}>
                <input className="input" style={{ flex: 1 }} placeholder="https://…/index.json" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Novo hub" />
                <button className="btn" disabled={!url.trim().startsWith("https://") || s.hubUrls.includes(url.trim())}><Icon name="add" /> Adicionar</button>
              </form>
              <div className="setting-row">
                <div className="txt"><b>Procurar atualizações de mods ao abrir</b></div>
                <Switch checked={s.checkModUpdates} onChange={(v) => commit({ ...s, checkModUpdates: v })} label="Procurar atualizações de mods" />
              </div>
            </div>
          </section>

          <section id="sec-mapas" className="col">
            <h2>Estúdio de Mapas</h2>
            <div className="card pad col">
              {py?.ready ? <Notice kind="ok">Pronto — usando Python {py.python?.version}.</Notice> : <Notice kind="warn">{py?.message ?? "Verificando o Python…"}</Notice>}
              <Field label="Python (opcional)" hint="Deixe vazio para usar o Python que vem com o app ou o do sistema.">
                <div className="row">
                  <input className="input" style={{ flex: 1 }} value={s.pythonPath ?? ""} placeholder="C:\…\python.exe" onChange={(e) => commit({ ...s, pythonPath: e.target.value || null }, 700)} />
                  <button className="btn" onClick={async () => { const p = await pickFile([{ name: "Python", extensions: ["exe", ""] }]); if (p) commit({ ...s, pythonPath: p }); }}>Procurar</button>
                </div>
              </Field>
            </div>
          </section>

          <section id="sec-arquivos" className="col">
            <div className="row"><h2 style={{ flex: 1 }}>Arquivos do jogo</h2><button className="btn sm" disabled={!d?.game} onClick={async () => setFiles((await run("files", () => api.fileStatus())) ?? null)}>{files ? "Atualizar" : "Mostrar"}</button></div>
            <p className="muted small">Na primeira vez, o launcher registra como estava cada .scd da pasta. É isso que permite voltar ao original byte a byte.</p>
            {files && (
              <div className="list">
                {files.map((f) => (
                  <div key={f.name} className="list-row" style={{ padding: "8px 14px" }}>
                    <span className={`dot ${f.state === "ok" ? "ok" : f.state === "modified" ? "warn" : "err"}`} title={f.state} />
                    <span className="mono grow">{f.name}</span>
                    <span className="muted small">{ORIGIN[f.origin]}{f.modId ? ` (${f.modId})` : ""}</span>
                    <span className="faint small" style={{ width: 80, textAlign: "right" }}>{fmtBytes(f.size)}</span>
                    {f.state !== "ok" && <span className={`chip ${f.state === "missing" ? "err" : "warn"}`}>{f.state === "missing" ? "faltando" : "alterado"}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="sec-atualizacoes" className="col">
            <h2>Atualizações</h2>
            <div className="card pad col">
              {appUpdate ? <UpdateNow /> : (
                <div className="row wrap">
                  <p className="muted small" style={{ flex: 1 }}>Você está na versão {info?.version}. As versões novas saem em <a href="#" onClick={(e) => { e.preventDefault(); void openUrl(RELEASES_URL); }}>GitHub Releases</a>.</p>
                  <button className="btn sm" disabled={busyCheck} onClick={async () => {
                    const up = await run("checkupdate", () => api.appUpdateCheck());
                    if (up === undefined) return;
                    useStore.setState({ appUpdate: up });
                    if (!up) useStore.getState().toast("ok", `Você já está na versão mais nova (${info?.version}).`);
                  }}><Icon name="refresh" /> {busyCheck ? "Procurando…" : "Procurar agora"}</button>
                </div>
              )}
              <div className="setting-row">
                <div className="txt"><b>Avisar quando sair uma versão nova do launcher</b></div>
                <Switch checked={s.checkAppUpdates} onChange={(v) => commit({ ...s, checkAppUpdates: v })} label="Avisar sobre versões novas" />
              </div>
            </div>
          </section>

          <section id="sec-sobre" className="col">
            <h2>Sobre</h2>
            <div className="card pad col">
              <p>CommandProject {info?.version}. Projeto independente e de código aberto (MIT).</p>
              <p className="small muted">
                O Estúdio de Mapas usa o <a href="#" onClick={(e) => { e.preventDefault(); openUrl("https://github.com/plutonics72/supcom2-map-toolkit"); }}>SC2 Map Toolkit</a> de plutonics72 (MIT).
                Supreme Commander 2 é marca registrada de seus respectivos donos; este app não contém nem distribui arquivos do jogo.
              </p>
              {info && <div className="row"><span className="mono faint selectable" style={{ flex: 1 }}>{info.dataDir}</span><button className="btn sm" onClick={() => void run("open", () => api.openPath(info.dataDir))}><Icon name="folder_open" /> Abrir pasta de dados</button></div>}
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
      <b>CommandProject {up.version} disponível.</b>
      {up.notes && <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: 6, maxHeight: 160, overflow: "auto" }}>{up.notes}</p>}
      {busy ? (
        <div style={{ marginTop: 10 }}><TaskProgress task="update" label="Preparando o download…" /></div>
      ) : (
        <div className="row wrap" style={{ marginTop: 10 }}>
          {up.assetUrl ? (
            <button className="btn primary sm" onClick={() => void run("update", () => api.appUpdateInstall(up), "Instalando a atualização. O launcher vai reabrir sozinho.")}>
              <Icon name="system_update" /> Atualizar agora{up.size ? ` (${fmtBytes(up.size)})` : ""}
            </button>
          ) : null}
          <button className="btn text sm" onClick={() => void openUrl(up.url)}><Icon name="open_in_new" /> Ver no GitHub</button>
        </div>
      )}
      <p className="faint small" style={{ marginTop: 6 }}>Baixa direto do GitHub, confere o arquivo e instala sem perguntas. Seus mods, perfis e configurações ficam como estão.</p>
    </Notice>
  );
}

const fmtGb = (mb: number) => `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;

/** Quanta memória o jogo pode usar: de 2 GB (original) até 4 GB (máximo de um jogo de 32 bits). */
function MemoryLimit() {
  const { run } = useStore.getState();
  const busy = useStore((s) => s.busy.memory);
  const [st, setSt] = useState<MemoryStatus | null | undefined>(undefined);
  useEffect(() => { api.memoryStatus().then(setSt).catch(() => setSt(null)); }, []);
  if (st === undefined) return null;
  if (st === null || !st.laa) {
    return (
      <div className="setting-row">
        <div className="txt"><b>Memória do jogo</b><span>Configure a pasta do jogo para escolher quanta memória ele pode usar.</span></div>
      </div>
    );
  }
  const laa = st.laa;
  const locked = laa.is64bit || (laa.enabled && !laa.patchedByUs);
  const set = async (mb: number) => {
    const r = await run("memory", () => api.memorySet(mb), mb <= 2048 ? "Memória: 2 GB (original). O executável voltou ao original." : `Memória do jogo: até ${fmtGb(mb)}.`);
    if (r) {
      setSt(r);
      useStore.setState({ settings: await api.getSettings() });
    }
  };
  return (
    <div className="memory-box" id="modo-4gb">
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="txt" style={{ flex: 1 }}>
          <b>Memória que o jogo pode usar</b>
          <span className="muted small">
            O SC2 é um programa de 32 bits: sozinho ele usa até 2 GB, e o máximo possível para ele é 4 GB (mesmo num PC com mais RAM).
            Escolha um teto: acima de 2 GB o launcher libera o "modo 4 GB" no executável e, quando o jogo abre, aplica o limite escolhido.
          </span>
        </div>
        <div className="mem-pc">
          <span className="overline">Seu PC</span>
          <b>{fmtGb(st.system.totalMb)}</b>
          <span className="faint small">{fmtGb(st.system.availableMb)} livres agora</span>
        </div>
      </div>
      <div className="mem-choices" role="radiogroup" aria-label="Memória do jogo">
        {st.choices.map((mb) => (
          <button key={mb} role="radio" aria-checked={st.limitMb === mb} className="mem-choice" disabled={busy || (locked && mb !== st.limitMb)} onClick={() => void set(mb)}>
            <b>{fmtGb(mb)}</b>
            <span>{[mb === 2048 ? "original" : mb === 4096 ? "máximo" : "", mb === st.recommendedMb ? "recomendado" : ""].filter(Boolean).join(" · ") || "\u00a0"}</span>
          </button>
        ))}
      </div>
      <div className="chips">
        {laa.is64bit ? <span className="chip ok">O executável já é 64 bits</span> : laa.enabled ? <span className="chip ok"><Icon name="memory" /> Modo 4 GB ligado no executável</span> : <span className="chip">Executável original (2 GB)</span>}
        {st.limitMb > 2048 && st.limitMb < 4096 && <span className="chip info">Limite de {fmtGb(st.limitMb)} aplicado quando o jogo abrir</span>}
        {laa.enabled && !laa.patchedByUs && <span className="chip info">Já vinha ligado</span>}
        {laa.revertedByUpdate && <span className="chip warn">A Steam restaurou o executável: será reaplicado ao jogar</span>}
        {laa.steamStub && <span className="chip warn">Executável com proteção da Steam: se o jogo não abrir, volte para 2 GB</span>}
        {st.system.totalMb > 0 && st.limitMb > st.system.totalMb * 0.6 && <span className="chip warn">Seu PC tem pouca RAM para esse limite: feche outros programas</span>}
      </div>
    </div>
  );
}
