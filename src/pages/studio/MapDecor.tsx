import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Icon, Modal } from "../../components/ui";
import { api } from "../../lib/api";
import type { PropInfo, PropPreview } from "../../lib/types";
import { groundCandidates, layerFits, type GroundBiome, type GroundLayer } from "./mapEdit";

const ModelViewer = lazy(() => import("../../components/ModelViewer"));

const CATEGORY_LABEL: Record<string, string> = {
  Trees: "Árvores", Rocks: "Pedras", Buildings: "Prédios", Structures: "Estruturas", Warehouses: "Armazéns",
  Crates: "Caixas", Lights: "Luzes", Debris: "Destroços", Wreckage: "Restos de unidades", Cranes: "Guindastes", Barges: "Barcaças",
};
const catLabel = (c: string) => CATEGORY_LABEL[c] ?? c;
const nice = (n: string) => n.replace(/_/g, " ").replace(/(\d+)$/, " $1").replace(/\s+/g, " ").trim();

// miniaturas de textura em memória (cada uma é lida do jogo uma vez)
const thumbs = new Map<string, Promise<string | null>>();
export function useGameTexture(path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let alive = true;
    if (!thumbs.has(path)) thumbs.set(path, api.gameTexture(path, 128).catch(() => null));
    void thumbs.get(path)!.then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

function TextureThumb({ path, size = 64 }: { path?: string | null; size?: number }) {
  const url = useGameTexture(path);
  return url
    ? <img className="tex-thumb" src={url} alt="" width={size} height={size} />
    : <span className="tex-thumb empty" style={{ width: size, height: size }}><Icon name="texture" /></span>;
}

/** Catálogo de decorações: busca, categorias, as que o terreno já usa e prévia 3D. */
export function PropPicker({ props, used, selected, onSelect }: {
  props: PropInfo[] | null;
  used: string[];
  selected: string | null;
  onSelect: (bp: string) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("used");
  const [preview, setPreview] = useState<PropPreview | null | undefined>(undefined);
  const usedSet = useMemo(() => new Set(used.map((u) => u.toLowerCase())), [used]);
  const cats = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of props ?? []) c.set(p.category, (c.get(p.category) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [props]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (props ?? []).filter((p) =>
      (cat === "all" || (cat === "used" ? usedSet.has(p.bp.toLowerCase()) : p.category === cat)) &&
      (!t || p.name.toLowerCase().includes(t) || p.bp.toLowerCase().includes(t)),
    );
  }, [props, q, cat, usedSet]);

  useEffect(() => {
    if (!selected) { setPreview(undefined); return; }
    let alive = true;
    setPreview(undefined);
    void api.propPreview(selected).then((p) => { if (alive) setPreview(p); }).catch(() => { if (alive) setPreview(null); });
    return () => { alive = false; };
  }, [selected]);

  if (props === null) return <div className="bar indeterminate"><i /></div>;
  const current = props.find((p) => p.bp === selected);
  return (
    <div className="decor-picker">
      <div className="decor-list">
        <div className="search-bar">
          <Icon name="search" />
          <input className="input dense" placeholder="Buscar: spruce, rock, crate…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar decoração" />
        </div>
        <div className="chips">
          <button className="chip" aria-pressed={cat === "used"} onClick={() => setCat("used")}>Deste terreno ({used.length})</button>
          {cats.map(([c, n]) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{catLabel(c)} ({n})</button>)}
          <button className="chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>Todas</button>
        </div>
        <div className="decor-items" role="listbox" aria-label="Decorações">
          {list.slice(0, 300).map((p) => (
            <button key={p.bp} role="option" aria-selected={p.bp === selected} className="decor-item" onClick={() => onSelect(p.bp)}>
              <Icon name={p.category === "Trees" ? "park" : p.category === "Rocks" ? "landslide" : p.category === "Wreckage" ? "precision_manufacturing" : "domain"} size={18} />
              <span className="nm">{nice(p.name)}</span>
              <span className="faint small">{catLabel(p.category)}</span>
            </button>
          ))}
          {list.length === 0 && <p className="faint small" style={{ padding: 10 }}>{cat === "used" ? "Este terreno não tem decorações: escolha uma categoria." : "Nada com esse nome."}</p>}
        </div>
      </div>
      <div className="decor-preview">
        {!selected ? (
          <div className="empty-preview"><Icon name="park" /><span className="faint small">Escolha uma decoração para ver em 3D e colocar no mapa.</span></div>
        ) : preview === undefined ? (
          <div className="bar indeterminate" style={{ margin: 20 }}><i /></div>
        ) : preview === null ? (
          <div className="empty-preview"><Icon name="view_in_ar" /><span className="faint small">Sem prévia 3D para esta, mas dá para colocar.</span></div>
        ) : (
          <Suspense fallback={null}><ModelViewer mesh={preview.mesh} texture={preview.texture} /></Suspense>
        )}
        {current && <div className="small"><b>{nice(current.name)}</b> <span className="faint">{catLabel(current.category)}</span></div>}
      </div>
    </div>
  );
}

/** Camadas de textura do chão do terreno, com troca por camadas de qualquer mapa do jogo. */
export function GroundTextures({ layers, all, reskin, onChange }: {
  layers: GroundLayer[];
  all: GroundLayer[] | null;
  reskin: Record<string, GroundLayer>;
  onChange: (oldD: string, neo: GroundLayer | null) => void;
}) {
  const [swap, setSwap] = useState<GroundLayer | null>(null);
  if (!layers.length) return <p className="faint small">Este terreno não lista camadas de textura (alguns terrenos de campanha usam outro formato).</p>;
  return (
    <div className="ground-layers">
      {layers.map((l) => {
        const now = reskin[l.d];
        return (
          <div key={l.d} className="ground-layer">
            <TextureThumb path={(now ?? l).d} size={52} />
            <div className="grow">
              <b>{nice(l.name)}</b>
              <span className="faint small" title={now ? `${now.name} de ${now.map}` : undefined}>{now ? `→ ${nice(now.name)} · ${now.map.replace(/^SC2_/, "")}` : "original"}</span>
            </div>
            {now && <button className="btn icon-btn sm" aria-label={`Voltar ${l.name} ao original`} title="Voltar ao original" onClick={() => onChange(l.d, null)}><Icon name="undo" size={18} /></button>}
            <button className="btn icon-btn sm" aria-label={`Trocar ${nice(l.name)}`} title="Trocar textura" onClick={() => setSwap(l)}><Icon name="format_paint" size={18} /></button>
          </div>
        );
      })}
      {swap && <LayerChooser target={swap} all={all} onPick={(n) => { onChange(swap.d, n); setSwap(null); }} onClose={() => setSwap(null)} />}
    </div>
  );
}

function LayerChooser({ target, all, onPick, onClose }: { target: GroundLayer; all: GroundLayer[] | null; onPick: (l: GroundLayer) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (all ?? []).filter((l) => layerFits(target, l) && (!t || l.name.toLowerCase().includes(t) || l.map.toLowerCase().includes(t)));
  }, [all, target, q]);
  const tooLong = (all ?? []).filter((l) => l.d !== target.d && !layerFits(target, l)).length;
  return (
    <Modal title={`Trocar "${nice(target.name)}"`} icon="format_paint" onClose={onClose} wide>
      <div className="col" style={{ gap: 12 }}>
        <div className="search-bar">
          <Icon name="search" />
          <input className="input dense" autoFocus placeholder="Buscar: snow, grass, rock, sand, MP_302…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar textura" />
        </div>
        <p className="faint small">
          Texturas do chão de todos os mapas do jogo. Ela entra no lugar da camada inteira (diffuse, relevo e brilho).
          {tooLong > 0 && ` ${tooLong} não aparecem porque o nome do arquivo não cabe no espaço deste terreno.`}
        </p>
        <div className="layer-grid">
          {all === null ? <div className="bar indeterminate"><i /></div> : options.slice(0, 240).map((l) => (
            <button key={l.d} className="layer-tile" onClick={() => onPick(l)}>
              <TextureThumb path={l.d} size={96} />
              <b>{nice(l.name)}</b>
              <span className="faint small">{l.map.replace(/^SC2_/, "")}</span>
            </button>
          ))}
          {all !== null && options.length === 0 && <p className="faint small">Nenhuma textura com esse nome cabe aqui.</p>}
        </div>
      </div>
    </Modal>
  );
}

const BIOMES: { id: GroundBiome; label: string; icon: string }[] = [
  { id: "temperate", label: "Grama", icon: "grass" }, { id: "desert", label: "Areia", icon: "wb_sunny" },
  { id: "snow", label: "Neve", icon: "ac_unit" }, { id: "volcanic", label: "Terra escura", icon: "local_fire_department" },
];
/** nomes que não são chão natural (metal, piso de cidade, paredes…) */
const NOT_GROUND = /metal|floor|wall|trim|window|teleporter|greeble|road|plate|tile|concrete|pipe|panel|decal|clouds|water|foam|wave|black|white|engine/;

/** Chão do visual limpo: uma textura para o mapa inteiro (a mesma no editor e no jogo). */
export function CleanGround({ all, minSlot, biome, chosen, onBiome, onPick }: {
  all: GroundLayer[] | null;
  /** menor espaço de texto entre as camadas do terreno base: o caminho novo precisa ser menor */
  minSlot: number;
  biome: GroundBiome;
  chosen: string | null;
  onBiome: (b: GroundBiome) => void;
  onPick: (d: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const fits = (l: GroundLayer) => !minSlot || l.d.length < minSlot;
  const current = useMemo(() => groundCandidates(all ?? [], biome, chosen).find(fits) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, biome, chosen, minSlot]);
  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    const seen = new Set<string>();
    return (all ?? []).filter((l) => {
      const k = l.d.toLowerCase();
      if (seen.has(k) || !fits(l) || NOT_GROUND.test(k)) return false;
      seen.add(k);
      return !t || l.name.toLowerCase().includes(t) || l.map.toLowerCase().includes(t);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, minSlot]);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="ground-layer">
        <TextureThumb path={current?.d} size={52} />
        <div className="grow">
          <b>{current ? nice(current.name) : "—"}</b>
          <span className="faint small" style={{ textTransform: "none" }}>{current ? `${current.map.replace(/^SC2_/, "")} · em todo o chão` : "nenhuma textura cabe neste terreno"}</span>
        </div>
        {chosen && <button className="btn icon-btn sm" title="Voltar à automática do bioma" aria-label="Textura automática" onClick={() => onPick(null)}><Icon name="undo" size={18} /></button>}
      </div>
      <div className="chips" style={{ padding: 0 }}>
        {BIOMES.map((b) => (
          <button key={b.id} className="chip" aria-pressed={biome === b.id} onClick={() => onBiome(b.id)}>
            <Icon name={b.icon} size={15} /> {b.label}
          </button>
        ))}
      </div>
      <div className="search-bar"><Icon name="search" /><input className="input dense" placeholder="Buscar: grass, sand, snow, MP_007…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar textura do chão" /></div>
      <div className="layer-grid compact">
        {all === null ? <div className="bar indeterminate"><i /></div> : options.slice(0, 120).map((l) => (
          <button key={l.d} className="layer-tile" aria-pressed={current?.d === l.d} onClick={() => onPick(l.d)} title={l.d}>
            <TextureThumb path={l.d} size={72} />
            <b>{nice(l.name)}</b>
            <span className="faint small">{l.map.replace(/^SC2_/, "")}</span>
          </button>
        ))}
      </div>
      <p className="faint small">A luz e as sombras do chão são refeitas para o relevo novo ao gerar o mapa.</p>
    </div>
  );
}
