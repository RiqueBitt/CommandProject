// "Criar": a biblioteca de projetos (mapas, tropas e modelos 3D). Daqui cada projeto abre em
// uma aba própria no topo do launcher.
import { useEffect, useMemo, useState } from "react";
import { UNITS_ENABLED } from "../../lib/features";
import { Empty, Field, Icon, Modal } from "../../components/ui";
import { ContextMenu, type CtxItem } from "../../components/studio/kit";
import { api, confirmDialog, pickFile, pickSave } from "../../lib/api";
import { load, useStore } from "../../lib/store";
import { locale, t } from "../../lib/i18n";
import { KIND_META, useTabs } from "../../lib/tabs";
import type { CreationKind, CreationMeta, Terrain, UnitInfo } from "../../lib/types";
import { MODEL_TEMPLATES, newMapDoc, newUnitDoc, suggestUnitId } from "./docs";
import { BLANK_SIZES, blankLabel, blankTerrain, mapKm } from "../studio/mapEdit";

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
    { icon: "open_in_new", label: t("Abrir em aba"), onClick: () => open(m) },
    { icon: m.favorite ? "star" : "star_outline", label: m.favorite ? t("Tirar dos favoritos") : t("Favoritar"), onClick: async () => { await api.creationUpdate(m.id, { favorite: !m.favorite }); void reload(); } },
    { icon: "edit", label: t("Renomear e descrever"), onClick: () => setRenaming(m) },
    { icon: "content_copy", label: t("Duplicar"), onClick: async () => { await run("dup", () => api.creationDuplicate(m.id), t("Projeto duplicado.")); void reload(); } },
    { icon: "ios_share", label: t("Exportar (.cpproj)"), onClick: async () => {
      const dest = await pickSave(`${m.name}.cpproj`, [{ name: t("Projeto do CommandProject"), extensions: ["cpproj"] }]);
      if (dest) await run("export", () => api.creationExport(m.id, dest), t("Projeto exportado."));
    } },
    "-",
    { icon: "delete", label: t("Apagar"), danger: true, onClick: async () => {
      if (!(await confirmDialog(t('Apagar "{name}"? O projeto vai para a lixeira do launcher.', { name: m.name })))) return;
      useTabs.getState().close(m.id);
      await run("del", () => api.creationDelete(m.id), t("Projeto apagado."));
      void reload();
    } },
  ];

  const go = useStore((x) => x.go);
  const setStudioTab = useStore((x) => x.setStudioTab);
  const area = createKind === "map"
    ? { icon: "map", over: t("Mapas"), title: t("Editor e gerador de mapas"), text: t("Gere mundos por semente (relevo, água, massa, florestas e áreas estratégicas), edite à mão, valide e exporte o .scd. Tudo fica no seu computador."), links: [] as { icon: string; label: string; go: () => void }[] }
    : createKind === "unit"
    ? (UNITS_ENABLED
      ? { icon: "smart_toy", over: t("Tropas"), title: t("Gerador e editor de tropas"), text: t("Parta de uma unidade do jogo ou misture três (chassi, torre e arma). Ajuste atributos, armas, animações, textura e ícone; a verificação de combate e movimento roda antes de gerar."), links: [{ icon: "photo_camera", label: t("Gerador de ícones"), go: () => go("icons") }] }
      : { icon: "pause_circle", over: t("Tropas"), title: t("Editor de tropas pausado"), text: t("Desligado por enquanto: o foco agora é o gerador e o editor de mapas. Os projetos de tropa que você já tem continuam salvos."), links: [{ icon: "map", label: t("Ir para os mapas"), go: () => useStore.getState().goCreate("map") }] })
    : createKind === "model"
    ? { icon: "view_in_ar", over: t("Modelos 3D e texturas"), title: t("Modelos 3D e texturas"), text: t("Modele com formas, edite vértices, UVs e materiais. Texturas procedurais (camuflagem, painéis, desgaste e sujeira) ficam no editor de tropas; texturas HD e skins dos arquivos do jogo, no Estúdio."), links: [{ icon: "texture", label: t("Texturas HD e skins (Estúdio)"), go: () => { setStudioTab("hd"); go("studio"); } }, ...(UNITS_ENABLED ? [{ icon: "smart_toy", label: t("Texturas de tropas"), go: () => useStore.getState().goCreate("unit") }] : [])] }
    : { icon: "auto_awesome", over: t("Estúdio de criação"), title: t("O que vamos criar hoje?"), text: t("Cada projeto abre numa aba própria, com salvamento automático, versões anteriores e cópias de segurança locais."), links: [] };

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
          {(createKind === "all" ? (["map", "unit", "model"] as CreationKind[]) : [createKind]).filter((k) => UNITS_ENABLED || k !== "unit").map((k) => (
            <button key={k} className="create-card" style={{ ["--kc" as string]: KIND_META[k].color }} onClick={() => setCreating(k)}>
              <span className="ic"><Icon name={KIND_META[k].icon} size={30} /></span>
              <b>{k === "map" ? t("Criar novo mapa") : k === "unit" ? t("Criar nova tropa") : t("Criar modelo 3D")}</b>
              <small>{t(DESC[k])}</small>
              {k === "unit" && <span className="tag-exp">{t("experimental")}</span>}
            </button>
          ))}
        </div>
      </header>

      <section className="create-list">
        <div className="row create-toolbar">
          <div className="search-bar" style={{ flex: 1, maxWidth: 420 }}>
            <Icon name="search" />
            <input className="input" placeholder={t("Buscar projetos, etiquetas…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Buscar projetos")} />
          </div>
          <div className="chips" style={{ padding: 0 }}>
            <button className="chip" aria-pressed={kind === "all"} onClick={() => setKind("all")}>{t("Todos ({n})", { n: list?.length ?? 0 })}</button>
            {(["map", "unit", "model"] as CreationKind[]).filter((k) => UNITS_ENABLED || k !== "unit" || counts[k] > 0).map((k) => (
              <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}><Icon name={KIND_META[k].icon} size={15} /> {k === "model" ? t("Modelos 3D") : k === "map" ? t("Mapas") : t("Tropas")} ({counts[k]})</button>
            ))}
            <button className="chip" aria-pressed={kind === "fav"} onClick={() => setKind("fav")}><Icon name="star" size={15} /> {t("Favoritos")}</button>
          </div>
          <span className="grow" />
          <button className="btn" onClick={async () => {
            const p = await pickFile([{ name: t("Projeto do CommandProject"), extensions: ["cpproj"] }]);
            if (!p) return;
            const m = await run("import", () => api.creationImport(p), (x) => t('"{name}" importado.', { name: x.name }));
            if (m) { void reload(); open(m); }
          }}><Icon name="file_open" size={18} /> {t("Importar")}</button>
        </div>

        {list === null ? <div className="bar indeterminate"><i /></div> : shown.length === 0 ? (
          <Empty icon="draw" title={list.length ? t("Nada com esse filtro") : t("Nenhum projeto ainda")}>
            {list.length ? t("Tente outro termo ou tipo.") : t("Crie um mapa, uma tropa ou um modelo 3D acima — ou comece por um exemplo.")}
          </Empty>
        ) : (
          <div className="proj-grid">
            {shown.map((m) => (
              <article key={m.id} className="proj-card" tabIndex={0} onDoubleClick={() => open(m)} onKeyDown={(e) => e.key === "Enter" && open(m)}
                onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, m }); }}>
                <div className="thumb" style={{ ["--kc" as string]: KIND_META[m.kind].color }}>
                  {thumbs[m.id] ? <img src={thumbs[m.id]} alt="" /> : <Icon name={KIND_META[m.kind].icon} size={46} />}
                  <span className="kind-badge"><Icon name={KIND_META[m.kind].icon} size={14} /> {t(KIND_META[m.kind].label)}</span>
                  {m.favorite && <Icon name="star" className="fav" size={18} />}
                </div>
                <div className="body">
                  <b title={m.name}>{m.name}</b>
                  <small className="faint">{t("editado {date}", { date: new Date(m.updatedAt).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) })}</small>
                  {m.description && <small className="muted clamp2">{m.description}</small>}
                </div>
                <footer>
                  <button className="btn sm primary" onClick={() => open(m)}><Icon name="open_in_new" size={16} /> {t("Abrir")}</button>
                  <button className="btn icon-btn sm" aria-label={t("Mais ações")} onClick={(e) => setCtx({ x: e.clientX, y: e.clientY, m })}><Icon name="more_vert" size={18} /></button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={menu(ctx.m)} onClose={() => setCtx(null)} />}
      {creating && <NewProject kind={creating} onClose={() => setCreating(null)} onCreated={(m) => { setCreating(null); void reload(); open(m); toast("ok", t('"{name}" criado.', { name: m.name })); }} />}
      {renaming && <Rename m={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); void reload(); }} />}
    </div>
  );
}

function Rename({ m, onClose, onDone }: { m: CreationMeta; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(m.name);
  const [desc, setDesc] = useState(m.description);
  const [tags, setTags] = useState(m.tags.join(", "));
  return (
    <Modal title={t("Renomear e descrever")} icon="edit" onClose={onClose}>
      <form className="col" style={{ gap: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        await api.creationUpdate(m.id, { name, description: desc, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
        useTabs.getState().rename(m.id, name.trim() || m.name);
        onDone();
      }}>
        <Field label={t("Nome")}><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("Descrição")}><textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
        <Field label={t("Etiquetas")} hint={t("Separadas por vírgula. Ajudam a buscar.")}><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" disabled={!name.trim()}>{t("Salvar")}</button></footer>
      </form>
    </Modal>
  );
}

/** Assistente de projeto novo: nome + ponto de partida (terreno, modelo inicial ou unidade base). */
export function NewProject({ kind, onClose, onCreated }: { kind: CreationKind; onClose: () => void; onCreated: (m: CreationMeta) => void }) {
  const [name, setName] = useState(() => (kind === "map" ? t("Meu mapa") : kind === "unit" ? t("Minha tropa") : t("Meu modelo")));
  const [template, setTemplate] = useState("empty");
  const [terrains, setTerrains] = useState<Terrain[] | null>(null);
  const [terrain, setTerrain] = useState<string | null>(null);
  // mapa novo começa em branco (chão liso de grama); um mapa do jogo como base é opcional
  const [start, setStart] = useState<"blank" | "game">("blank");
  const [mapSize, setMapSize] = useState(1024);
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
        setTerrain((t) => t ?? list.find((x) => x.kind === "skirmish")?.id ?? list[0]?.id ?? null);
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
      if (kind === "map") {
        if (start === "game") return api.creationCreate("map", name, newMapDoc({ terrain, lobbyName: name }));
        return api.creationCreate("map", name, newMapDoc({ terrain: blankTerrain(mapSize), mapSize, lobbyName: name, base: "blank", clean: true, minimap: "natural", patch: true }));
      }
      if (kind === "model") return api.creationCreate("model", name, (MODEL_TEMPLATES.find((t) => t.id === template) ?? MODEL_TEMPLATES[0]).make());
      const taken = new Set((units ?? []).map((u) => u.id));
      const u = units?.find((x) => x.id === base);
      return api.creationCreate("unit", name, newUnitDoc({ base, newId: suggestUnitId(name, taken), name, description: u ? t("Baseada em {name}.", { name: u.name }) : "" }));
    });
    if (m) onCreated(m);
  };

  return (
    <Modal title={kind === "map" ? t("Criar novo mapa") : kind === "unit" ? t("Criar nova tropa") : t("Criar modelo 3D")} icon={KIND_META[kind].icon} onClose={onClose} wide>
      <div className="col" style={{ gap: 14 }}>
        <Field label={t("Nome do projeto")}><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>

        {kind === "map" && (
          <Field label={t("Começar de")} hint={t("Em branco: chão liso de grama do tamanho escolhido, pronto para esculpir, texturizar e decorar. Dá para trocar depois.")}>
            <div className="blank-sizes">
              {[512, 1024, 2048, 4096].map((k) => (
                <button key={k} type="button" className="pick" aria-pressed={start === "blank" && mapSize === k} onClick={() => { setStart("blank"); setMapSize(k); }}>
                  <Icon name={k > 2048 ? "public" : "grass"} size={22} />
                  <b>{k > 2048 ? t("Mapa gigante") : t("Em branco")}</b>
                  <small className="faint">{blankLabel(k)}</small>
                </button>
              ))}
              <button type="button" className="pick" aria-pressed={start === "game"} onClick={() => setStart("game")}>
                <Icon name="terrain" size={22} />
                <b>{t("Mapa do jogo")}</b>
                <small className="faint">{t("relevo, água e texturas de um mapa existente")}</small>
              </button>
            </div>
          </Field>
        )}
        {kind === "map" && start === "blank" && (
          <Field label={t("Tamanho: {size} × {size} ({km} km de lado)", { size: mapSize, km: mapKm(mapSize) })} hint={mapSize > 2048 ? t("Experimental: o jogo original vai até 2048 (40 km). Maior que isso pesa mais no jogo e leva alguns minutos para gerar; teste antes de chamar os amigos.") : t("Dá para mudar depois em Propriedades → Tamanho (tudo acompanha na mesma proporção).")}>
            <input type="range" min={BLANK_SIZES[0]} max={BLANK_SIZES[BLANK_SIZES.length - 1]} step={512} value={mapSize} onChange={(e) => setMapSize(Number(e.target.value))} aria-label={t("Tamanho do mapa")} />
          </Field>
        )}
        {kind === "map" && start === "game" && (
          <Field label={t("Terreno base")} hint={t("O relevo, a água e as texturas vêm desse terreno do jogo. Dá para trocar depois.")}>
            {terrains === null ? <div className="bar indeterminate"><i /></div> : terrains.length === 0 ? (
              <p className="faint small">{t("Não achei os terrenos (o Estúdio de Mapas precisa do Python e do jogo). Dá para criar o projeto e escolher depois.")}</p>
            ) : (
              <div className="pick-grid">
                {terrains.filter((ter) => ter.kind === "skirmish").map((ter) => (
                  <button key={ter.id} type="button" className="pick" aria-pressed={terrain === ter.id} onClick={() => setTerrain(ter.id)}>
                    <Icon name="terrain" size={22} />
                    <b>{ter.name ?? ter.id}</b>
                    <small className="faint">{ter.players ? t("até {n} jogadores", { n: ter.players }) : ter.id}</small>
                  </button>
                ))}
              </div>
            )}
          </Field>
        )}

        {kind === "model" && (
          <Field label={t("Começar com")}>
            <div className="pick-grid">
              {MODEL_TEMPLATES.map((tp) => (
                <button key={tp.id} type="button" className="pick" aria-pressed={template === tp.id} onClick={() => setTemplate(tp.id)}>
                  <Icon name={tp.id === "empty" ? "add_box" : tp.id === "tower" ? "cell_tower" : tp.id === "crates" ? "inventory_2" : "agriculture"} size={22} />
                  <b>{t(tp.name)}</b>
                  <small className="faint">{t(tp.desc)}</small>
                </button>
              ))}
            </div>
          </Field>
        )}

        {kind === "unit" && (
          <Field label={t("Unidade base")} hint={t("A tropa nova começa como uma cópia dela (atributos, armas, animações e comportamento). A original não muda.")}>
            {units === null ? <div className="bar indeterminate"><i /></div> : units.length === 0 ? (
              <p className="faint small">{t("Não consegui ler as unidades do jogo. Confira a pasta do jogo nas Configurações.")}</p>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                <div className="search-bar"><Icon name="search" /><input className="input dense" placeholder={t("Buscar: tanque, uef, artilharia, uul0101…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
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
          <button className="btn text" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn primary" disabled={!name.trim() || busy || (kind === "unit" && !base)} onClick={create}>
            <Icon name="add" size={18} /> {busy ? t("Criando…") : t("Criar e abrir")}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
