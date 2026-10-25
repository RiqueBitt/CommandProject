import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Icon, Modal } from "../../components/ui";
import { api } from "../../lib/api";
import type { PropInfo, PropPreview } from "../../lib/types";
import { layerFits, type GroundBiome, type GroundLayer } from "./mapEdit";
import { isGroundLayer, ROLE_LABEL, ROLES, type GroundRole } from "./biome";
import { isCustomPath, texUrl } from "./customTex";

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
    if (!thumbs.has(path) || isCustomPath(path)) thumbs.set(path, texUrl(path, 128).catch(() => null));
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

/** Chão por biomas: o pincel de textura (principal) e as texturas de cada parte. */
export function GroundPaint({ all, chain, biome, role, painting, hasPaint, ring, radius, strength, onRole, onBiome, onPick, onClearPaint, onRing, onRadius, onStrength, onImport, onForget }: {
  all: GroundLayer[] | null;
  /** textura de cada papel (praia, chão, terra, rocha, topo) */
  chain: (GroundLayer | null)[];
  biome: GroundBiome;
  role: number;
  painting: boolean;
  hasPaint: boolean;
  ring: boolean;
  radius: number;
  strength: number;
  onRole: (r: number) => void;
  onBiome: (b: GroundBiome) => void;
  onPick: (role: GroundRole, d: string | null) => void;
  onClearPaint: () => void;
  onRing: (v: boolean) => void;
  onRadius: (v: number) => void;
  onStrength: (v: number) => void;
  /** importa uma imagem como textura (devolve o caminho da difusa) */
  onImport: (file: File, seamless: boolean) => Promise<string>;
  /** tira uma textura importada da lista do mapa */
  onForget: (d: string) => void;
}) {
  const [swap, setSwap] = useState<GroundRole | null>(null);
  return (
    <div className="col ground-paint" style={{ gap: 10 }}>
      <div className="card-title" style={{ margin: 0 }}><Icon name="brush" size={18} /><b>Pincel de textura</b></div>
      <p className="faint small" style={{ margin: 0 }}>Escolha a textura e pinte partes do chão. O resto fica automático: praia na água, terra nas encostas, rocha nos paredões e neve no alto.</p>
      <div className="paint-roles">
        {ROLES.map((r, k) => (
          <button key={r} className="paint-role" aria-pressed={painting && role === k} onClick={() => onRole(k)} title={`Pintar: ${ROLE_LABEL[r]}`}>
            <TextureThumb path={chain[k]?.d} size={46} />
            <span>{ROLE_LABEL[r]}</span>
          </button>
        ))}
        <button className="paint-role eraser" aria-pressed={painting && role < 0} onClick={() => onRole(-1)} title="Borracha: volta ao automático">
          <span className="paint-eraser-icon"><Icon name="auto_fix_high" size={24} /></span>
          <span>Automático</span>
        </button>
      </div>
      <label className="row small" style={{ gap: 8 }}>Tamanho<input type="range" min={8} max={260} value={radius} onChange={(e) => onRadius(Number(e.target.value))} className="grow" /><b style={{ width: 34, textAlign: "right" }}>{radius}</b></label>
      <label className="row small" style={{ gap: 8 }}>Força<input type="range" min={5} max={60} value={strength} onChange={(e) => onStrength(Number(e.target.value))} className="grow" /><b style={{ width: 34, textAlign: "right" }}>{strength}</b></label>
      {hasPaint && <button className="btn sm text" onClick={onClearPaint}><Icon name="layers_clear" size={16} /> Apagar toda a pintura</button>}

      <div className="card-title" style={{ margin: "6px 0 0" }}><Icon name="public" size={18} /><b>Bioma</b></div>
      <div className="chips" style={{ padding: 0 }}>
        {BIOMES.map((b) => (
          <button key={b.id} className="chip" aria-pressed={biome === b.id} onClick={() => onBiome(b.id)}><Icon name={b.icon} size={15} /> {b.label}</button>
        ))}
      </div>
      <div className="ground-layers">
        {ROLES.map((r, k) => (
          <div key={r} className="ground-layer">
            <TextureThumb path={chain[k]?.d} size={40} />
            <div className="grow">
              <b>{ROLE_LABEL[r]}</b>
              <span className="faint small" style={{ textTransform: "none" }}>{chain[k] ? `${nice(chain[k]!.name)} · ${chain[k]!.map.replace(/^SC2_/, "")}` : "sem textura"}</span>
            </div>
            <button className="btn icon-btn sm" title="Trocar textura" aria-label={`Trocar ${ROLE_LABEL[r]}`} onClick={() => setSwap(r)}><Icon name="format_paint" size={18} /></button>
          </div>
        ))}
      </div>
      <label className="check small"><input type="checkbox" checked={ring} onChange={(e) => onRing(e.target.checked)} /> Paisagem em volta do mapa (montanhas além da borda)</label>
      {swap && <RoleChooser role={swap} all={all} onPick={(d) => { onPick(swap, d); setSwap(null); }} onClose={() => setSwap(null)} onImport={onImport} onForget={onForget} />}
    </div>
  );
}

function RoleChooser({ role, all, onPick, onClose, onImport, onForget }: {
  role: GroundRole; all: GroundLayer[] | null; onPick: (d: string | null) => void; onClose: () => void;
  onImport: (file: File, seamless: boolean) => Promise<string>; onForget: (d: string) => void;
}) {
  const [q, setQ] = useState("");
  const [seamless, setSeamless] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const mine = useMemo(() => (all ?? []).filter((l) => isCustomPath(l.d)), [all]);
  const options = useMemo(() => {
    const t = q.trim().toLowerCase();
    const seen = new Set<string>();
    return (all ?? []).filter((l) => {
      const k = l.d.toLowerCase();
      if (seen.has(k) || !isGroundLayer(l) || isCustomPath(l.d)) return false;
      seen.add(k);
      return !t || l.name.toLowerCase().includes(t) || l.map.toLowerCase().includes(t);
    });
  }, [all, q]);
  const take = async (f: File | undefined | null) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|bmp|gif)$/i.test(f.type) && !/\.(png|jpe?g|webp|bmp)$/i.test(f.name)) { setErr("Use uma imagem .png, .jpg, .webp ou .bmp."); return; }
    setBusy(true); setErr(null);
    try { onPick(await onImport(f, seamless)); } catch (e) { setErr(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Textura: ${ROLE_LABEL[role]}`} icon="format_paint" onClose={onClose} wide>
      <div className="col" style={{ gap: 12 }}>
        <label className={`tex-drop${drag ? " over" : ""}${busy ? " busy" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void take(e.dataTransfer.files?.[0]); }}>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/bmp,.png,.jpg,.jpeg,.webp,.bmp" hidden disabled={busy}
            onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }} />
          <Icon name={busy ? "hourglass_top" : "add_photo_alternate"} size={28} />
          <div className="col" style={{ gap: 2 }}>
            <b>{busy ? "Preparando a textura…" : "Importar imagem como textura"}</b>
            <span className="faint small">Arraste ou clique: .png, .jpg, .webp ou .bmp. Vira um quadrado de até 1024 px; relevo e brilho saem da própria imagem.</span>
          </div>
        </label>
        <label className="check small" style={{ marginTop: -4 }}><input type="checkbox" checked={seamless} onChange={(e) => setSeamless(e.target.checked)} /> Deixar contínua (sem emenda ao repetir no chão)</label>
        {err && <div className="notice err small"><Icon name="error" size={16} /> {err}</div>}
        {mine.length > 0 && <>
          <b className="small">Minhas texturas</b>
          <div className="layer-grid compact">
            {mine.map((l) => (
              <div key={l.d} className="layer-tile mine">
                <button className="layer-pick" onClick={() => onPick(l.d)} title={`Usar ${l.name}`}><TextureThumb path={l.d} size={72} /><b>{l.name}</b></button>
                <button className="btn icon-btn sm forget" title="Tirar da lista do mapa" aria-label={`Tirar ${l.name}`} onClick={() => onForget(l.d)}><Icon name="close" size={14} /></button>
              </div>
            ))}
          </div>
        </>}
        <div className="row" style={{ gap: 8 }}>
          <div className="search-bar grow"><Icon name="search" /><input className="input dense" autoFocus placeholder="Buscar no jogo: grass, sand, snow, rock, MP_007…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar textura" /></div>
          <button className="btn sm" onClick={() => onPick(null)}><Icon name="undo" size={16} /> Automática do bioma</button>
        </div>
        <div className="layer-grid">
          {all === null ? <div className="bar indeterminate"><i /></div> : options.slice(0, 300).map((l) => (
            <button key={l.d} className="layer-tile" onClick={() => onPick(l.d)} title={l.d}>
              <TextureThumb path={l.d} size={96} />
              <b>{nice(l.name)}</b>
              <span className="faint small">{l.map.replace(/^SC2_/, "")}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
