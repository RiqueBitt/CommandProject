import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Empty, Notice, Icon } from "../../components/ui";
import { api, pickSave } from "../../lib/api";
import { fmtBytes, load, useStore } from "../../lib/store";
import type { ArchiveInfo, EntryView, MeshView, Project, ScdEntry, TextureView } from "../../lib/types";
import { FILE_ICON } from "./Projects";

const LuaEditor = lazy(() => import("../../components/LuaEditor"));
const ModelViewer = lazy(() => import("../../components/ModelViewer"));

const kindOf = (p: string) =>
  /\.lua$/i.test(p) ? "lua" : /\.bp$/i.test(p) ? "blueprint" : /\.(dds)$/i.test(p) ? "texture" : /\.scm$/i.test(p) ? "model" : "other";
const LIMIT = 600;

export default function Explorer({ projects, target, setTarget }: { projects: Project[]; target: string | null; setTarget: (id: string) => void }) {
  const [archives, setArchives] = useState<ArchiveInfo[] | null>(null);
  const [archive, setArchive] = useState<string | null>(null);
  const [entries, setEntries] = useState<ScdEntry[]>([]);
  const [query, setQuery] = useState("");
  const [entry, setEntry] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void load(() => api.archives()).then((a) => { if (alive) setArchives(a ?? []); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!archive) return;
    let alive = true; // trocou de arquivo antes de terminar: ignora a resposta antiga
    setEntries([]);
    setEntry(null);
    void load(() => api.archiveEntries(archive)).then((e) => { if (alive) setEntries((e ?? []).filter((x) => !x.isDir)); });
    return () => { alive = false; };
  }, [archive]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? entries.filter((e) => e.key.includes(q)) : entries;
  }, [entries, query]);

  if (!archives) return <div className="card pad"><div className="bar indeterminate"><i /></div></div>;
  if (!archives.length) return <div className="card"><Empty icon="travel_explore" title="Pasta do jogo não encontrada">Configure a pasta do jogo em Configurações.</Empty></div>;

  return (
    <div className="studio">
      <div className="card">
        {!archive ? (
          <div className="tree" role="listbox" aria-label="Arquivos .scd">
            {archives.map((a) => (
              <button key={a.name} className="tree-item" onClick={() => setArchive(a.name)}>
                <Icon name="folder_zip" size={18} />
                <span className="nm" style={{ flex: 1 }}>{a.name}</span>
                <span className="faint small">{a.origin === "stock" ? fmtBytes(a.size) : a.modId ?? "mod"}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="viewer-head">
              <button className="btn text icon-btn" onClick={() => setArchive(null)} aria-label="Voltar"><Icon name="arrow_back" size={19} /></button>
              <span className="path"><b>{archive}</b></span>
            </div>
            <div className="search-bar" style={{ margin: "10px 12px 4px" }}>
              <Icon name="search" size={19} />
              <input className="input" style={{ width: "100%" }} placeholder="Filtrar: ui/game, .dds, uel0101…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filtrar arquivos" />
            </div>
            <p className="faint small" style={{ padding: "2px 14px" }}>{filtered.length.toLocaleString("pt-BR")} arquivo(s){filtered.length > LIMIT ? `, mostrando ${LIMIT} — refine o filtro` : ""}</p>
            <div className="tree" role="listbox" aria-label="Conteúdo">
              {filtered.slice(0, LIMIT).map((e) => {
                const ico = FILE_ICON[kindOf(e.key)];
                return (
                  <button key={e.key} role="option" className="tree-item" aria-selected={entry === e.name} onClick={() => setEntry(e.name)} title={e.key}>
                    <Icon name={ico} /><span className="nm">{e.key}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div className="card viewer">
        {archive && entry ? (
          <EntryPreview key={archive + entry} archive={archive} entry={entry} projects={projects} target={target} setTarget={setTarget} />
        ) : (
          <Empty icon="folder_open" title="Escolha um arquivo">
            Navegue pelos .scd do jogo. Lua e blueprints abrem como texto, texturas como imagem e modelos em 3D. Os arquivos mostrados são sempre os originais, mesmo que um mod os substitua.
          </Empty>
        )}
      </div>
    </div>
  );
}

function EntryPreview({ archive, entry, projects, target, setTarget }: { archive: string; entry: string; projects: Project[]; target: string | null; setTarget: (id: string) => void }) {
  const { run } = useStore.getState();
  const kind = kindOf(entry);
  const [text, setText] = useState<EntryView | null>(null);
  const [tex, setTex] = useState<TextureView | null>(null);
  const [mesh, setMesh] = useState<MeshView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (kind === "texture") setTex(await api.previewTexture(archive, entry));
        else if (kind === "model") setMesh(await api.previewModel(archive, entry));
        else setText(await api.readEntry(archive, entry));
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [archive, entry, kind]);

  const exportAs = async (format: "raw" | "png" | "obj" | "glb") => {
    const base = entry.split(/[\\/]/).pop()!;
    const name = format === "raw" ? base : base.replace(/\.[^.]+$/, "." + format);
    const dest = await pickSave(name, [{ name: format.toUpperCase(), extensions: [name.split(".").pop()!] }]);
    if (dest) await run("export", () => api.exportEntry(archive, entry, dest, format), `Exportado para ${dest}`);
  };

  return (
    <>
      <div className="viewer-head">
        <span className="path mono" title={entry}>{entry}</span>
        {projects.length > 0 && (
          <>
            <select className="select" style={{ height: 30 }} value={target ?? ""} onChange={(e) => setTarget(e.target.value)} aria-label="Projeto de destino">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button className="btn sm primary" disabled={!target} onClick={() => run("override", () => api.projectOverride(target!, archive, entry), "Copiado para o projeto — edite em “Meus projetos”.")}>
              <Icon name="library_add" size={17} /> Copiar para o projeto
            </button>
          </>
        )}
        <button className="btn sm" onClick={() => exportAs("raw")}><Icon name="download" size={17} /> Exportar</button>
        {kind === "texture" && <button className="btn sm" onClick={() => exportAs("png")}>PNG</button>}
        {kind === "model" && <><button className="btn sm" onClick={() => exportAs("obj")}>OBJ</button><button className="btn sm" onClick={() => exportAs("glb")}>GLB</button></>}
      </div>
      {projects.length === 0 && <div style={{ padding: "10px 14px 0" }}><Notice kind="info">Crie um projeto em “Meus projetos” para copiar arquivos do jogo e editá-los.</Notice></div>}
      <div className="viewer-body">
        {error && <div style={{ padding: 16 }}><Notice kind="err">{error}</Notice></div>}
        <Suspense fallback={<div className="muted" style={{ padding: 16 }}>Carregando…</div>}>
          {text && (text.text != null ? (
            <>
              {text.textFrom && <div style={{ padding: "10px 14px 0" }}><Notice kind="info">Este Lua é bytecode no jogo; mostrando a versão em texto de <b>{text.textFrom}</b>.</Notice></div>}
              <LuaEditor value={text.text} readOnly />
            </>
          ) : (
            <Empty icon={text.compiled ? "lock" : "description"} title={text.compiled ? "Lua compilado" : "Arquivo binário"}>
              {text.compiled ? "Este arquivo é bytecode. A versão em texto costuma estar em uncompiled_lua.scd." : `${fmtBytes(text.size)}. Use Exportar para abrir em outro programa.`}
            </Empty>
          ))}
          {tex && (
            <>
              <div className="tex-stage checker"><img src={tex.png} alt={entry} /></div>
              <p className="small muted" style={{ padding: "0 16px 14px" }}>{tex.info.width}×{tex.info.height}, {tex.info.format.toUpperCase()}, {tex.info.mipCount} mipmaps</p>
            </>
          )}
          {mesh && <ModelViewer mesh={mesh} />}
        </Suspense>
      </div>
    </>
  );
}
