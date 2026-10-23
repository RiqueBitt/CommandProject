import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FileArchive, FolderOpen, GitCompareArrows, GripVertical, PackageOpen, Search, Settings2, ShieldCheck, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Drawer, Empty, Field, Modal, ModThumb, Notice, Switch } from "../components/ui";
import { api, confirmDialog, isTauri, pickFile } from "../lib/api";
import { fmtBytes, fmtDate, useStore } from "../lib/store";
import { CATEGORY_LABEL, type Category, type ConflictReport, type ModView } from "../lib/types";

export default function Library() {
  const mods = useStore((s) => s.mods);
  const profiles = useStore((s) => s.profiles);
  const { run, refresh, refreshMods } = useStore.getState();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<Category | "all" | "on">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [manageProfiles, setManageProfiles] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null);
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => setOrder(mods.map((m) => m.manifest.id)), [mods]);

  // arrastar arquivos .scd/.zip para a janela importa
  useEffect(() => {
    if (!isTauri) return;
    let off: (() => void) | undefined;
    (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      off = await getCurrentWebview().onDragDropEvent(async (e) => {
        if (e.payload.type !== "drop") return;
        for (const p of e.payload.paths) {
          await run("import", () => api.importMod(p, true), (m) => `"${m.name}" importado e ativado.`);
        }
        await refreshMods();
      });
    })();
    return () => off?.();
  }, [run, refreshMods]);

  const byId = useMemo(() => new Map(mods.map((m) => [m.manifest.id, m])), [mods]);
  const visible = order
    .map((id) => byId.get(id))
    .filter((m): m is ModView => !!m)
    .filter((m) => (cat === "all" ? true : cat === "on" ? m.enabled : m.manifest.category === cat))
    .filter((m) => {
      const q = query.trim().toLowerCase();
      return !q || m.manifest.name.toLowerCase().includes(q) || m.manifest.id.includes(q) || m.manifest.files.some((f) => f.name.toLowerCase().includes(q));
    });
  const filtering = query.trim() !== "" || cat !== "all";
  const cats = Array.from(new Set(mods.map((m) => m.manifest.category)));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
    setOrder(next);
    await run("reorder", () => api.reorderMods(next));
    await refreshMods();
  };

  const importFrom = async (directory: boolean) => {
    const p = await pickFile([{ name: "Mods do SC2", extensions: ["scd", "zip"] }], directory);
    if (!p) return;
    await run("import", () => api.importMod(p, true), (m) => `"${m.name}" importado e ativado no perfil.`);
    await refreshMods();
  };

  const toggle = async (m: ModView, v: boolean) => {
    await run("toggle:" + m.manifest.id, () => api.setModEnabled(m.manifest.id, v));
    await refreshMods();
  };

  const opened = openId ? byId.get(openId) : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Biblioteca</h1>
          <p>Ligue e desligue mods e arraste para mudar a ordem de carga — quando dois mods trazem o mesmo arquivo, vale o que estiver mais abaixo.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => importFrom(true)}><FolderOpen size={16} /> Importar pasta</button>
          <button className="btn primary" onClick={() => importFrom(false)}><PackageOpen size={16} /> Importar .scd ou .zip</button>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 12 }}>
        <label className="row" style={{ gap: 8 }}>
          <Users size={16} className="muted" />
          <select className="select" aria-label="Perfil ativo" value={profiles?.active ?? ""} onChange={async (e) => {
            await run("profile", () => api.setActiveProfile(e.target.value));
            await refresh();
          }}>
            {profiles?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button className="btn ghost sm" onClick={() => setManageProfiles(true)}><Settings2 size={15} /> Perfis</button>
        <button className="btn ghost sm" onClick={async () => setConflicts((await run("conflicts", () => api.conflicts())) ?? null)}>
          <GitCompareArrows size={15} /> Conflitos
        </button>
        <div style={{ flex: 1 }} />
        <div className="search">
          <Search size={16} />
          <input className="input" placeholder="Buscar por nome ou arquivo" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar mods" />
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filtrar">
        <button className="chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>Todos ({mods.length})</button>
        <button className="chip" aria-pressed={cat === "on"} onClick={() => setCat("on")}>Ativos ({mods.filter((m) => m.enabled).length})</button>
        {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</button>)}
      </div>

      {mods.length === 0 ? (
        <div className="panel">
          <Empty icon={<FileArchive size={36} color="var(--faint)" />} title="Sua biblioteca está vazia"
            action={<div className="row"><button className="btn primary" onClick={() => importFrom(false)}>Importar um mod</button><button className="btn" onClick={() => useStore.getState().go("hub")}>Abrir o hub</button></div>}>
            Baixe mods no hub, importe um .scd/.zip que você já tem ou arraste arquivos para esta janela.
          </Empty>
        </div>
      ) : visible.length === 0 ? (
        <div className="panel"><Empty title="Nada encontrado">Tente outro termo ou limpe o filtro.</Empty></div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((m) => m.manifest.id)} strategy={verticalListSortingStrategy}>
            <div className="list panel" style={{ overflow: "hidden" }}>
              {visible.map((m) => (
                <ModRow key={m.manifest.id} m={m} draggable={!filtering && m.order != null} onToggle={(v) => toggle(m, v)} onOpen={() => setOpenId(m.manifest.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      {filtering && <p className="faint small">Limpe a busca e os filtros para reordenar.</p>}

      {opened && <ModDrawer m={opened} onClose={() => setOpenId(null)} />}
      {manageProfiles && <ProfilesModal onClose={() => setManageProfiles(false)} />}
      {conflicts && <ConflictsModal report={conflicts} onClose={() => setConflicts(null)} />}
    </div>
  );
}

function ModRow({ m, draggable, onToggle, onOpen }: { m: ModView; draggable: boolean; onToggle: (v: boolean) => void; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.manifest.id, disabled: !draggable });
  const size = m.manifest.files.reduce((a, f) => a + f.size, 0);
  return (
    <div ref={setNodeRef} className="list-row" style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.7 : 1, zIndex: isDragging ? 2 : undefined, position: "relative" }}>
      <span className="handle" {...attributes} {...listeners} aria-label={`Mover ${m.manifest.name}`} style={{ visibility: draggable ? "visible" : "hidden" }}>
        <GripVertical size={16} />
      </span>
      <span className="order-num">{m.order != null ? m.order + 1 : ""}</span>
      <ModThumb name={m.manifest.name} icon={m.icon} />
      <div className="grow" style={{ cursor: "pointer" }} onClick={onOpen}>
        <div className="title">{m.manifest.name} <span className="faint" style={{ fontWeight: 400 }}>{m.manifest.version}</span></div>
        <div className="sub">{m.manifest.files.map((f) => f.name).join(", ")} — {fmtBytes(size)}</div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="tag">{CATEGORY_LABEL[m.manifest.category]}</span>
        {m.manifest.multiplayer === "local" && <span className="tag info" title="Só visual: não altera a simulação">visual</span>}
        {m.manifest.requiresDlc && <span className="tag" title="Requer o DLC Infinite War Battle Pack">DLC</span>}
        {m.manifest.source.kind === "hub" && <span className="tag ok">hub</span>}
      </div>
      <button className="btn ghost icon-btn" onClick={onOpen} aria-label={`Detalhes de ${m.manifest.name}`}><Settings2 size={16} /></button>
      <Switch checked={m.enabled} onChange={onToggle} label={`${m.enabled ? "Desativar" : "Ativar"} ${m.manifest.name}`} />
    </div>
  );
}

function ModDrawer({ m, onClose }: { m: ModView; onClose: () => void }) {
  const { run, refreshMods } = useStore.getState();
  const [name, setName] = useState(m.manifest.name);
  const [description, setDescription] = useState(m.manifest.description);
  const [category, setCategory] = useState<Category>(m.manifest.category);
  const [mp, setMp] = useState(m.manifest.multiplayer);
  const [problems, setProblems] = useState<string[] | null>(null);
  const dirty = name !== m.manifest.name || description !== m.manifest.description || category !== m.manifest.category || mp !== m.manifest.multiplayer;

  return (
    <Drawer onClose={onClose} label={m.manifest.name}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="tag">{m.manifest.version}</span>
        <span className="tag">{m.manifest.source.kind === "hub" ? "instalado do hub" : m.manifest.source.kind === "studio" ? "feito no Estúdio" : m.manifest.source.kind === "adopted" ? "estava na pasta do jogo" : "importado"}</span>
        <span className="tag">desde {fmtDate(m.manifest.installedAt)}</span>
        {m.manifest.authors.length > 0 && <span className="tag">por {m.manifest.authors.join(", ")}</span>}
      </div>
      <Field label="Nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Descrição"><textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Categoria">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="No multiplayer" hint={mp === "sync" ? "Todos na partida precisam ter." : "Só muda o visual de quem usa."}>
          <select className="select" value={mp} onChange={(e) => setMp(e.target.value as typeof mp)}>
            <option value="sync">Precisa sincronizar</option>
            <option value="local">Só visual</option>
          </select>
        </Field>
      </div>
      <div>
        <h3 style={{ marginBottom: 8 }}>Arquivos</h3>
        <div className="col" style={{ gap: 6 }}>
          {m.manifest.files.map((f) => (
            <div key={f.name} className="row small">
              <span className="mono" style={{ flex: 1 }}>{f.name}</span>
              <span className="muted">{fmtBytes(f.size)}</span>
            </div>
          ))}
        </div>
      </div>
      {(m.manifest.dependencies.length > 0 || m.manifest.conflicts.length > 0) && (
        <div className="small col" style={{ gap: 4 }}>
          {m.manifest.dependencies.length > 0 && <span>Precisa de: {m.manifest.dependencies.map((d) => d.id + (d.version ? ` ${d.version}` : "")).join(", ")}</span>}
          {m.manifest.conflicts.length > 0 && <span>Não combina com: {m.manifest.conflicts.join(", ")}</span>}
        </div>
      )}
      {problems && (problems.length === 0 ? <Notice kind="ok">Arquivos íntegros.</Notice> : <Notice kind="err">{problems.join("; ")} — reinstale o mod.</Notice>)}
      <div style={{ flex: 1 }} />
      <footer>
        <button className="btn danger" onClick={async () => {
          if (!(await confirmDialog(`Apagar "${m.manifest.name}" da biblioteca? Ele sai do jogo na próxima vez que você aplicar o perfil.`))) return;
          await run("remove", () => api.removeMod(m.manifest.id), "Mod removido da biblioteca.");
          await refreshMods();
          onClose();
        }}><Trash2 size={15} /> Apagar</button>
        <button className="btn" onClick={async () => setProblems((await run("verify", () => api.verifyMod(m.manifest.id))) ?? null)}><ShieldCheck size={15} /> Verificar</button>
        <div style={{ flex: 1 }} />
        <button className="btn primary" disabled={!dirty} onClick={async () => {
          await run("meta", () => api.updateModMeta(m.manifest.id, { name, description, category, multiplayer: mp }), "Alterações salvas.");
          await refreshMods();
        }}>Salvar</button>
      </footer>
    </Drawer>
  );
}

function ProfilesModal({ onClose }: { onClose: () => void }) {
  const profiles = useStore((s) => s.profiles);
  const { run, refresh } = useStore.getState();
  const [newName, setNewName] = useState("");
  const [copy, setCopy] = useState(true);
  const set = (p: Awaited<ReturnType<typeof api.getProfiles>> | undefined) => p && useStore.setState({ profiles: p });
  return (
    <Modal title="Perfis" onClose={onClose}>
      <p className="muted small">Cada perfil guarda quais mods estão ligados e em que ordem. Ex.: um para partidas com amigos, outro para jogar a campanha original.</p>
      <div className="col" style={{ gap: 8 }}>
        {profiles?.profiles.map((p) => (
          <div key={p.id} className="row">
            <input className="input" style={{ flex: 1 }} defaultValue={p.name} aria-label={`Nome do perfil ${p.name}`}
              onBlur={async (e) => e.target.value.trim() && e.target.value !== p.name && set(await run("rename", () => api.renameProfile(p.id, e.target.value)))} />
            <span className="faint small" style={{ width: 64 }}>{p.mods.filter((m) => m.enabled).length} ativos</span>
            {profiles.active === p.id ? <span className="tag ok">ativo</span> : (
              <button className="btn sm" onClick={async () => { set(await run("activate", () => api.setActiveProfile(p.id))); await refresh(); }}>Usar</button>
            )}
            <button className="btn ghost icon-btn" aria-label={`Apagar ${p.name}`} disabled={profiles.profiles.length <= 1}
              onClick={async () => (await confirmDialog(`Apagar o perfil "${p.name}"? Os mods continuam na biblioteca.`)) && set(await run("del", () => api.deleteProfile(p.id)))}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
      <hr className="sep" />
      <form className="col" onSubmit={async (e) => {
        e.preventDefault();
        if (!newName.trim()) return;
        set(await run("newprofile", () => api.createProfile(newName.trim(), copy ? profiles?.active : undefined), `Perfil "${newName.trim()}" criado.`));
        setNewName("");
      }}>
        <Field label="Novo perfil"><input className="input" placeholder="Ex.: Liga 2v2" value={newName} onChange={(e) => setNewName(e.target.value)} /></Field>
        <label className="row small"><input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} /> Copiar os mods do perfil ativo</label>
        <footer><button type="button" className="btn ghost" onClick={onClose}>Fechar</button><button className="btn primary" disabled={!newName.trim()}>Criar perfil</button></footer>
      </form>
    </Modal>
  );
}

function ConflictsModal({ report, onClose }: { report: ConflictReport; onClose: () => void }) {
  return (
    <Modal title="Conflitos do perfil" onClose={onClose}>
      <p className="muted small">
        O jogo monta os arquivos .scd em ordem alfabética e o último vence. Abaixo, quem sobrescreve quem — confirme sempre numa partida de teste.
      </p>
      {report.betweenMods.length === 0 ? <Notice kind="ok">Nenhum mod ativo sobrescreve outro mod.</Notice> : report.betweenMods.map((c) => (
        <details key={c.loser + c.winner} className="panel pad">
          <summary style={{ cursor: "pointer" }}><b>{c.winnerMod}</b> sobrescreve <b>{c.loserMod}</b> em {c.count} arquivo(s)</summary>
          <div className="mono faint selectable" style={{ marginTop: 8 }}>{c.samples.map((s) => <div key={s}>{s}</div>)}</div>
        </details>
      ))}
      {report.overridesStock.length > 0 && (
        <>
          <h3>Mudanças em arquivos do jogo</h3>
          {report.overridesStock.map((c) => (
            <div key={c.loser + c.winner} className="row small">
              <span style={{ flex: 1 }}><b>{c.winnerMod ?? c.winner}</b> altera {c.count} arquivo(s) de <span className="mono">{c.loser}</span></span>
            </div>
          ))}
        </>
      )}
      <footer><button className="btn primary" onClick={onClose}>Fechar</button></footer>
    </Modal>
  );
}
