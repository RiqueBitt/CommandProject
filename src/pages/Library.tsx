import MenuThemeCard from "../components/MenuThemeCard";
import ShadersCard from "../components/ShadersCard";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState } from "react";
import { AiModal, CheatsModal, ConflictsModal, InstallLinkModal, OptimizeModal } from "../components/dialogs";
import { Drawer, Empty, Field, Icon, ModThumb, Notice, Switch } from "../components/ui";
import { api, confirmDialog, isTauri, pickFile } from "../lib/api";
import { t, tr } from "../lib/i18n";
import { fmtBytes, fmtDate, useStore } from "../lib/store";
import { CATEGORY_LABEL, type Category, type ConflictReport, type ModView } from "../lib/types";

import { CATEGORY_ICON } from "../lib/types";
export { CATEGORY_ICON };

export default function Library() {
  const mods = useStore((s) => s.mods);
  const d = useStore((s) => s.dashboard);
  const busyConflicts = useStore((s) => s.busy.conflicts);
  const { run, refreshMods, go } = useStore.getState();
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<Category | "all" | "on">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null);
  const [link, setLink] = useState(false);
  const [cheats, setCheats] = useState(false);
  const [ai, setAi] = useState(false);
  const [opt, setOpt] = useState(false);
  const [order, setOrder] = useState<string[]>([]);

  useEffect(() => { setOrder(mods.map((m) => m.manifest.id)); }, [mods]);

  // arrastar arquivos .scd/.zip para a janela importa
  useEffect(() => {
    if (!isTauri) return;
    let off: (() => void) | undefined;
    (async () => {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      off = await getCurrentWebview().onDragDropEvent(async (e) => {
        if (e.payload.type !== "drop") return;
        for (const p of e.payload.paths) await run("import", () => api.importMod(p, true), (m) => t('"{name}" importado e ativado.', { name: m.name }));
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
    const p = await pickFile([{ name: t("Mods do SC2"), extensions: ["scd", "zip"] }], directory);
    if (!p) return;
    await run("import", () => api.importMod(p, true), (m) => t('"{name}" importado e ativado no perfil.', { name: m.name }));
    await refreshMods();
  };
  const toggle = async (m: ModView, v: boolean) => {
    await run("toggle:" + m.manifest.id, () => api.setModEnabled(m.manifest.id, v));
    await refreshMods();
  };
  const opened = openId ? byId.get(openId) : undefined;

  return (
    <div className="scroll">
      <div className="page">
        <div className="head">
          <div className="grow">
            <h1 className="page-title">{t("Mods de {profile}", { profile: d?.activeProfileName ?? t("perfil") })}</h1>
            <p className="muted" style={{ marginTop: 6 }}>{t("Ligue, desligue e arraste para mudar a ordem de carga — quando dois mods trazem o mesmo arquivo, vale o que estiver mais abaixo.")}</p>
          </div>
          <div className="row">
            <button className="btn text" disabled={busyConflicts} onClick={async () => setConflicts((await run("conflicts", () => api.conflicts())) ?? null)}><Icon name={busyConflicts ? "hourglass_top" : "compare_arrows"} /> {busyConflicts ? t("Analisando…") : t("Conflitos")}</button>
            <button className="btn tonal" onClick={() => go("hub")} title={t("IA esperta, Trapaças, Otimização e os outros mods do CommandProject")}><Icon name="store" /> {t("Hub de mods")}</button>
            <button className="btn text" onClick={() => setLink(true)}><Icon name="link" /> {t("De um link")}</button>
            <button className="btn" onClick={() => importFrom(true)}><Icon name="folder_open" /> {t("Pasta")}</button>
            <button className="btn primary" onClick={() => importFrom(false)}><Icon name="add" /> {t("Importar .scd ou .zip")}</button>
          </div>
        </div>

        <ShadersCard />
        <MenuThemeCard />

        <div className="row wrap" style={{ gap: 12 }}>
          <div className="search-bar" style={{ width: 340 }}>
            <Icon name="search" />
            <input className="input dense" placeholder={t("Buscar por nome ou arquivo")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Buscar mods")} />
          </div>
          <div className="seg" role="group" aria-label={t("Filtrar")}>
            <button className="btn" aria-pressed={cat === "all"} onClick={() => setCat("all")}>{t("Todos")} {mods.length}</button>
            <button className="btn" aria-pressed={cat === "on"} onClick={() => setCat("on")}>{t("Ativos")} {mods.filter((m) => m.enabled).length}</button>
            {cats.map((c) => <button key={c} className="btn" aria-pressed={cat === c} onClick={() => setCat(c)}><Icon name={CATEGORY_ICON[c]} size={17} /> {t(CATEGORY_LABEL[c])}</button>)}
          </div>
        </div>

        {mods.length === 0 ? (
          <div className="card">
            <Empty icon="extension" title={t("Nenhum mod ainda")}
              action={<div className="row"><button className="btn primary" onClick={() => importFrom(false)}>{t("Importar um mod")}</button><button className="btn" onClick={() => go("hub")}>{t("Abrir o hub")}</button></div>}>
              {t("Baixe mods no hub, importe um .scd/.zip que você já tem ou arraste arquivos para esta janela.")}
            </Empty>
          </div>
        ) : visible.length === 0 ? (
          <div className="card"><Empty icon="search_off" title={t("Nada encontrado")}>{t("Tente outro termo ou limpe o filtro.")}</Empty></div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.map((m) => m.manifest.id)} strategy={verticalListSortingStrategy}>
              <div className="list">
                {visible.map((m) => <ModRow key={m.manifest.id} m={m} draggable={!filtering && m.order != null} onToggle={(v) => toggle(m, v)} onOpen={() => setOpenId(m.manifest.id)} />)}
              </div>
            </SortableContext>
          </DndContext>
        )}
        {filtering && <p className="faint small">{t("Limpe a busca e os filtros para reordenar.")}</p>}
      </div>
      {opened && <ModDrawer m={opened} onClose={() => setOpenId(null)} />}
      {conflicts && <ConflictsModal report={conflicts} onClose={() => setConflicts(null)} />}
      {link && <InstallLinkModal onClose={() => setLink(false)} />}
      {ai && <AiModal installed={mods.some((m) => m.manifest.id === "cp-ia-esperta")} onClose={() => setAi(false)} />}
      {opt && <OptimizeModal onClose={() => setOpt(false)} />}
      {cheats && <CheatsModal installed={mods.some((m) => m.manifest.id === "cp-trapacas")} onClose={() => setCheats(false)} />}
    </div>
  );
}

function ModRow({ m, draggable, onToggle, onOpen }: { m: ModView; draggable: boolean; onToggle: (v: boolean) => void; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.manifest.id, disabled: !draggable });
  const size = m.manifest.files.reduce((a, f) => a + f.size, 0);
  return (
    <div ref={setNodeRef} className={`list-row ${m.enabled ? "" : "off"}`} style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, position: "relative", boxShadow: isDragging ? "0 10px 30px rgba(0,0,0,.45)" : undefined }}>
      <span className="handle" {...attributes} {...listeners} aria-label={t("Mover {name}", { name: m.manifest.name })} style={{ visibility: draggable ? "visible" : "hidden" }}><Icon name="drag_indicator" size={20} /></span>
      <span className="order-num">{m.order != null ? m.order + 1 : ""}</span>
      <ModThumb name={m.manifest.name} icon={m.icon} />
      <div className="grow" style={{ cursor: "pointer" }} onClick={onOpen}>
        <div className="title">{m.manifest.name} <span className="faint" style={{ fontWeight: 400 }}>{m.manifest.version}</span></div>
        <div className="sub">{m.manifest.files.map((f) => f.name).join(", ")} — {fmtBytes(size)}</div>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="chip"><Icon name={CATEGORY_ICON[m.manifest.category]} /> {t(CATEGORY_LABEL[m.manifest.category])}</span>
        {m.manifest.multiplayer === "local" && <span className="chip info" title={t("Só visual: não altera a simulação")}>{t("visual")}</span>}
        {m.manifest.requiresDlc && <span className="chip" title={t("Requer o DLC Infinite War Battle Pack")}>DLC</span>}
        {m.manifest.source.kind === "hub" && <span className="chip ok">hub</span>}
      </div>
      <button className="btn icon-btn sm" onClick={onOpen} aria-label={t("Detalhes de {name}", { name: m.manifest.name })}><Icon name="more_vert" size={20} /></button>
      <Switch checked={m.enabled} onChange={onToggle} label={m.enabled ? t("Desativar {name}", { name: m.manifest.name }) : t("Ativar {name}", { name: m.manifest.name })} />
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
  const origin = { hub: t("instalado do hub"), studio: t("feito no Estúdio"), adopted: t("estava na pasta do jogo"), link: t("baixado de um link") }[m.manifest.source.kind] ?? t("importado");

  return (
    <Drawer onClose={onClose} label={m.manifest.name}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="chip">{m.manifest.version}</span>
        <span className="chip">{origin}</span>
        <span className="chip">{t("desde {date}", { date: fmtDate(m.manifest.installedAt) })}</span>
        {m.manifest.authors.length > 0 && <span className="chip">{t("por {authors}", { authors: m.manifest.authors.join(", ") })}</span>}
      </div>
      <Field label={t("Nome")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Descrição")}><textarea className="textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("Categoria")}>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </Field>
        <Field label={t("No multiplayer")} hint={mp === "sync" ? t("Todos na partida precisam ter.") : t("Só muda o visual de quem usa.")}>
          <select className="select" value={mp} onChange={(e) => setMp(e.target.value as typeof mp)}>
            <option value="sync">{t("Precisa sincronizar")}</option>
            <option value="local">{t("Só visual")}</option>
          </select>
        </Field>
      </div>
      <div>
        <div className="overline" style={{ marginBottom: 8 }}>{t("Arquivos")}</div>
        <div className="col" style={{ gap: 6 }}>
          {m.manifest.files.map((f) => (
            <div key={f.name} className="row small"><span className="mono" style={{ flex: 1 }}>{f.name}</span><span className="muted">{fmtBytes(f.size)}</span></div>
          ))}
        </div>
      </div>
      {(m.manifest.dependencies.length > 0 || m.manifest.conflicts.length > 0) && (
        <div className="small col" style={{ gap: 4 }}>
          {m.manifest.dependencies.length > 0 && <span>{t("Precisa de: {list}", { list: m.manifest.dependencies.map((d) => d.id + (d.version ? ` ${d.version}` : "")).join(", ") })}</span>}
          {m.manifest.conflicts.length > 0 && <span>{t("Não combina com: {list}", { list: m.manifest.conflicts.join(", ") })}</span>}
        </div>
      )}
      {problems && (problems.length === 0 ? <Notice kind="ok">{t("Arquivos íntegros.")}</Notice> : <Notice kind="err">{problems.map(tr).join("; ")} {t("— reinstale o mod.")}</Notice>)}
      <div style={{ flex: 1 }} />
      <footer>
        <button className="btn danger" onClick={async () => {
          if (!(await confirmDialog(t('Apagar "{name}" da biblioteca? Ele sai do jogo na próxima vez que você aplicar o perfil.', { name: m.manifest.name })))) return;
          await run("remove", () => api.removeMod(m.manifest.id), t("Mod removido da biblioteca."));
          await refreshMods();
          onClose();
        }}><Icon name="delete" /> {t("Apagar")}</button>
        <button className="btn text" onClick={async () => setProblems((await run("verify", () => api.verifyMod(m.manifest.id))) ?? null)}><Icon name="verified" /> {t("Verificar")}</button>
        <span className="spacer" />
        <button className="btn primary" disabled={!dirty} onClick={async () => {
          await run("meta", () => api.updateModMeta(m.manifest.id, { name, description, category, multiplayer: mp }), t("Alterações salvas."));
          await refreshMods();
        }}>{t("Salvar")}</button>
      </footer>
    </Drawer>
  );
}
