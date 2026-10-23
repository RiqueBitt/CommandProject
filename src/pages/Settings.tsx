import { useEffect, useRef, useState } from "react";
import { Field, Icon, Notice, Switch } from "../components/ui";
import { api, openUrl, pickFile } from "../lib/api";
import { community } from "../lib/community";
import { fmtBytes, useStore } from "../lib/store";
import type { FileStatus, LaaStatus, MaptkStatus, Settings } from "../lib/types";
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
  const { run, refresh } = useStore.getState();
  const [s, setS] = useState<Settings | null>(saved);
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<FileStatus[] | null>(null);
  const [py, setPy] = useState<MaptkStatus | null>(null);
  const [serverTest, setServerTest] = useState<string | null>(null);
  const [section, setSection] = useState("jogo");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { setS(saved); }, [saved]);
  useEffect(() => { api.maptkStatus().then(setPy).catch(() => setPy(null)); }, [saved?.pythonPath]);
  if (!s) return null;

  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const save = async () => {
    const r = await run("settings", () => api.saveSettings(s), "Configurações salvas.");
    if (r) await refresh();
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
        <button className="btn primary" disabled={!dirty} onClick={save}><Icon name="save" /> Salvar alterações</button>
      </aside>

      <div className="scroll" ref={scroller}>
        <div className="page" style={{ maxWidth: 900 }}>
          <section id="sec-jogo" className="col">
            <h2>Jogo</h2>
            <div className="card pad col">
              <Field label="Pasta do Supreme Commander 2" hint={s.gamePath ? "Escolhida manualmente." : "Detectada automaticamente (Steam/GOG)."}>
                <div className="row">
                  <input className="input" style={{ flex: 1 }} readOnly value={s.gamePath ?? d?.game?.root ?? "não encontrada"} />
                  <button className="btn" onClick={async () => { const dir = await pickFile([], true); if (dir) setS({ ...s, gamePath: dir }); }}><Icon name="folder_open" /> Escolher</button>
                  {s.gamePath && <button className="btn text" onClick={() => setS({ ...s, gamePath: null })}><Icon name="autorenew" /> Automático</button>}
                </div>
              </Field>
              <div className="setting-row">
                <div className="txt"><b>Abrir o jogo pela Steam</b><span>Recomendado: mantém lobbies, amigos e conquistas. Desligue para abrir o .exe direto (GOG ou argumentos extras).</span></div>
                <Switch checked={s.launchMode === "steam"} onChange={(v) => setS({ ...s, launchMode: v ? "steam" : "direct" })} label="Abrir pela Steam" />
              </div>
              {s.launchMode === "direct" && (
                <Field label="Argumentos extras" hint="Separados por espaço. Ex.: /windowed">
                  <input className="input" value={s.launchArgs.join(" ")} onChange={(e) => setS({ ...s, launchArgs: e.target.value.split(/\s+/).filter(Boolean) })} />
                </Field>
              )}
              <div className="setting-row">
                <div className="txt"><b>Aplicar o perfil antes de jogar</b><span>O botão Jogar instala e remove os mods do perfil ativo antes de abrir o jogo.</span></div>
                <Switch checked={s.applyBeforeLaunch} onChange={(v) => setS({ ...s, applyBeforeLaunch: v })} label="Aplicar antes de jogar" />
              </div>
              <MemoryMode onChange={(v) => setS({ ...s, keepLargeAddress: v })} />
              <div className="setting-row">
                <div className="txt"><b>Voltar ao original quando o jogo fechar</b><span>Útil se você também joga sem o launcher ou usa “Verificar integridade” da Steam.</span></div>
                <Switch checked={s.restoreOnExit} onChange={(v) => setS({ ...s, restoreOnExit: v })} label="Restaurar ao fechar" />
              </div>
            </div>
          </section>

          <section id="sec-comunidade" className="col">
            <h2>Comunidade</h2>
            <div className="card pad col">
              <Field label="Servidor da comunidade" hint="Endereço de um cp-server: salas, chat e hub de mods. Só https (http só para localhost).">
                <div className="row">
                  <input className="input" style={{ flex: 1 }} placeholder="https://sc2.exemplo.com" value={s.serverUrl ?? ""} onChange={(e) => { setS({ ...s, serverUrl: e.target.value || null }); setServerTest(null); }} />
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
                <input className="input" value={s.nickname} maxLength={20} onChange={(e) => setS({ ...s, nickname: e.target.value })} />
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
                  <button className="btn icon-btn sm" aria-label={`Remover ${u}`} onClick={() => setS({ ...s, hubUrls: s.hubUrls.filter((x) => x !== u) })}><Icon name="delete" size={18} /></button>
                </div>
              ))}
              <form className="row" onSubmit={(e) => { e.preventDefault(); setS({ ...s, hubUrls: [...s.hubUrls, url.trim()] }); setUrl(""); }}>
                <input className="input" style={{ flex: 1 }} placeholder="https://…/index.json" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Novo hub" />
                <button className="btn" disabled={!url.trim().startsWith("https://") || s.hubUrls.includes(url.trim())}><Icon name="add" /> Adicionar</button>
              </form>
              <div className="setting-row">
                <div className="txt"><b>Procurar atualizações de mods ao abrir</b></div>
                <Switch checked={s.checkModUpdates} onChange={(v) => setS({ ...s, checkModUpdates: v })} label="Procurar atualizações de mods" />
              </div>
            </div>
          </section>

          <section id="sec-mapas" className="col">
            <h2>Estúdio de Mapas</h2>
            <div className="card pad col">
              {py?.ready ? <Notice kind="ok">Pronto — usando Python {py.python?.version}.</Notice> : <Notice kind="warn">{py?.message ?? "Verificando o Python…"}</Notice>}
              <Field label="Python (opcional)" hint="Deixe vazio para usar o Python que vem com o app ou o do sistema.">
                <div className="row">
                  <input className="input" style={{ flex: 1 }} value={s.pythonPath ?? ""} placeholder="C:\…\python.exe" onChange={(e) => setS({ ...s, pythonPath: e.target.value || null })} />
                  <button className="btn" onClick={async () => { const p = await pickFile([{ name: "Python", extensions: ["exe", ""] }]); if (p) setS({ ...s, pythonPath: p }); }}>Procurar</button>
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
              {appUpdate ? (
                <Notice kind="info">
                  <b>CommandProject {appUpdate.version} disponível.</b>
                  {appUpdate.notes && <p className="small muted" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{appUpdate.notes}</p>}
                  <button className="btn primary sm" style={{ marginTop: 10 }} onClick={() => openUrl(appUpdate.url)}><Icon name="download" /> Baixar a nova versão</button>
                </Notice>
              ) : <p className="muted small">Você está na versão {info?.version}. As versões novas saem em <a href="#" onClick={(e) => { e.preventDefault(); openUrl(RELEASES_URL); }}>GitHub Releases</a>.</p>}
              <div className="setting-row">
                <div className="txt"><b>Avisar quando sair uma versão nova do launcher</b></div>
                <Switch checked={s.checkAppUpdates} onChange={(v) => setS({ ...s, checkAppUpdates: v })} label="Avisar sobre versões novas" />
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
              {info && <div className="row"><span className="mono faint selectable" style={{ flex: 1 }}>{info.dataDir}</span><button className="btn sm" onClick={() => api.openPath(info.dataDir)}><Icon name="folder_open" /> Abrir pasta de dados</button></div>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/** "Modo 4 GB": liga a flag Large Address Aware no executável (age na hora, com backup). */
function MemoryMode({ onChange }: { onChange: (v: boolean) => void }) {
  const { run } = useStore.getState();
  const busy = useStore((s) => s.busy.laa);
  const [st, setSt] = useState<LaaStatus | null | undefined>(undefined);
  useEffect(() => { api.laaStatus().then(setSt).catch(() => setSt(null)); }, []);
  if (!st) return null;
  return (
    <div className="setting-row" id="modo-4gb">
      <div className="txt">
        <b>Modo 4 GB de memória</b>
        <span>
          O SC2 é um programa de 32 bits e, sem isso, só pode usar 2 GB de RAM. Ligado, o mesmo executável usa até 4 GB num Windows 64 bits:
          menos travamentos com Texturas HD, mapas grandes e partidas longas. O original fica guardado e volta com um clique.
        </span>
        <div className="chips" style={{ marginTop: 6 }}>
          {st.is64bit ? <span className="chip ok">O executável já é 64 bits</span> : st.enabled ? <span className="chip ok"><Icon name="memory" /> Até 4 GB</span> : <span className="chip">Até 2 GB</span>}
          {st.enabled && !st.patchedByUs && <span className="chip info">Já vinha ligado</span>}
          {st.revertedByUpdate && <span className="chip warn">A Steam restaurou o executável: será reaplicado ao jogar</span>}
          {st.steamStub && <span className="chip warn">Executável com proteção da Steam: se o jogo não abrir, desligue</span>}
        </div>
      </div>
      <Switch checked={st.enabled} disabled={busy || st.is64bit || (st.enabled && !st.patchedByUs)} onChange={async (v) => {
        const r = await run("laa", () => api.laaSet(v), v ? "Modo 4 GB ligado." : "Executável original restaurado.");
        if (r) { setSt(r); onChange(v); }
      }} label="Modo 4 GB de memória" />
    </div>
  );
}
