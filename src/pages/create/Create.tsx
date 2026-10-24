// "Criar": a biblioteca de projetos (mapas, tropas e modelos 3D). Daqui cada projeto abre em
// uma aba própria no topo do launcher.
import { useEffect, useMemo, useState } from "react";
import { Empty, Field, Icon, Modal } from "../../components/ui";
import { ContextMenu, type CtxItem } from "../../components/studio/kit";
import { api, confirmDialog, pickFile, pickSave } from "../../lib/api";
import { load, useStore } from "../../lib/store";
import { KIND_META, useTabs } from "../../lib/tabs";
import type { CreationKind, CreationMeta, Terrain, UnitInfo } from "../../lib/types";
import { MODEL_TEMPLATES, newMapDoc, newUnitDoc, suggestUnitId } from "./docs";

const DESC: Record<CreationKind, string> = {
  map: "Terreno 3D do jogo, relevo, água, bases, massa, decorações, texturas do chão e modelos próprios.",
  unit: "Parta de uma unidade do jogo: modelo, textura, atributos, armas, animações e categorias.",
  model: "Modele com formas básicas, edite vértices, aplique cores e texturas e use em mapas e tropas.",
};

export default function Create() {
  const [list, setList] = useState<CreationMeta[] | null>(null);
  const [q, setQ] = useState("");
  const createKind = useStore((x) => x.createKind);
  const [kind, setKind] = useState<CreationKind | "all" | "fav">(createKind);
  useEffect(() => { setKind(createKind); }, [createKind]);
  const [creating, setCreating] = useState<CreationKind | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; m: CreationMeta } | null>(null);
  const [renaming, setRenaming] = useState<CreationMeta | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const open = useTabs((s) => s.open);
  const { run, toast } = useStore.getState();

  const reload = async () => setList((await load(() => api.creations())) ?? []);
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    for (const m of list ?? []) {
      if (m.hasThumb && !thumbs[m.id]) void api.creationThumb(m.id).then((t) => t && setThumbs((s) => ({ ...s, [m.id]: t }))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (list ?? []).filter((m) =>
      (kind === "all" || (kind === "fav" ? m.favorite : m.kind === kind)) &&
      (!t || m.name.toLowerCase().includes(t) || m.description.toLowerCase().includes(t) || m.tags.some((g) => g.toLowerCase().includes(t))));
  }, [list, q, kind]);

  const counts = useMemo(() => {
    const c = { map: 0, unit: 0, model: 0 } as Record<CreationKind, number>;
    for (const m of list ?? []) c[m.kind]++;
    return c;
  }, [list]);

  const menu = (m: CreationMeta): (CtxItem | "-")[] => [
    { icon: "open_in_new", label: "Abrir em aba", onClick: () => open(m) },
    { icon: m.favorite ? "star" : "star_outline", label: m.favorite ? "Tirar dos favoritos" : "Favoritar", onClick: async () => { await api.creationUpdate(m.id, { favorite: !m.favorite }); void reload(); } },
    { icon: "edit", label: "Renomear e descrever", onClick: () => setRenaming(m) },
    { icon: "content_copy", label: "Duplicar", onClick: async () => { await run("dup", () => api.creationDuplicate(m.id), "Projeto duplicado."); void reload(); } },
    { icon: "ios_share", label: "Exportar (.cpproj)", onClick: async () => {
      const dest = await pickSave(`${m.name}.cpproj`, [{ name: "Projeto do CommandProject", extensions: ["cpproj"] }]);
      if (dest) await run("export", () => api.creationExport(m.id, dest), "Projeto exportado.");
    } },
    "-",
    { icon: "delete", label: "Apagar", danger: true, onClick: async () => {
      if (!(await confirmDialog(`Apagar "${m.name}"? O projeto vai para a lixeira do launcher.`))) return;
      useTabs.getState().close(m.id);
      await run("del", () => api.creationDelete(m.id), "Projeto apagado.");
      void reload();
    } },
  ];

  const go = useStore((x) => x.go);
  const setStudioTab = useStore((x) => x.setStudioTab);
  const area = createKind === "map"
    ? { icon: "map", over: "Mapas", title: "Editor e gerador de mapas", text: "Gere mundos por semente (relevo, água, massa, florestas e áreas estratégicas), edite à mão, valide e exporte o .scd. Tudo fica no seu computador.", links: [] as { icon: string; label: string; go: () => void }[] }
    : createKind === "unit"
    ? { icon: "smart_toy", over: "Tropas", title: "Gerador e editor de tropas", text: "Parta de uma unidade do jogo ou misture três (chassi, torre e arma). Ajuste atributos, armas, animações, textura e ícone; a verificação de combate e movimento roda antes de gerar.", links: [{ icon: "photo_camera", label: "Gerador de ícones", go: () => go("icons") }] }
    : createKind === "model"
    ? { icon: "view_in_ar", over: "Modelos 3D e texturas", title: "Modelos 3D e texturas", text: "Modele com formas, edite vértices, UVs e materiais. Texturas procedurais (camuflagem, painéis, desgaste e sujeira) ficam no editor de tropas; texturas HD e skins dos arquivos do jogo, no Estúdio.", links: [{ icon: "texture", label: "Texturas HD e skins (Estúdio)", go: () => { setStudioTab("hd"); go("studio"); } }, { icon: "smart_toy", label: "Texturas de tropas", go: () => useStore.getState().goCreate("unit") }] }
    : { icon: "auto_awesome", over: "Estúdio de criação", title: "O que vamos criar hoje?", text: "Cada projeto abre numa aba própria, com salvamento automático, versões anteriores e cópias de segurança locais.", links: [] };

  return (
    <div className="page create-page">
      <header className="create-hero">
        <div>
          <span className="overline"><Icon name={area.icon} size={15} /> {area.over}</span>
          <h1>{area.title}</h1>
          <p className="muted">{area.text}</p>
          {area.links.length > 0 && <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}>{area.links.map((l) => (
            <button key={l.label} className="btn sm" onClick={l.go}><Icon name={l.icon} size={16} /> {l.label}</button>
          ))}</div>}
        </div>
        <div className="create-actions">
          {(createKind === "all" ? (["map", "unit", "model"] as CreationKind[]) : [createKind]).map((k) => (
            <button key={k} className="create-card" style={{ ["--kc" as string]: KIND_META[k].color }} onClick={() => setCreating(k)}>
              <span className="ic"><Icon name={KIND_META[k].icon} size={30} /></span>
              <b>{k === "map" ? "Criar novo mapa" : k === "unit" ? "Criar nova tropa" : "Criar modelo 3D"}</b>
              <small>{DESC[k]}</small>
              {k === "unit" && <span className="tag-exp">experimental</span>}
            </button>
          ))}
        </div>
      </header>

      <section className="create-list">
        <div className="row create-toolbar">
          <div className="search-bar" style={{ flex: 1, maxWidth: 420 }}>
            <Icon name="search" />
            <input className="input" placeholder="Buscar projetos, etiquetas…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar projetos" />
          </div>
          <div className="chips" style={{ padding: 0 }}>
            <button className="chip" aria-pressed={kind === "all"} onClick={() => setKind("all")}>Todos ({list?.length ?? 0})</button>
            {(["map", "unit", "model"] as CreationKind[]).map((k) => (
              <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}><Icon name={KIND_META[k].icon} size={15} /> {k === "model" ? "Modelos 3D" : `${KIND_META[k].label}s`} ({counts[k]})</button>
            ))}
            <button className="chip" aria-pressed={kind === "fav"} onClick={() => setKind("fav")}><Icon name="star" size={15} /> Favoritos</button>
          </div>
          <span className="grow" />
          <button className="btn" onClick={async () => {
            const p = await pickFile([{ name: "Projeto do CommandProject", extensions: ["cpproj"] }]);
            if (!p) return;
            const m = await run("import", () => api.creationImport(p), (x) => `"${x.name}" importado.`);
            if (m) { void reload(); open(m); }
          }}><Icon name="file_open" size={18} /> Importar</button>
        </div>

        {list === null ? <div className="bar indeterminate"><i /></div> : shown.length === 0 ? (
          <Empty icon="draw" title={list.length ? "Nada com esse filtro" : "Nenhum projeto ainda"}>
            {list.length ? "Tente outro termo ou tipo." : "Crie um mapa, uma tropa ou um modelo 3D acima — ou comece por um exemplo."}
          </Empty>
        ) : (
          <div className="proj-grid">
            {shown.map((m) => (
              <article key={m.id} className="proj-card" tabIndex={0} onDoubleClick={() => open(m)} onKeyDown={(e) => e.key === "Enter" && open(m)}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, m }); }}>
                <div className="thumb" style={{ ["--kc" as string]: KIND_META[m.kind].color }}>
                  {thumbs[m.id] ? <img src={thumbs[m.id]} alt="" /> : <Icon name={KIND_META[m.kind].icon} size={46} />}
                  <span className="kind-badge"><Icon name={KIND_META[m.kind].icon} size={14} /> {KIND_META[m.kind].label}</span>
                  {m.favorite && <Icon name="star" className="fav" size={18} />}
                </div>
                <div className="body">
                  <b title={m.name}>{m.name}</b>
                  <small className="faint">editado {new Date(m.updatedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small>
                  {m.description && <small className="muted clamp2">{m.description}</small>}
                </div>
                <footer>
                  <button className="btn sm primary" onClick={() => open(m)}><Icon name="open_in_new" size={16} /> Abrir</button>
                  <button className="btn icon-btn sm" aria-label="Mais ações" onClick={(e) => setCtx({ x: e.clientX, y: e.clientY, m })}><Icon name="more_vert" size={18} /></button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={menu(ctx.m)} onClose={() => setCtx(null)} />}
      {creating && <NewProject kind={creating} onClose={() => setCreating(null)} onCreated={(m) => { setCreating(null); void reload(); open(m); toast("ok", `"${m.name}" criado.`); }} />}
      {renaming && <Rename m={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); void reload(); }} />}
    </div>
  );
}

function Rename({ m, onClose, onDone }: { m: CreationMeta; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(m.name);
  const [desc, setDesc] = useState(m.description);
  const [tags, setTags] = useState(m.tags.join(", "));
  return (
    <Modal title="Renomear e descrever" icon="edit" onClose={onClose}>
      <form className="col" style={{ gap: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        await api.creationUpdate(m.id, { name, description: desc, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
        useTabs.getState().rename(m.id, name.trim() || m.name);
        onDone();
      }}>
        <Field label="Nome"><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Descrição"><textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label="Etiquetas" hint="Separadas por vírgula. Ajudam a buscar."><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <footer><button type="button" className="btn text" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!name.trim()}>Salvar</button></footer>
      </form>
    </Modal>
  );
}

/** Assistente de projeto novo: nome + ponto de partida (terreno, modelo inicial ou unidade base). */
export function NewProject({ kind, onClose, onCreated }: { kind: CreationKind; onClose: () => void; onCreated: (m: CreationMeta) => void }) {
  const [name, setName] = useState(kind === "map" ? "Meu mapa" : kind === "unit" ? "Minha tropa" : "Meu modelo");
  const [template, setTemplate] = useState("empty");
  const [terrains, setTerrains] = useState<Terrain[] | null>(null);
  const [terrain, setTerrain] = useState<string | null>(null);
  const [units, setUnits] = useState<UnitInfo[] | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const busy = useStore((s) => s.busy.create);
  const { run } = useStore.getState();

  useEffect(() => {
    if (kind === "map") {
      void api.maptkStatus().then(async (s) => {
        if (!s.ready) { setTerrains([]); return; }
        const list = (await load(() => api.maptkCatalog()))?.terrains ?? [];
        setTerrains(list);
        // já vem um terreno escolhido: o mapa abre pronto para editar
        setTerrain((t) => t ?? list[0]?.id ?? null);
      });
    }
    if (kind === "unit") void load(() => api.unitCatalog()).then((u) => setUnits(u ?? []));
  }, [kind]);

  const unitList = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (units ?? []).filter((u) => !t || u.id.includes(t) || u.name.toLowerCase().includes(t) || u.faction.toLowerCase().includes(t));
  }, [units, q]);

  const create = async () => {
    const m = await run("create", async () => {
      if (kind === "map") return api.creationCreate("map", name, newMapDoc({ terrain, lobbyName: name }));
      if (kind === "model") return api.creationCreate("model", name, (MODEL_TEMPLATES.find((t) => t.id === template) ?? MODEL_TEMPLATES[0]).make());
      const taken = new Set((units ?? []).map((u) => u.id));
      const u = units?.find((x) => x.id === base);
      return api.creationCreate("unit", name, newUnitDoc({ base, newId: suggestUnitId(name, taken), name, description: u ? `Baseada em ${u.name}.` : "" }));
    });
    if (m) onCreated(m);
  };

  return (
    <Modal title={kind === "map" ? "Criar novo mapa" : kind === "unit" ? "Criar nova tropa" : "Criar modelo 3D"} icon={KIND_META[kind].icon} onClose={onClose} wide>
      <div className="col" style={{ gap: 14 }}>
        <Field label="Nome do projeto"><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>

        {kind === "map" && (
          <Field label="Terreno base" hint="O relevo, a água e as texturas vêm desse terreno do jogo. Dá para trocar depois.">
            {terrains === null ? <div className="bar indeterminate"><i /></div> : terrains.length === 0 ? (
              <p className="faint small">Não achei os terrenos (o Estúdio de Mapas precisa do Python e do jogo). Dá para criar o projeto e escolher depois.</p>
            ) : (
              <div className="pick-grid">
                {terrains.filter((t) => t.kind === "skirmish").map((t) => (
                  <button key={t.id} type="button" className="pick" aria-pressed={terrain === t.id} onClick={() => setTerrain(t.id)}>
                    <Icon name="terrain" size={22} />
                    <b>{t.name ?? t.id}</b>
                    <small className="faint">{t.players ? `até ${t.players} jogadores` : t.id}</small>
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}

        {kind === "model" && (
          <Field label="Começar com">
            <div className="pick-grid">
              {MODEL_TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="pick" aria-pressed={template === t.id} onClick={() => setTemplate(t.id)}>
                  <Icon name={t.id === "empty" ? "add_box" : t.id === "tower" ? "cell_tower" : t.id === "crates" ? "inventory_2" : "agriculture"} size={22} />
                  <b>{t.name}</b>
                  <small className="faint">{t.desc}</small>
                </button>
              ))}
            </div>
          </Field>
        )}

        {kind === "unit" && (
          <Field label="Unidade base" hint="A tropa nova começa como uma cópia dela (atributos, armas, animações e comportamento). A original não muda.">
            {units === null ? <div className="bar indeterminate"><i /></div> : units.length === 0 ? (
              <p className="faint small">Não consegui ler as unidades do jogo. Confira a pasta do jogo nas Configurações.</p>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <div className="search-bar"><Icon name="search" /><input className="input dense" placeholder="Buscar: tanque, uef, artilharia, uul0101…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
                <div className="unit-pick">
                  {unitList.slice(0, 300).map((u) => (
                    <button key={u.id} type="button" className="pick row-pick" aria-pressed={base === u.id} onClick={() => setBase(u.id)}>
                      <span className={`fac fac-${u.faction.toLowerCase()}`}>{u.faction.slice(0, 1)}</span>
                      <span className="grow"><b>{u.name}</b> <small className="faint">{u.id}</small></span>
                      <small className="faint">{u.role}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>
        )}

        <footer>
          <button className="btn text" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!name.trim() || busy || (kind === "unit" && !base)} onClick={create}>
            <Icon name="add" size={18} /> {busy ? "Criando…" : "Criar e abrir"}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
