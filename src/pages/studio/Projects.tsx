import { Box, FileCode2, FileImage, FileQuestion, Hammer, PackagePlus, Plus, Save, Settings2, Trash2, Upload } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Empty, Field, Modal, Notice } from "../../components/ui";
import { api, confirmDialog, pickFile, pickSave } from "../../lib/api";
import { fmtBytes, useStore } from "../../lib/store";
import { CATEGORY_LABEL, type Category, type ColorAdjust, type EntryView, type MeshView, type Project, type ProjectFile, type TextureView } from "../../lib/types";
import { ColorSliders, IDENTITY } from "./adjust";

const LuaEditor = lazy(() => import("../../components/LuaEditor"));
const ModelViewer = lazy(() => import("../../components/ModelViewer"));

export const FILE_ICON = { lua: FileCode2, blueprint: FileCode2, texture: FileImage, model: Box, audio: FileQuestion, other: FileQuestion };

interface Props {
  projects: Project[];
  current: string | null;
  setCurrent: (id: string) => void;
  reload: () => Promise<void>;
  openExplorer: () => void;
}

export default function Projects({ projects, current, setCurrent, reload, openExplorer }: Props) {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const project = projects.find((p) => p.id === current) ?? null;

  const loadFiles = useCallback(async () => {
    if (!current) return setFiles([]);
    const f = await api.projectFiles(current);
    setFiles(f);
    setSelected((s) => (s && f.some((x) => x.path === s) ? s : f[0]?.path ?? null));
  }, [current]);
  useEffect(() => { void loadFiles(); }, [loadFiles]);

  if (!projects.length) {
    return (
      <div className="panel">
        <Empty icon={<Hammer size={36} color="var(--faint)" />} title="Comece um projeto de mod"
          action={<button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Novo projeto</button>}>
          Um projeto é uma pasta com os arquivos que você quer mudar no jogo. Quando terminar, o Estúdio gera o .scd e coloca na sua biblioteca.
        </Empty>
        {creating && <NewProject onClose={() => setCreating(false)} onCreated={async (p) => { await reload(); setCurrent(p.id); }} />}
      </div>
    );
  }

  const file = files.find((f) => f.path === selected) ?? null;

  return (
    <>
      <div className="row wrap">
        <select className="select" value={current ?? ""} onChange={(e) => setCurrent(e.target.value)} aria-label="Projeto">
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn ghost sm" onClick={() => setCreating(true)}><Plus size={15} /> Novo</button>
        <button className="btn ghost sm" onClick={() => setEditing(true)} disabled={!project}><Settings2 size={15} /> Detalhes</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={async () => {
          if (!project) return;
          const dest = await pickSave(`${project.id}-${project.version}.zip`, [{ name: "Pacote do hub", extensions: ["zip"] }]);
          if (dest) await run("export", () => api.exportProjectPackage(project.id, dest), "Pacote exportado — pronto para publicar no hub.");
        }} disabled={!project}><PackagePlus size={16} /> Exportar pacote</button>
        <button className="btn primary" disabled={!project || !files.length || busy.build} onClick={async () => {
          await run("build", () => api.buildProject(project!.id, true), (m) => `"${m.name}" ${m.version} gerado e ativado na biblioteca.`);
          await refreshMods();
        }}><Hammer size={16} /> {busy.build ? "Gerando…" : "Gerar mod"}</button>
      </div>

      <div className="studio">
        <div className="panel">
          <div className="viewer-head">
            <span className="path muted small">{project?.archiveName}</span>
            <button className="btn sm" onClick={openExplorer}><Plus size={14} /> Do jogo</button>
          </div>
          {files.length === 0 ? (
            <Empty title="Projeto vazio">Abra “Arquivos do jogo”, escolha o que quer mudar e use “Copiar para o projeto”.</Empty>
          ) : (
            <div className="tree" role="listbox" aria-label="Arquivos do projeto">
              {files.map((f) => {
                const Icon = FILE_ICON[f.kind];
                return (
                  <button key={f.path} role="option" className="tree-item" aria-selected={f.path === selected} onClick={() => setSelected(f.path)} title={f.path}>
                    <Icon size={15} />
                    <span className="nm">{f.path}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="panel viewer">
          {project && file ? (
            <FileEditor key={project.id + file.path} project={project} file={file} onChanged={loadFiles} />
          ) : (
            <Empty title="Nenhum arquivo selecionado" />
          )}
        </div>
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} onCreated={async (p) => { await reload(); setCurrent(p.id); }} />}
      {editing && project && <ProjectMeta project={project} onClose={() => setEditing(false)} onSaved={reload} />}
    </>
  );
}

function FileEditor({ project, file, onChanged }: { project: Project; file: ProjectFile; onChanged: () => Promise<void> }) {
  const { run } = useStore.getState();
  const [text, setText] = useState<EntryView | null>(null);
  const [draft, setDraft] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tex, setTex] = useState<TextureView | null>(null);
  const [adjust, setAdjust] = useState<ColorAdjust>(IDENTITY);
  const [mesh, setMesh] = useState<MeshView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isText = file.kind === "lua" || file.kind === "blueprint" || /\.(txt|json|xml|ini)$/i.test(file.path);
  const dirty = text?.text != null && draft !== text.text;

  useEffect(() => {
    (async () => {
      try {
        if (isText) {
          const v = await api.projectReadText(project.id, file.path);
          setText(v);
          setDraft(v.text ?? "");
          setWarnings(v.warnings);
        } else if (file.kind === "texture") setTex(await api.projectTexture(project.id, file.path));
        else if (file.kind === "model") setMesh(await api.projectModel(project.id, file.path));
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [project.id, file.path, file.kind, isText]);

  // prévia ao vivo do ajuste de cor
  useEffect(() => {
    if (file.kind !== "texture") return;
    const h = setTimeout(async () => setTex(await api.projectTexture(project.id, file.path, adjust)), 160);
    return () => clearTimeout(h);
  }, [adjust, file.kind, file.path, project.id]);

  const save = async () => {
    const w = await run("save", () => api.projectWriteText(project.id, file.path, draft), "Salvo.");
    if (w) {
      setWarnings(w);
      setText((t) => (t ? { ...t, text: draft } : t));
    }
  };

  const exportAs = async (format: "png" | "obj" | "glb" | "raw") => {
    const base = file.path.split("/").pop()!.replace(/\.[^.]+$/, "");
    const ext = format === "raw" ? file.path.split(".").pop()! : format;
    const dest = await pickSave(`${base}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (dest) await run("exp", () => api.projectExport(project.id, file.path, dest, format), `Exportado para ${dest}`);
  };

  return (
    <>
      <div className="viewer-head">
        <span className="path mono">{file.path}</span>
        <span className="faint small">{fmtBytes(file.size)}</span>
        {isText && <button className="btn sm primary" disabled={!dirty} onClick={save}><Save size={14} /> Salvar <span className="kbd">Ctrl S</span></button>}
        {file.kind === "texture" && (
          <>
            <button className="btn sm" onClick={() => exportAs("png")}>Exportar PNG</button>
            <button className="btn sm" onClick={async () => {
              const png = await pickFile([{ name: "Imagem PNG", extensions: ["png"] }]);
              if (!png) return;
              const info = await run("png", () => api.projectImportPng(project.id, file.path, png, true), "Textura substituída (mesmo formato do original).");
              if (info) { setTex(await api.projectTexture(project.id, file.path)); await onChanged(); }
            }}><Upload size={14} /> Importar PNG</button>
          </>
        )}
        {file.kind === "model" && (
          <>
            <button className="btn sm" onClick={() => exportAs("obj")}>Exportar OBJ</button>
            <button className="btn sm" onClick={() => exportAs("glb")}>Exportar GLB</button>
            <button className="btn sm" title="Experimental: toda a malha fica presa a um osso" onClick={async () => {
              const obj = await pickFile([{ name: "Wavefront OBJ", extensions: ["obj"] }]);
              if (!obj) return;
              const m = await run("obj", () => api.projectImportObj(project.id, file.path, obj, 0), "Geometria importada (experimental).");
              if (m) { setMesh(m); await onChanged(); }
            }}><Upload size={14} /> Importar OBJ</button>
          </>
        )}
        <button className="btn ghost icon-btn" aria-label="Remover do projeto" onClick={async () => {
          if (!(await confirmDialog(`Remover ${file.path} do projeto? O arquivo original do jogo não é afetado.`))) return;
          await run("del", () => api.projectDeleteFile(project.id, file.path));
          await onChanged();
        }}><Trash2 size={15} /></button>
      </div>
      <div className="viewer-body">
        {error && <div style={{ padding: 16 }}><Notice kind="err">{error}</Notice></div>}
        <Suspense fallback={<div className="pad muted">Carregando…</div>}>
          {isText && text && (text.compiled ? (
            <div style={{ padding: 16 }}><Notice kind="warn">Este Lua está compilado (bytecode) e não pode ser editado como texto. Procure a versão em <b>uncompiled_lua.scd</b>.</Notice></div>
          ) : (
            <>
              <LuaEditor value={text.text ?? ""} onChange={setDraft} onSave={save} />
              {warnings.length > 0 && <div style={{ padding: "10px 14px" }}><Notice kind="warn">{warnings.slice(0, 4).join("; ")}</Notice></div>}
            </>
          ))}
          {file.kind === "texture" && tex && (
            <div className="grid-2" style={{ gridTemplateColumns: "1fr 300px", gap: 0 }}>
              <div className="tex-stage checker"><img src={tex.png} alt={file.path} /></div>
              <div className="col" style={{ padding: 16, borderLeft: "1px solid var(--grid-soft)" }}>
                <p className="small muted">{tex.info.width}×{tex.info.height}, {tex.info.format.toUpperCase()}, {tex.info.mipCount} mipmaps</p>
                <h3>Ajustar cores</h3>
                <ColorSliders value={adjust} onChange={setAdjust} />
                <button className="btn primary" disabled={JSON.stringify(adjust) === JSON.stringify(IDENTITY)} onClick={async () => {
                  const v = await run("adj", () => api.projectAdjustTexture(project.id, file.path, adjust), "Cores aplicadas na textura.");
                  if (v) { setAdjust(IDENTITY); setTex(v); await onChanged(); }
                }}>Aplicar na textura</button>
                <p className="faint small">Para pintar à mão, exporte o PNG, edite no seu editor favorito e importe de volta — formato e mipmaps são refeitos automaticamente.</p>
              </div>
            </div>
          )}
          {file.kind === "model" && mesh && <ModelViewer mesh={mesh} />}
          {!isText && file.kind !== "texture" && file.kind !== "model" && (
            <Empty title="Sem editor para este tipo">Ele vai junto no mod do jeito que está.</Empty>
          )}
        </Suspense>
      </div>
    </>
  );
}

function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => Promise<void> }) {
  const { run } = useStore.getState();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("ui");
  return (
    <Modal title="Novo projeto" onClose={onClose}>
      <form className="col" onSubmit={async (e) => {
        e.preventDefault();
        const p = await run("newproj", () => api.createProject(name.trim(), category));
        if (p) { await onCreated(p); onClose(); }
      }}>
        <Field label="Nome do mod"><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: HUD Safira" /></Field>
        <Field label="Tipo">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <footer><button type="button" className="btn ghost" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!name.trim()}>Criar</button></footer>
      </form>
    </Modal>
  );
}

function ProjectMeta({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => Promise<void> }) {
  const { run } = useStore.getState();
  const [p, setP] = useState(project);
  return (
    <Modal title="Detalhes do projeto" onClose={onClose}>
      <form className="col" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run("meta", async () => { await api.saveProject(p); return true; }, "Projeto salvo.");
        if (ok) { await onSaved(); onClose(); }
      }}>
        <Field label="Nome"><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Versão"><input className="input" value={p.version} onChange={(e) => setP({ ...p, version: e.target.value })} /></Field>
          <Field label="No multiplayer">
            <select className="select" value={p.multiplayer} onChange={(e) => setP({ ...p, multiplayer: e.target.value as Project["multiplayer"] })}>
              <option value="sync">Precisa sincronizar</option>
              <option value="local">Só visual</option>
            </select>
          </Field>
        </div>
        <Field label="Arquivo gerado" hint="Comece com zz_ para carregar depois dos arquivos do jogo e sobrescrevê-los.">
          <input className="input mono" value={p.archiveName} onChange={(e) => setP({ ...p, archiveName: e.target.value })} />
        </Field>
        <Field label="Descrição"><textarea className="textarea" rows={3} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        <footer>
          <button type="button" className="btn danger" onClick={async () => {
            if (!(await confirmDialog(`Apagar o projeto "${project.name}"? O mod já gerado continua na biblioteca.`))) return;
            await run("delproj", () => api.deleteProject(project.id), "Projeto apagado.");
            await onSaved();
            onClose();
          }}>Apagar projeto</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Salvar</button>
        </footer>
      </form>
    </Modal>
  );
}
