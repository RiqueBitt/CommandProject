import { FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Field, Notice, Switch } from "../components/ui";
import { api, pickFile } from "../lib/api";
import { fmtBytes, useStore } from "../lib/store";
import type { FileStatus, MaptkStatus, Settings } from "../lib/types";

const ORIGIN: Record<FileStatus["origin"], string> = {
  stock: "do jogo",
  unmanaged: "instalado à mão",
  managed: "colocado pelo launcher",
  new: "novo",
};

export default function SettingsPage() {
  const saved = useStore((s) => s.settings);
  const d = useStore((s) => s.dashboard);
  const info = useStore((s) => s.info);
  const { run, refresh } = useStore.getState();
  const [s, setS] = useState<Settings | null>(saved);
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<FileStatus[] | null>(null);
  const [py, setPy] = useState<MaptkStatus | null>(null);

  useEffect(() => setS(saved), [saved]);
  useEffect(() => { api.maptkStatus().then(setPy).catch(() => setPy(null)); }, [saved?.pythonPath]);
  if (!s) return null;

  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const save = async () => {
    const r = await run("settings", () => api.saveSettings(s), "Configurações salvas.");
    if (r) await refresh();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow"><h1>Configurações</h1></div>
        <button className="btn primary" disabled={!dirty} onClick={save}>Salvar alterações</button>
      </div>

      <section className="panel pad col">
        <h2>Jogo</h2>
        <Field label="Pasta do Supreme Commander 2" hint={s.gamePath ? "Escolhida manualmente." : "Detectada automaticamente (Steam/GOG)."}>
          <div className="row">
            <input className="input" style={{ flex: 1 }} readOnly value={d?.game?.root ?? "não encontrada"} />
            <button className="btn" onClick={async () => {
              const dir = await pickFile([], true);
              if (dir) setS({ ...s, gamePath: dir });
            }}><FolderOpen size={16} /> Escolher</button>
            {s.gamePath && <button className="btn ghost" onClick={() => setS({ ...s, gamePath: null })}><RefreshCw size={15} /> Automático</button>}
          </div>
        </Field>
        {s.gamePath && s.gamePath !== saved?.gamePath && <span className="faint small">Nova pasta: {s.gamePath} (salve para usar)</span>}
        <div className="check-row">
          <div className="txt"><b>Abrir o jogo pela Steam</b><span className="muted small">Recomendado: mantém lobbies, amigos e conquistas. Desligue para abrir o .exe direto (GOG ou argumentos extras).</span></div>
          <Switch checked={s.launchMode === "steam"} onChange={(v) => setS({ ...s, launchMode: v ? "steam" : "direct" })} label="Abrir pela Steam" />
        </div>
        {s.launchMode === "direct" && (
          <Field label="Argumentos extras" hint="Separados por espaço. Ex.: /windowed">
            <input className="input" value={s.launchArgs.join(" ")} onChange={(e) => setS({ ...s, launchArgs: e.target.value.split(/\s+/).filter(Boolean) })} />
          </Field>
        )}
        <div className="check-row">
          <div className="txt"><b>Aplicar o perfil antes de jogar</b><span className="muted small">O botão Jogar instala/remove os mods do perfil ativo antes de abrir o jogo.</span></div>
          <Switch checked={s.applyBeforeLaunch} onChange={(v) => setS({ ...s, applyBeforeLaunch: v })} label="Aplicar antes de jogar" />
        </div>
        <div className="check-row">
          <div className="txt"><b>Voltar ao original quando o jogo fechar</b><span className="muted small">Útil se você também joga sem o launcher ou usa “Verificar integridade” da Steam.</span></div>
          <Switch checked={s.restoreOnExit} onChange={(v) => setS({ ...s, restoreOnExit: v })} label="Restaurar ao fechar" />
        </div>
      </section>

      <section className="panel pad col">
        <h2>Hub de mods</h2>
        <p className="muted small">Endereços de índices (JSON) de onde o launcher busca mods e atualizações. Só https.</p>
        {s.hubUrls.map((u, i) => (
          <div key={u} className="row">
            <span className="mono selectable" style={{ flex: 1 }}>{u}</span>
            {i === 0 && <span className="tag">principal</span>}
            <button className="btn ghost icon-btn" aria-label={`Remover ${u}`} onClick={() => setS({ ...s, hubUrls: s.hubUrls.filter((x) => x !== u) })}><Trash2 size={15} /></button>
          </div>
        ))}
        <form className="row" onSubmit={(e) => { e.preventDefault(); setS({ ...s, hubUrls: [...s.hubUrls, url.trim()] }); setUrl(""); }}>
          <input className="input" style={{ flex: 1 }} placeholder="https://…/index.json" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Novo hub" />
          <button className="btn" disabled={!url.trim().startsWith("https://") || s.hubUrls.includes(url.trim())}><Plus size={15} /> Adicionar</button>
        </form>
        <div className="check-row">
          <div className="txt"><b>Procurar atualizações ao abrir</b></div>
          <Switch checked={s.checkModUpdates} onChange={(v) => setS({ ...s, checkModUpdates: v })} label="Procurar atualizações" />
        </div>
      </section>

      <section className="panel pad col">
        <h2>Estúdio de Mapas</h2>
        {py?.ready ? <Notice kind="ok">Pronto — usando Python {py.python?.version}.</Notice> : <Notice kind="warn">{py?.message ?? "Verificando o Python…"}</Notice>}
        <Field label="Python (opcional)" hint="Deixe vazio para usar o Python que vem com o app ou o do sistema.">
          <div className="row">
            <input className="input" style={{ flex: 1 }} value={s.pythonPath ?? ""} placeholder="C:\…\python.exe" onChange={(e) => setS({ ...s, pythonPath: e.target.value || null })} />
            <button className="btn" onClick={async () => { const p = await pickFile([{ name: "Python", extensions: ["exe", ""] }]); if (p) setS({ ...s, pythonPath: p }); }}>Procurar</button>
          </div>
        </Field>
      </section>

      <section className="panel pad col">
        <div className="section-title">
          <h2>Arquivos do jogo</h2>
          <button className="btn sm" disabled={!d?.game} onClick={async () => setFiles((await run("files", () => api.fileStatus())) ?? null)}>{files ? "Atualizar" : "Mostrar"}</button>
        </div>
        <p className="muted small">Na primeira vez, o launcher registra como estava cada .scd da pasta. É isso que permite voltar ao original byte a byte.</p>
        {files && (
          <div className="list">
            {files.map((f) => (
              <div key={f.name} className="list-row" style={{ background: "var(--abyss-2)", padding: "8px 14px" }}>
                <span className={`dot ${f.state === "ok" ? "ok" : f.state === "modified" ? "warn" : "err"}`} title={f.state} />
                <span className="mono grow">{f.name}</span>
                <span className="muted small">{ORIGIN[f.origin]}{f.modId ? ` (${f.modId})` : ""}</span>
                <span className="faint small" style={{ width: 80, textAlign: "right" }}>{fmtBytes(f.size)}</span>
                {f.state !== "ok" && <span className={`tag ${f.state === "missing" ? "err" : "warn"}`}>{f.state === "missing" ? "faltando" : "alterado"}</span>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel pad col">
        <h2>Sobre</h2>
        <p className="small">CommandProject {info?.version} — parte do ecossistema Project Club. Licença MIT.</p>
        <p className="small muted">
          O Estúdio de Mapas usa o <a href="https://github.com/plutonics72/supcom2-map-toolkit" target="_blank" rel="noreferrer">SC2 Map Toolkit</a> de plutonics72 (MIT).
          Supreme Commander 2 é marca registrada da Square Enix; este app não contém nem distribui arquivos do jogo.
        </p>
        {info && <div className="row"><span className="mono faint selectable" style={{ flex: 1 }}>{info.dataDir}</span><button className="btn sm" onClick={() => api.openPath(info.dataDir)}><FolderOpen size={14} /> Abrir pasta de dados</button></div>}
      </section>
    </div>
  );
}
