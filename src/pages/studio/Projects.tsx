import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Empty, Field, Modal, Notice, Icon } from "../../components/ui";
import { api, confirmDialog, pickFile, pickSave } from "../../lib/api";
import { fmtBytes, useStore } from "../../lib/store";
import { t, tr } from "../../lib/i18n";
import { CATEGORY_LABEL, type Category, type ColorAdjust, type EntryView, type MeshView, type Project, type ProjectFile, type TextureView } from "../../lib/types";
import { ColorSliders, IDENTITY } from "./adjust";

const LuaEditor = lazy(() => import("../../components/LuaEditor"));
const ModelViewer = lazy(() => import("../../components/ModelViewer"));
const Painter = lazy(() => import("../../components/Painter"));

export const FILE_ICON: Record<string, string> = { lua: "code", blueprint: "data_object", texture: "image", model: "view_in_ar", audio: "music_note", other: "draft" };

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
      <div className="card">
        <Empty icon="construction" title={t("Comece um projeto de mod")}
          action={<button className="btn primary" onClick={() => setCreating(true)}><Icon name="add" size={19} /> {t("Novo projeto")}</button>}>
          {t("Um projeto é uma pasta com os arquivos que você quer mudar no jogo. Quando terminar, o Estúdio gera o .scd e coloca na sua biblioteca.")}
        </Empty>
        {creating && <NewProject onClose={() => setCreating(false)} onCreated={async (p) => { await reload(); setCurrent(p.id); }} />}
      </div>
    );
  }

  const file = files.find((f) => f.path === selected) ?? null;

  return (
    <>
      <div className="row wrap">
        <select className="select" value={current ?? ""} onChange={(e) => setCurrent(e.target.value)} aria-label={t("Projeto")}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn text sm" onClick={() => setCreating(true)}><Icon name="add" size={18} /> {t("Novo")}</button>
        <button className="btn text sm" onClick={() => setEditing(true)} disabled={!project}><Icon name="tune" size={18} /> {t("Detalhes")}</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={async () => {
          if (!project) return;
          const dest = await pickSave(`${project.id}-${project.version}.zip`, [{ name: t("Pacote do hub"), extensions: ["zip"] }]);
          if (dest) await run("export", () => api.exportProjectPackage(project.id, dest), t("Pacote exportado — pronto para publicar no hub."));
        }} disabled={!project}><Icon name="inventory_2" size={19} /> {t("Exportar pacote")}</button>
        <button className="btn primary" disabled={!project || !files.length || busy.build} onClick={async () => {
          await run("build", () => api.buildProject(project!.id, true), (m) => t("\"{name}\" {version} gerado e ativado na biblioteca.", { name: m.name, version: m.version }));
          await refreshMods();
        }}><Icon name="construction" size={19} /> {busy.build ? t("Gerando…") : t("Gerar mod")}</button>
      </div>

      <div className="studio">
        <div className="card">
          <div className="viewer-head">
            <span className="path muted small">{project?.archiveName}</span>
            <button className="btn sm" onClick={openExplorer}><Icon name="add" size={17} /> {t("Do jogo")}</button>
          </div>
          {files.length === 0 ? (
            <Empty icon="create_new_folder" title={t("Projeto vazio")}>{t("Abra “Arquivos do jogo”, escolha o que quer mudar e use “Copiar para o projeto”.")}</Empty>
          ) : (
            <div className="tree" role="listbox" aria-label={t("Arquivos do projeto")}>
              {files.map((f) => {
                const ico = FILE_ICON[f.kind];
                return (
                  <button key={f.path} role="option" className="tree-item" aria-selected={f.path === selected} onClick={() => setSelected(f.path)} title={f.path}>
                    <Icon name={ico} />
                    <span className="nm">{f.path}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="card viewer">
          {project && file ? (
            <FileEditor key={project.id + file.path} project={project} file={file} onChanged={loadFiles} />
          ) : (
            <Empty icon="touch_app" title={t("Nenhum arquivo selecionado")}>{t("Escolha um arquivo na lista ao lado.")}</Empty>
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
  const [painting, setPainting] = useState(false);
  const [rigging, setRigging] = useState(false);
  const [saving, setSaving] = useState(false);
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
    const w = await run("save", () => api.projectWriteText(project.id, file.path, draft), t("Salvo."));
    if (w) {
      setWarnings(w);
      setText((t) => (t ? { ...t, text: draft } : t));
    }
  };

  const exportAs = async (format: "png" | "obj" | "glb" | "raw") => {
    const base = file.path.split("/").pop()!.replace(/\.[^.]+$/, "");
    const ext = format === "raw" ? file.path.split(".").pop()! : format;
    const dest = await pickSave(`${base}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }]);
    if (dest) await run("exp", () => api.projectExport(project.id, file.path, dest, format), t("Exportado para {path}", { path: dest }));
  };

  return (
    <>
      <div className="viewer-head">
        <span className="path mono">{file.path}</span>
        <span className="faint small">{fmtBytes(file.size)}</span>
        {isText && <button className="btn sm primary" disabled={!dirty} onClick={save}><Icon name="save" size={17} /> {t("Salvar")} <span className="kbd">Ctrl S</span></button>}
        {file.kind === "texture" && (
          <>
            <button className="btn sm tonal" onClick={() => setPainting(true)} disabled={!tex}><Icon name="brush" size={17} /> {t("Pintar")}</button>
            <button className="btn sm" onClick={() => exportAs("png")}>{t("Exportar PNG")}</button>
            <button className="btn sm" onClick={async () => {
              const png = await pickFile([{ name: t("Imagem PNG"), extensions: ["png"] }]);
              if (!png) return;
              const info = await run("png", () => api.projectImportPng(project.id, file.path, png, true), t("Textura substituída (mesmo formato do original)."));
              if (info) { setTex(await api.projectTexture(project.id, file.path)); await onChanged(); }
            }}><Icon name="upload" size={17} /> {t("Importar PNG")}</button>
          </>
        )}
        {file.kind === "model" && (
          <>
            <button className="btn sm" onClick={() => exportAs("obj")}>{t("Exportar OBJ")}</button>
            <button className="btn sm" onClick={() => exportAs("glb")}>{t("Exportar GLB")}</button>
            <button className="btn sm" onClick={() => setRigging(true)}><Icon name="upload" size={17} /> {t("Importar OBJ")}</button>
          </>
        )}
        <button className="btn text icon-btn" aria-label={t("Remover do projeto")} onClick={async () => {
          if (!(await confirmDialog(t("Remover {path} do projeto? O arquivo original do jogo não é afetado.", { path: file.path })))) return;
          await run("del", () => api.projectDeleteFile(project.id, file.path));
          await onChanged();
        }}><Icon name="delete" size={18} /></button>
      </div>
      <div className="viewer-body">
        {error && <div style={{ padding: 16 }}><Notice kind="err">{tr(error)}</Notice></div>}
        <Suspense fallback={<div className="pad muted">{t("Carregando…")}</div>}>
          {isText && text && (text.compiled ? (
            <div style={{ padding: 16 }}><Notice kind="warn">{t("Este Lua está compilado (bytecode) e não pode ser editado como texto. Procure a versão em")} <b>uncompiled_lua.scd</b>.</Notice></div>
          ) : (
            <>
              {text.textFrom && <div style={{ padding: "10px 14px 0" }}><Notice kind="info">{t("O original do jogo é bytecode; este texto veio de")} <b>{text.textFrom}</b>. {t("Ao gerar o mod, o arquivo em texto substitui o compilado.")}</Notice></div>}
              <LuaEditor value={text.text ?? ""} onChange={setDraft} onSave={save} />
              {warnings.length > 0 && <div style={{ padding: "10px 14px" }}><Notice kind="warn">{warnings.slice(0, 4).map(tr).join("; ")}</Notice></div>}
            </>
          ))}
          {file.kind === "texture" && tex && painting && (
            <Painter src={tex.png} saving={saving} onCancel={() => setPainting(false)} onSave={async (png) => {
              setSaving(true);
              const info = await run("paint", () => api.projectSavePainted(project.id, file.path, png), t("Pintura salva na textura."));
              setSaving(false);
              if (info) { setTex(await api.projectTexture(project.id, file.path)); setPainting(false); await onChanged(); }
            }} />
          )}
          {file.kind === "texture" && tex && !painting && (
            <div className="grid-2" style={{ gridTemplateColumns: "1fr 300px", gap: 0 }}>
              <div className="tex-stage checker"><img src={tex.png} alt={file.path} /></div>
              <div className="col" style={{ padding: 16, borderLeft: "1px solid var(--grid-soft)" }}>
                <p className="small muted">{tex.info.width}×{tex.info.height}, {tex.info.format.toUpperCase()}, {tex.info.mipCount} mipmaps</p>
                <h3>{t("Ajustar cores")}</h3>
                <ColorSliders value={adjust} onChange={setAdjust} />
                <button className="btn primary" disabled={JSON.stringify(adjust) === JSON.stringify(IDENTITY)} onClick={async () => {
                  const v = await run("adj", () => api.projectAdjustTexture(project.id, file.path, adjust), t("Cores aplicadas na textura."));
                  if (v) { setAdjust(IDENTITY); setTex(v); await onChanged(); }
                }}>{t("Aplicar na textura")}</button>
                <p className="faint small">{t("Use “Pintar” para retocar aqui mesmo, ou exporte o PNG, edite no seu editor favorito e importe de volta. Formato e mipmaps são refeitos automaticamente.")}</p>
              </div>
            </div>
          )}
          {file.kind === "model" && mesh && <ModelViewer mesh={mesh} />}
          {!isText && file.kind !== "texture" && file.kind !== "model" && (
            <Empty icon="inventory_2" title={t("Sem editor para este tipo")}>{t("Ele vai junto no mod do jeito que está.")}</Empty>
          )}
        </Suspense>
      </div>
      {rigging && <RigModal onClose={() => setRigging(false)} onPick={async (bone) => {
        setRigging(false);
        const obj = await pickFile([{ name: "Wavefront OBJ", extensions: ["obj"] }]);
        if (!obj) return;
        const m = await run("obj", () => api.projectImportObj(project.id, file.path, obj, bone), t("Geometria importada."));
        if (m) { setMesh(m); await onChanged(); }
      }} bones={(mesh?.bones ?? []).map((b) => b.name)} />}
    </>
  );
}

function RigModal({ onClose, onPick, bones }: { onClose: () => void; onPick: (bone: number | null) => void; bones: string[] }) {
  const [mode, setMode] = useState<"auto" | "bone">("auto");
  const [bone, setBone] = useState(0);
  return (
    <Modal title={t("Importar modelo OBJ")} icon="view_in_ar" onClose={onClose}>
      <div className="col">
        <p className="muted">{t("A malha nova substitui a geometria do modelo. Os ossos (animações, torres, rodas) continuam os do original; escolha como prender os vértices novos a eles.")}</p>
        <div className="rig-options">
          <button type="button" className="rig-option" aria-pressed={mode === "auto"} onClick={() => setMode("auto")}>
            <Icon name="auto_fix_high" /><span><b>{t("Automático (recomendado)")}</b><small>{t("Cada vértice segue o osso do ponto mais próximo no modelo original. Bom para modelos parecidos em tamanho e posição.")}</small></span>
          </button>
          <button type="button" className="rig-option" aria-pressed={mode === "bone"} onClick={() => setMode("bone")}>
            <Icon name="push_pin" /><span><b>{t("Tudo em um osso")}</b><small>{t("A malha inteira fica presa a um único osso. Use para peças estáticas ou quando o automático deformar.")}</small></span>
          </button>
        </div>
        {mode === "bone" && (
          <Field label={t("Osso")}>
            <select className="select" value={bone} onChange={(e) => setBone(Number(e.target.value))}>
              {(bones.length ? bones : [t("Raiz")]).map((b, i) => <option key={i} value={i}>{i}: {b}</option>)}
            </select>
          </Field>
        )}
        <p className="faint small">{t("Exporte o modelo como OBJ, edite no Blender (sem mudar a escala) e importe de volta. Faces com mais de 3 lados são trianguladas.")}</p>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" onClick={() => onPick(mode === "auto" ? null : bone)}><Icon name="folder_open" /> {t("Escolher arquivo")}</button></footer>
      </div>
    </Modal>
  );
}

function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Project) => Promise<void> }) {
  const { run } = useStore.getState();
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("ui");
  return (
    <Modal title={t("Novo projeto")} onClose={onClose}>
      <form className="col" onSubmit={async (e) => {
        e.preventDefault();
        const p = await run("newproj", () => api.createProject(name.trim(), category));
        if (p) { await onCreated(p); onClose(); }
      }}>
        <Field label={t("Nome do mod")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: HUD Safira")} /></Field>
        <Field label={t("Tipo")}>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </Field>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" disabled={!name.trim()}>{t("Criar")}</button></footer>
      </form>
    </Modal>
  );
}

function ProjectMeta({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => Promise<void> }) {
  const { run } = useStore.getState();
  const [p, setP] = useState(project);
  return (
    <Modal title={t("Detalhes do projeto")} onClose={onClose}>
      <form className="col" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run("meta", async () => { await api.saveProject(p); return true; }, t("Projeto salvo."));
        if (ok) { await onSaved(); onClose(); }
      }}>
        <Field label={t("Nome")}><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
        <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("Versão")}><input className="input" value={p.version} onChange={(e) => setP({ ...p, version: e.target.value })} /></Field>
          <Field label={t("No multiplayer")}>
            <select className="select" value={p.multiplayer} onChange={(e) => setP({ ...p, multiplayer: e.target.value as Project["multiplayer"] })}>
              <option value="sync">{t("Precisa sincronizar")}</option>
              <option value="local">{t("Só visual")}</option>
            </select>
          </Field>
        </div>
        <Field label={t("Arquivo gerado")} hint={t("Comece com zz_ para carregar depois dos arquivos do jogo e sobrescrevê-los.")}>
          <input className="input mono" value={p.archiveName} onChange={(e) => setP({ ...p, archiveName: e.target.value })} />
        </Field>
        <Field label={t("Descrição")}><textarea className="textarea" rows={3} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} /></Field>
        <footer>
          <button type="button" className="btn danger" onClick={async () => {
            if (!(await confirmDialog(t("Apagar o projeto \"{name}\"? O mod já gerado continua na biblioteca.", { name: project.name })))) return;
            await run("delproj", () => api.deleteProject(project.id), t("Projeto apagado."));
            await onSaved();
            onClose();
          }}>{t("Apagar projeto")}</button>
          <div style={{ flex: 1 }} />
          <button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn primary">{t("Salvar")}</button>
        </footer>
      </form>
    </Modal>
  );
}
