// Editor de tropas em aba própria: parte de uma unidade do jogo e separa aparência, atributos,
// armas, animações e comportamento (categorias). Mudar a aparência não apaga o resto.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Panel, ProjectBar, PropertyGrid, Ribbon, RibbonButton, RibbonGroup, StatusBar, StudioLayout, Tree,
  useActiveEditor, useHotkeys, type Prop, type TreeNode,
} from "../../components/studio/kit";
import { Empty, Icon, Modal, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { errorText, useStore } from "../../lib/store";
import { useTabs } from "../../lib/tabs";
import type { AnimKey, BpLeaf, CreationMeta, ScaAnimation, UnitBuildReq, UnitBuildResult, UnitDetails, UnitInfo } from "../../lib/types";
import { useProject } from "../../lib/useProject";
import { migrateUnit, newUnitDoc, type UnitDoc } from "./docs";
import UnitViewport, { viewFromBaked, viewFromPreview, type ViewModel } from "./UnitViewport";

type Section = "general" | "look" | `attr:${string}` | `weapon:${number}` | "anims" | `anim:${string}` | "cats" | "advanced" | "bp" | "check";

const ATTRS: { id: string; label: string; icon: string; fields: [string, string, string?][] }[] = [
  { id: "defense", label: "Defesa", icon: "shield", fields: [["Defense.MaxHealth", "Vida máxima"], ["Defense.Health", "Vida inicial"], ["Defense.RegenRate", "Regeneração por segundo"], ["Defense.ArmorType", "Tipo de blindagem"], ["Defense.Shield.ShieldMaxHealth", "Escudo (vida)"], ["Defense.Shield.ShieldRegenRate", "Regeneração do escudo"], ["Defense.Shield.ShieldSize", "Tamanho do escudo"]] },
  { id: "economy", label: "Custo e construção", icon: "payments", fields: [["Economy.BuildCostMass", "Custo em massa"], ["Economy.BuildCostEnergy", "Custo em energia"], ["Economy.BuildTime", "Tempo de construção"], ["Economy.BuildRate", "Velocidade de construção"], ["Economy.MaintenanceConsumptionPerSecondEnergy", "Consumo de energia/s"], ["Economy.ProductionPerSecondMass", "Produz massa/s"], ["Economy.ProductionPerSecondEnergy", "Produz energia/s"]] },
  { id: "physics", label: "Movimento", icon: "speed", fields: [["Physics.MotionType", "Tipo de movimento"], ["Physics.MaxSpeed", "Velocidade máxima"], ["Physics.MaxSpeedReverse", "Velocidade de ré"], ["Physics.MaxAcceleration", "Aceleração"], ["Physics.MaxBrake", "Frenagem"], ["Physics.TurnRate", "Giro (graus/s)"], ["Air.MaxAirspeed", "Velocidade no ar"], ["Air.TurnSpeed", "Giro no ar"], ["Physics.Elevation", "Altura de voo/flutuação"]] },
  { id: "intel", label: "Visão e radar", icon: "visibility", fields: [["Intel.VisionRadius", "Visão"], ["Intel.RadarRadius", "Radar"], ["Intel.SonarRadius", "Sonar"], ["Intel.OmniRadius", "Omni (vê invisíveis)"], ["Intel.WaterVisionRadius", "Visão na água"]] },
  { id: "size", label: "Tamanho", icon: "straighten", fields: [["Display.UniformScale", "Escala do modelo"], ["SizeX", "Largura (colisão)"], ["SizeY", "Altura (colisão)"], ["SizeZ", "Comprimento (colisão)"], ["LifeBarSize", "Barra de vida"], ["LifeBarOffset", "Altura da barra"]] },
];
const WEAPON_FIELDS: [string, string][] = [
  ["Label", "Nome"], ["Damage", "Dano"], ["DamageRadius", "Raio do dano"], ["MaxRadius", "Alcance máximo"], ["MinRadius", "Alcance mínimo"], ["RateOfFire", "Cadência (tiros/s)"],
  ["MuzzleVelocity", "Velocidade do projétil"], ["ProjectileId", "Projétil"], ["FiringRandomness", "Imprecisão"], ["FiringTolerance", "Tolerância de mira"],
  ["TurretYawSpeed", "Giro da torre"], ["TurretPitchSpeed", "Elevação da torre"], ["TurretYawRange", "Alcance do giro"], ["EnergyRequired", "Energia por tiro"], ["DamageType", "Tipo de dano"],
];
const MOTION: Record<string, string> = { RULEUMT_Land: "Terrestre", RULEUMT_Air: "Aérea", RULEUMT_Water: "Naval", RULEUMT_Amphibious: "Anfíbia", RULEUMT_Hover: "Flutuante (hover)", RULEUMT_SurfacingSub: "Submarino", RULEUMT_None: "Parada" };
const TEAM = ["#2f6fd6", "#c8352b", "#d9a227", "#3fa34d", "#8e44ad", "#e67e22", "#eceff1"];
const ANIM_LABEL: Record<string, string> = { AnimationWalk: "Andar", AnimationIdle: "Parado", AnimationDeath: "Morte", AnimationActivate: "Ativar", AnimationOpen: "Abrir", AnimationBuild: "Construir", AnimationTakeOff: "Decolar", AnimationLand: "Pousar", AnimationTransform: "Transformar", AnimationUpgrade: "Melhorar", AnimationFire: "Disparar", AnimationReload: "Recarregar" };
const animLabel = (field: string) => { const k = field.split(".").pop() ?? field; return ANIM_LABEL[k] ?? k.replace(/^Animation/, ""); };

export default function UnitStudio({ id }: { id: string }) {
  const p = useProject<UnitDoc>(id, migrateUnit, newUnitDoc());
  const active = useActiveEditor();
  const doc = p.doc;
  const { toast, run, refreshMods } = useStore.getState();
  const [ribbon, setRibbon] = useState("home");
  const [section, setSection] = useState<Section>("general");
  const [details, setDetails] = useState<UnitDetails | null | undefined>(undefined);
  const [catalog, setCatalog] = useState<UnitInfo[] | null>(null);
  const [view, setView] = useState<ViewModel | null>(null);
  const [models, setModels] = useState<CreationMeta[] | null>(null);
  const [anim, setAnim] = useState<ScaAnimation | null>(null);
  const [animField, setAnimField] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [teamColor, setTeamColor] = useState(TEAM[0]);
  const [allAnims, setAllAnims] = useState<string[] | null>(null);
  const [animPick, setAnimPick] = useState<string | null>(null);
  const [animator, setAnimator] = useState(false);
  const [bpText, setBpText] = useState<string | null>(null);
  const [result, setResult] = useState<UnitBuildResult | null>(null);
  const [albedoUrl, setAlbedoUrl] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [advFilter, setAdvFilter] = useState("");
  const snapshot = useRef<(() => string | null) | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const busy = useStore((s) => s.busy[`unit:${id}`]);

  // ------------------------------------------------------------ dados
  useEffect(() => {
    void api.unitCatalog().then(setCatalog).catch(() => setCatalog([]));
    void api.creations().then((l) => setModels(l.filter((m) => m.kind === "model"))).catch(() => setModels([]));
  }, []);
  useEffect(() => {
    if (p.status !== "ready" || !doc.base) return;
    setDetails(undefined);
    void api.unitDetails(doc.base).then(setDetails).catch((e) => { setDetails(null); toast("error", errorText(e)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.base, p.status]);
  // prévia: modelo do jogo ou o modelo próprio
  const modelSrc = doc.appearance.model;
  useEffect(() => {
    if (p.status !== "ready" || !doc.base) return;
    let alive = true;
    setView(null);
    const req = modelSrc.source === "creation"
      ? api.modelBaked(modelSrc.creation).then((b) => (b ? viewFromBaked(b) : null))
      : api.unitPreview(doc.base).then(viewFromPreview);
    void req.then((v) => alive && setView(v)).catch(() => alive && setView(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.base, p.status, modelSrc.source, modelSrc.source === "creation" ? modelSrc.creation : ""]);
  useEffect(() => {
    if (!doc.appearance.albedoAsset) { setAlbedoUrl(null); return; }
    void api.creationAsset(id, doc.appearance.albedoAsset).then(setAlbedoUrl).catch(() => setAlbedoUrl(null));
  }, [id, doc.appearance.albedoAsset]);

  const leaves = useMemo(() => new Map((details?.leaves ?? []).map((l) => [l.path, l])), [details]);
  const value = (path: string): number | string | boolean | null => {
    if (path in doc.overrides) return doc.overrides[path];
    const l = leaves.get(path);
    return l ? (l.kind === "number" ? l.number : l.kind === "bool" ? l.flag : l.text) : null;
  };
  const changed = (path: string) => path in doc.overrides;
  const setValue = (path: string, v: number | string | boolean) => p.commit((d) => {
    const base = leaves.get(path);
    const orig = base ? (base.kind === "number" ? base.number : base.kind === "bool" ? base.flag : base.text) : undefined;
    const overrides = { ...d.overrides };
    if (orig === v) delete overrides[path]; else overrides[path] = v;
    return { ...d, overrides };
  });
  const reset = (path: string) => p.commit((d) => { const o = { ...d.overrides }; delete o[path]; return { ...d, overrides: o }; });

  const categories = useMemo(() => {
    const base = details?.categories ?? [];
    const rm = new Set(doc.categoriesRemove.map((c) => c.toUpperCase()));
    return [...base.filter((c) => !rm.has(c.toUpperCase())), ...doc.categoriesAdd.filter((c) => !base.some((b) => b.toUpperCase() === c.toUpperCase()))];
  }, [details, doc.categoriesAdd, doc.categoriesRemove]);

  // animações: as do blueprint, com as trocas do projeto
  const animFields = useMemo(() => {
    const m = new Map<string, string>((details?.animations ?? []).map(([f, path]) => [f, path]));
    for (const [f, a] of Object.entries(doc.animations)) m.set(f, a.file);
    return [...m.entries()];
  }, [details, doc.animations]);

  const playAnim = async (field: string, file: string) => {
    setAnimField(field);
    if (file.startsWith("asset:")) {
      toast("info", "A prévia de animações criadas aqui aparece depois de gerar a tropa (o arquivo já está no projeto).");
      return;
    }
    try { setAnim(await api.animRead(file)); setPlaying(true); } catch (e) { setAnim(null); toast("error", `Não deu para ler a animação: ${errorText(e)}`); }
  };

  // ------------------------------------------------------------ gerar
  const request = (): UnitBuildReq => ({
    base: doc.base ?? "", newId: doc.newId, name: doc.name, description: doc.description,
    overrides: Object.fromEntries(Object.entries(doc.overrides).filter(([k]) => k !== "Display.UniformScale")),
    categories: doc.categoriesAdd.length || doc.categoriesRemove.length ? categories : null,
    scale: typeof doc.overrides["Display.UniformScale"] === "number" ? (doc.overrides["Display.UniformScale"] as number) : doc.appearance.scale,
    animations: Object.entries(doc.animations).map(([f, a]) => [f, a.file, a.rate ?? null]),
    modelCreation: modelSrc.source === "creation" ? modelSrc.creation : null,
    albedoAsset: doc.appearance.albedoAsset,
    tint: [doc.appearance.tint.hue, doc.appearance.tint.sat, doc.appearance.tint.bright],
  });

  const problems = useMemo(() => {
    const out: { level: "err" | "warn"; text: string; section: Section }[] = [];
    if (!doc.base) out.push({ level: "err", text: "Escolha a unidade base.", section: "general" });
    if (!/^[a-z][a-z0-9_]{3,15}$/.test(doc.newId)) out.push({ level: "err", text: "O id precisa ter 4 a 16 letras minúsculas, números ou _, começando por letra.", section: "general" });
    if (catalog?.some((u) => u.id === doc.newId)) out.push({ level: "err", text: `Já existe a unidade ${doc.newId} no jogo: troque o id.`, section: "general" });
    if (!doc.name.trim()) out.push({ level: "err", text: "Dê um nome para a tropa.", section: "general" });
    const num = (pth: string) => { const v = value(pth); return typeof v === "number" ? v : null; };
    for (const [pth, label] of [["Defense.MaxHealth", "Vida máxima"], ["Economy.BuildTime", "Tempo de construção"]] as const) {
      const v = num(pth);
      if (v !== null && v <= 0) out.push({ level: "err", text: `${label} precisa ser maior que zero.`, section: "attr:defense" });
    }
    for (const w of details?.weapons ?? []) {
      const r = num(`Weapon.${w.index}.MaxRadius`), f = num(`Weapon.${w.index}.RateOfFire`), dmg = num(`Weapon.${w.index}.Damage`);
      if (r !== null && r <= 0 && !w.dummy) out.push({ level: "err", text: `${w.label}: alcance precisa ser maior que zero.`, section: `weapon:${w.index}` });
      if (f !== null && f <= 0 && !w.dummy) out.push({ level: "err", text: `${w.label}: cadência precisa ser maior que zero.`, section: `weapon:${w.index}` });
      if (dmg !== null && dmg < 0) out.push({ level: "err", text: `${w.label}: dano não pode ser negativo.`, section: `weapon:${w.index}` });
      if (dmg !== null && dmg > 100000) out.push({ level: "warn", text: `${w.label}: dano muito alto (${dmg}).`, section: `weapon:${w.index}` });
    }
    const speedV = num("Physics.MaxSpeed");
    if (speedV !== null && speedV > 60) out.push({ level: "warn", text: `Velocidade ${speedV} é muito alta para o jogo.`, section: "attr:physics" });
    if (modelSrc.source === "creation") {
      out.push({ level: "warn", text: "Modelo próprio: as armas e efeitos usam ossos pelo nome. Confira em Aparência se o modelo tem todos.", section: "look" });
    }
    if (!categories.length) out.push({ level: "err", text: "A tropa ficou sem categorias.", section: "cats" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, details, catalog, categories]);

  const save = async () => p.save({ thumb: snapshot.current?.() ?? null });
  const build = async (play: boolean) => {
    const errs = problems.filter((x) => x.level === "err");
    if (errs.length) { setSection("check"); toast("error", errs[0].text); return; }
    await save();
    const r = await run(`unit:${id}`, () => api.unitBuild(id, request()), (x) => `Tropa "${x.manifest.name}" gerada e ligada no perfil.`);
    if (!r) return;
    setResult(r);
    await refreshMods();
    if (play) await run("launch", () => api.launchGame(), "Abrindo o jogo…");
  };

  useHotkeys(active, { "ctrl+s": () => void save(), "ctrl+z": p.undo, "ctrl+y": p.redo, "ctrl+shift+z": p.redo });

  // ------------------------------------------------------------ árvore
  const nodes = useMemo<TreeNode[]>(() => [{
    id: "root", label: doc.name || "Tropa", icon: "smart_toy", color: "#f2b33d", detail: doc.newId,
    children: [
      { id: "general", label: "Geral", icon: "badge" },
      { id: "look", label: "Aparência", icon: "palette", detail: modelSrc.source === "creation" ? "modelo próprio" : undefined },
      { id: "grp:attr", label: "Atributos", icon: "tune", children: ATTRS.map((a) => ({ id: `attr:${a.id}`, label: a.label, icon: a.icon, detail: String(a.fields.filter(([f]) => changed(f)).length || "") })) },
      { id: "grp:weapons", label: "Armas", icon: "gps_fixed", children: (details?.weapons ?? []).map((w) => ({ id: `weapon:${w.index}`, label: String(value(`Weapon.${w.index}.Label`) ?? w.label), icon: w.dummy ? "block" : "gps_fixed", detail: w.dummy ? "efeito" : undefined })) },
      { id: "anims", label: "Animações", icon: "animation", children: animFields.map(([f, file]) => ({ id: `anim:${f}`, label: animLabel(f), icon: "play_circle", detail: file.startsWith("asset:") ? "criada aqui" : doc.animations[f] ? "trocada" : undefined })) },
      { id: "cats", label: "Comportamento", icon: "category", detail: `${categories.length}` },
      { id: "advanced", label: "Todos os campos", icon: "list" },
      { id: "bp", label: "Blueprint (texto)", icon: "description" },
      { id: "check", label: "Validação", icon: problems.some((x) => x.level === "err") ? "error" : "verified", color: problems.some((x) => x.level === "err") ? "#e5534b" : "#7bd88f", detail: problems.length ? String(problems.length) : "ok" },
    ],
  }],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [doc, details, animFields, categories, problems]);

  // ------------------------------------------------------------ propriedades
  const fieldProp = (path: string, label: string): Prop | null => {
    const l = leaves.get(path);
    const v = value(path);
    if (v === null && !l) return null;
    const mark = changed(path) ? " •" : "";
    if (path === "Physics.MotionType") {
      return { kind: "select", label: label + mark, value: String(v ?? ""), onChange: (x) => setValue(path, x), options: Object.entries(MOTION).map(([value, lab]) => ({ value, label: lab })), hint: "Mudar o tipo de movimento pode exigir animações e física compatíveis." };
    }
    if (typeof v === "number") return { kind: "number", label: label + mark, value: v, step: Math.abs(v) < 10 ? 0.1 : 1, onChange: (x) => setValue(path, x), hint: changed(path) ? `Original: ${l?.number ?? "—"}` : undefined };
    if (typeof v === "boolean") return { kind: "toggle", label: label + mark, value: v, onChange: (x) => setValue(path, x) };
    return { kind: "text", label: label + mark, value: String(v ?? ""), onChange: (x) => setValue(path, x) };
  };

  const sections = useMemo(() => {
    const out: { title: string; props: Prop[] }[] = [];
    if (!doc.base) return out;
    if (section === "general") {
      out.push({ title: "Identidade", props: [
        { kind: "text", label: "Nome", value: doc.name, onChange: (v) => p.commit((d) => ({ ...d, name: v.slice(0, 60) })) },
        { kind: "text", label: "Descrição", value: doc.description, multiline: true, onChange: (v) => p.commit((d) => ({ ...d, description: v.slice(0, 300) })) },
        { kind: "text", label: "Id da unidade", value: doc.newId, onChange: (v) => p.commit((d) => ({ ...d, newId: v.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) })), hint: "Nome da pasta no jogo. Precisa ser único." },
      ] });
      out.push({ title: "Base", props: [
        { kind: "select", label: "Unidade base", value: doc.base ?? "", onChange: (v) => p.commit((d) => ({ ...d, base: v })), options: (catalog ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.id})` })), hint: "Atributos, armas e comportamento começam iguais aos dela." },
        { kind: "info", label: "Facção", value: details?.faction ?? "…" },
        { kind: "info", label: "Função", value: details?.role ?? "…" },
        { kind: "info", label: "Alterações", value: `${Object.keys(doc.overrides).length} campo(s)` },
      ] });
      out.push({ title: "Anotações", props: [{ kind: "text", label: "Notas", value: doc.notes, multiline: true, onChange: (v) => p.commit((d) => ({ ...d, notes: v })) }] });
    } else if (section === "look") {
      const a = doc.appearance;
      const setA = (fn: (x: UnitDoc["appearance"]) => UnitDoc["appearance"]) => p.commit((d) => ({ ...d, appearance: fn(d.appearance) }));
      out.push({ title: "Modelo 3D", props: [
        { kind: "select", label: "Modelo", value: a.model.source === "creation" ? a.model.creation : "", onChange: (v) => setA((x) => ({ ...x, model: v ? { source: "creation", creation: v, name: models?.find((m) => m.id === v)?.name ?? v } : { source: "base" } })),
          options: [{ value: "", label: "O da unidade base" }, ...(models ?? []).map((m) => ({ value: m.id, label: `Modelo próprio: ${m.name}` }))], hint: "Modelos próprios precisam ser preparados no editor 3D (Exportar → Preparar para o jogo)." },
        { kind: "number", label: "Escala", value: (typeof doc.overrides["Display.UniformScale"] === "number" ? doc.overrides["Display.UniformScale"] as number : (leaves.get("Display.UniformScale")?.number ?? 1)), step: 0.005, min: 0.001, max: 10, onChange: (v) => setValue("Display.UniformScale", v) },
        ...(a.model.source === "creation" ? [{ kind: "custom", label: "Ossos que a base usa", node: <span className="bone-list">{(details?.bones ?? []).map((b) => <code key={b} className={view?.bones.some((x) => x.name.toLowerCase() === b.toLowerCase()) ? "ok" : "miss"}>{b}</code>)}</span> } as Prop] : []),
      ] });
      out.push({ title: "Textura", props: [
        { kind: "slider", label: "Matiz", value: a.tint.hue, min: -180, max: 180, unit: "°", onChange: (v) => setA((x) => ({ ...x, tint: { ...x.tint, hue: v } })) },
        { kind: "slider", label: "Saturação", value: a.tint.sat, min: -100, max: 100, unit: "%", onChange: (v) => setA((x) => ({ ...x, tint: { ...x.tint, sat: v } })) },
        { kind: "slider", label: "Brilho", value: a.tint.bright, min: -60, max: 60, unit: "%", onChange: (v) => setA((x) => ({ ...x, tint: { ...x.tint, bright: v } })) },
        { kind: "custom", label: "Imagem própria", node: <span className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => imageInput.current?.click()}><Icon name="upload" size={15} /> Importar PNG</button>
          {a.albedoAsset && <button className="btn sm text" onClick={() => setA((x) => ({ ...x, albedoAsset: null }))}><Icon name="close" size={15} /></button>}
        </span>, },
        { kind: "info", label: "Dica", value: "A imagem precisa seguir o mapa UV do modelo do jogo (exporte a textura original no Estúdio → Arquivos do jogo, pinte e importe)." },
      ] });
      out.push({ title: "Prévia", props: [{ kind: "custom", label: "Cor do time", node: <span className="swatches">{TEAM.map((c) => <button key={c} style={{ background: c, outline: teamColor === c ? "2px solid #fff" : undefined }} aria-label={c} onClick={() => setTeamColor(c)} />)}</span> }] });
    } else if (section.startsWith("attr:")) {
      const g = ATTRS.find((a) => `attr:${a.id}` === section);
      if (g) {
        const props = g.fields.map(([f, label]) => fieldProp(f, label)).filter((x): x is Prop => !!x);
        out.push({ title: g.label, props: props.length ? props : [{ kind: "info", label: "", value: "A unidade base não tem estes campos." }] });
        const changedHere = g.fields.filter(([f]) => changed(f));
        if (changedHere.length) out.push({ title: "Alterados", props: [{ kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>{changedHere.map(([f, label]) => <button key={f} className="chip" onClick={() => reset(f)} title="Voltar ao valor original">{label} <Icon name="undo" size={14} /></button>)}</span> }] });
      }
    } else if (section.startsWith("weapon:")) {
      const i = Number(section.split(":")[1]);
      const w = details?.weapons.find((x) => x.index === i);
      const props = WEAPON_FIELDS.map(([f, label]) => fieldProp(`Weapon.${i}.${f}`, label)).filter((x): x is Prop => !!x);
      out.push({ title: w?.label ?? `Arma ${i}`, props });
      const known = new Set(WEAPON_FIELDS.map(([f]) => `Weapon.${i}.${f}`));
      const extra = (details?.leaves ?? []).filter((l) => l.path.startsWith(`Weapon.${i}.`) && !known.has(l.path) && l.kind !== "text").slice(0, 60);
      if (extra.length) out.push({ title: "Mais campos desta arma", props: extra.map((l) => fieldProp(l.path, l.path.slice(`Weapon.${i}.`.length))).filter((x): x is Prop => !!x) });
    } else if (section === "anims" || section.startsWith("anim:")) {
      const field = section.startsWith("anim:") ? section.slice(5) : animField;
      out.push({ title: "Animações", props: [
        { kind: "info", label: "Total", value: `${animFields.length} animações` },
        { kind: "custom", label: "Criar", node: <button className="btn sm" onClick={() => setAnimator(true)}><Icon name="add" size={15} /> Nova animação</button> },
      ] });
      if (field) {
        const cur = animFields.find(([f]) => f === field)?.[1] ?? "";
        const rate = doc.animations[field]?.rate ?? null;
        out.push({ title: animLabel(field), props: [
          { kind: "info", label: "Campo", value: field },
          { kind: "info", label: "Arquivo", value: cur.startsWith("asset:") ? `${cur.slice(6)} (criada aqui)` : cur.split("/").pop() },
          { kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => void playAnim(field, cur)}><Icon name="play_arrow" size={15} /> Ver</button>
            <button className="btn sm" onClick={() => { setAnimPick(field); if (!allAnims) void api.unitAnimations().then(setAllAnims).catch(() => setAllAnims([])); }}><Icon name="swap_horiz" size={15} /> Trocar</button>
            {doc.animations[field] && <button className="btn sm text" onClick={() => p.commit((d) => { const a = { ...d.animations }; delete a[field]; return { ...d, animations: a }; })}><Icon name="undo" size={15} /> Original</button>}
          </span> },
          { kind: "number", label: "Velocidade", value: rate ?? 1, step: 0.1, min: 0.05, max: 10, onChange: (v) => p.commit((d) => ({ ...d, animations: { ...d.animations, [field]: { file: d.animations[field]?.file ?? cur, rate: v } } })) },
        ] });
      }
    } else if (section === "cats") {
      out.push({ title: "Categorias (comportamento no jogo)", props: [
        { kind: "custom", label: "", node: <div className="cat-chips">{categories.map((c) => (
          <button key={c} className="chip" title="Remover" onClick={() => p.commit((d) => ({ ...d, categoriesAdd: d.categoriesAdd.filter((x) => x !== c), categoriesRemove: (details?.categories ?? []).includes(c) ? [...d.categoriesRemove, c] : d.categoriesRemove }))}>{c} <Icon name="close" size={13} /></button>
        ))}</div> },
        { kind: "custom", label: "Adicionar", node: <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const c = newCat.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ""); if (!c) return; p.commit((d) => ({ ...d, categoriesAdd: [...d.categoriesAdd.filter((x) => x !== c), c], categoriesRemove: d.categoriesRemove.filter((x) => x !== c) })); setNewCat(""); }}>
          <input className="pinput" placeholder="EX.: AMPHIBIOUS" value={newCat} onChange={(e) => setNewCat(e.target.value)} /><button className="btn sm"><Icon name="add" size={15} /></button></form> },
        { kind: "info", label: "Dica", value: "Categorias decidem quem constrói a tropa (fábrica), alvos das armas e como a IA a usa. Mantenha as de facção e de fábrica da base." },
      ] });
    } else if (section === "advanced") {
      const f = advFilter.trim().toLowerCase();
      const list = (details?.leaves ?? []).filter((l: BpLeaf) => l.kind !== "text" || l.path.endsWith("Label")).filter((l) => !f || l.path.toLowerCase().includes(f)).slice(0, 150);
      out.push({ title: "Todos os campos do blueprint", props: [
        { kind: "custom", label: "Filtrar", node: <input className="pinput" placeholder="ex.: Weapon.1, Speed, Radius" value={advFilter} onChange={(e) => setAdvFilter(e.target.value)} /> },
        ...list.map((l) => fieldProp(l.path, l.path)).filter((x): x is Prop => !!x),
      ] });
    } else if (section === "bp") {
      out.push({ title: "Blueprint gerado", props: [
        { kind: "custom", label: "", node: <button className="btn sm" onClick={async () => { try { setBpText(await api.unitBlueprintPreview(request())); } catch (e) { toast("error", errorText(e)); } }}><Icon name="visibility" size={15} /> Ver o texto final</button> },
        { kind: "info", label: "", value: "O blueprint da base com as suas alterações. O resto (comentários, ordem) fica como no original." },
      ] });
    } else if (section === "check") {
      out.push({ title: "Validação", props: problems.length ? problems.map((x) => ({ kind: "custom", label: x.level === "err" ? "Erro" : "Aviso", node: <button className={`check-item ${x.level}`} onClick={() => setSection(x.section)}>{x.text}</button> } as Prop)) : [{ kind: "info", label: "", value: "Tudo certo para gerar." }] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, doc, details, leaves, catalog, models, animFields, animField, allAnims, categories, problems, newCat, advFilter, view, teamColor]);

  if (p.status === "loading") return <div className="studio-root"><div className="bar indeterminate" style={{ margin: 30 }}><i /></div></div>;
  if (p.status === "error") return <div className="studio-root"><Empty icon="error" title="Não deu para abrir o projeto">{p.error}</Empty></div>;

  return (
    <div className="studio-root">
      <div className="studio-top">
        <Ribbon active={ribbon} onTab={setRibbon} tabs={[{ id: "home", label: "Início" }, { id: "look", label: "Aparência" }, { id: "test", label: "Testar e gerar" }]}>
          {ribbon === "home" && <>
            <RibbonGroup label="Editar">
              <RibbonButton icon="badge" label="Geral" active={section === "general"} onClick={() => setSection("general")} />
              <RibbonButton icon="shield" label="Defesa" active={section === "attr:defense"} onClick={() => setSection("attr:defense")} />
              <RibbonButton icon="payments" label="Custo" active={section === "attr:economy"} onClick={() => setSection("attr:economy")} />
              <RibbonButton icon="speed" label="Movimento" active={section === "attr:physics"} onClick={() => setSection("attr:physics")} />
              <RibbonButton icon="gps_fixed" label="Armas" active={section.startsWith("weapon:")} onClick={() => setSection(details?.weapons[0] ? `weapon:${details.weapons[0].index}` : "general")} />
              <RibbonButton icon="animation" label="Animações" active={section === "anims" || section.startsWith("anim:")} onClick={() => setSection("anims")} />
              <RibbonButton icon="category" label="Comportamento" active={section === "cats"} onClick={() => setSection("cats")} />
            </RibbonGroup>
            <RibbonGroup label="Gerar">
              <RibbonButton icon="fact_check" label="Validar" onClick={() => setSection("check")} color={problems.some((x) => x.level === "err") ? "#e5534b" : "#7bd88f"} />
              <RibbonButton icon="rocket_launch" label={busy ? "Gerando…" : "Gerar tropa"} onClick={() => void build(false)} disabled={busy || !doc.base} color="#a3e635" />
            </RibbonGroup>
          </>}
          {ribbon === "look" && <>
            <RibbonGroup label="Modelo">
              <RibbonButton icon="palette" label="Aparência" active={section === "look"} onClick={() => setSection("look")} />
              <RibbonButton icon="view_in_ar" label="Novo modelo 3D" onClick={async () => {
                const m = await run("newmodel", () => api.creationCreate("model", `${doc.name} (modelo)`, { schema: 1, parts: [], groups: [], gridSize: 1, notes: "" }));
                if (m) { useTabs.getState().open(m); toast("info", "Modele, prepare para o jogo e escolha o modelo em Aparência."); }
              }} />
              <RibbonButton icon="upload" label="Textura PNG" onClick={() => imageInput.current?.click()} />
            </RibbonGroup>
            <RibbonGroup label="Cor do time (prévia)">
              <span className="swatches big">{TEAM.map((c) => <button key={c} style={{ background: c, outline: teamColor === c ? "2px solid #fff" : undefined }} aria-label={c} onClick={() => setTeamColor(c)} />)}</span>
            </RibbonGroup>
          </>}
          {ribbon === "test" && <>
            <RibbonGroup label="Prévia">
              <RibbonButton icon={playing ? "pause" : "play_arrow"} label={playing ? "Pausar" : "Tocar"} onClick={() => setPlaying((v) => !v)} disabled={!anim} />
              <div className="ribbon-stack" style={{ width: 170 }}>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 34px" }}><span>Velocidade</span><input type="range" min={0.1} max={3} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><output>{speed}×</output></label>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Gerar">
              <RibbonButton icon="description" label="Ver blueprint" onClick={async () => { try { setBpText(await api.unitBlueprintPreview(request())); } catch (e) { toast("error", errorText(e)); } }} />
              <RibbonButton icon="rocket_launch" label={busy ? "Gerando…" : "Gerar tropa"} onClick={() => void build(false)} disabled={busy || !doc.base} color="#a3e635" />
              <RibbonButton icon="play_circle" label="Gerar e jogar" onClick={() => void build(true)} disabled={busy || !doc.base} color="#a3e635" />
            </RibbonGroup>
          </>}
        </Ribbon>
        <ProjectBar p={p} onSave={() => void save()} />
      </div>
      <StudioLayout id="unit"
        left={<Panel title="Explorador da tropa" icon="account_tree" grow collapsible={false} id="unit-explorer">
          <Tree nodes={nodes} selected={new Set([section])} onSelect={(nid) => {
            if (nid === "root" || nid.startsWith("grp:")) return;
            setSection(nid as Section);
            if (nid.startsWith("anim:")) { const f = nid.slice(5); const file = animFields.find(([x]) => x === f)?.[1]; if (file) void playAnim(f, file); }
          }} />
        </Panel>}
        center={
          <div className="viewport">
            {!doc.base ? <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Empty icon="smart_toy" title="Escolha a unidade base">Em Geral → Base.</Empty></div> : (
              <UnitViewport model={view} tint={doc.appearance.tint} albedoOverride={albedoUrl} teamColor={teamColor} anim={anim} playing={playing} speed={speed} snapshotRef={snapshot} />
            )}
            <div className="viewport-overlay">
              <span className="vp-chip"><Icon name="smart_toy" size={15} /> {doc.name} <small className="faint">({doc.newId || "sem id"})</small></span>
              {details && <span className="vp-chip"><span className={`fac fac-${details.faction.toLowerCase()}`}>{details.faction.slice(0, 1)}</span> baseada em {details.name}</span>}
              {anim && animField && <span className="vp-chip"><Icon name="animation" size={15} /> {animLabel(animField)} <button aria-label="Parar" onClick={() => { setAnim(null); setAnimField(null); }}><Icon name="stop" size={15} /></button></span>}
            </div>
            {details === undefined && doc.base && <div className="vp-hint">Lendo a unidade do jogo…</div>}
            {view === null && details && <div className="vp-hint">{modelSrc.source === "creation" ? "Prepare o modelo próprio para o jogo para vê-lo aqui." : "Sem prévia 3D para esta unidade."}</div>}
          </div>
        }
        right={<Panel title="Propriedades" icon="tune" grow collapsible={false} id="unit-props">
          {details === null ? <div className="pgrid-empty">Não deu para ler a unidade base.</div> : <PropertyGrid sections={sections} />}
        </Panel>}
      />
      <StatusBar>
        <span><b>{Object.keys(doc.overrides).length}</b> campos alterados · <b>{Object.keys(doc.animations).length}</b> animações trocadas · <b>{categories.length}</b> categorias</span>
        <span className="grow" />
        <span style={{ color: "var(--warn)" }}>Experimental: confirme no jogo se a tropa aparece na fábrica.</span>
      </StatusBar>

      <input ref={imageInput} type="file" accept="image/png" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });
        const name = await api.creationAssetPut(id, f.name, data);
        p.commit((d) => ({ ...d, appearance: { ...d.appearance, albedoAsset: name } }));
        setSection("look");
      }} />

      {animPick && (
        <AnimPicker all={allAnims} base={doc.base ?? ""} onClose={() => setAnimPick(null)} onPick={(file) => {
          p.commit((d) => ({ ...d, animations: { ...d.animations, [animPick]: { file, rate: d.animations[animPick]?.rate ?? null } } }));
          void playAnim(animPick, file);
          setAnimPick(null);
        }} onPreview={(file) => void playAnim(animPick, file)} />
      )}
      {animator && doc.base && (
        <Animator creation={id} source={modelSrc.source === "creation" ? { model: modelSrc.creation } : { unit: doc.base }} bones={view?.bones.map((b) => b.name) ?? []}
          fields={animFields.map(([f]) => f)} onClose={() => setAnimator(false)}
          onSaved={(asset, field) => {
            p.commit((d) => ({ ...d, animations: { ...d.animations, [field]: { file: `asset:${asset}`, rate: null } } }));
            setAnimator(false);
            setSection(`anim:${field}`);
            toast("ok", `Animação "${asset}" criada e usada em ${animLabel(field)}.`);
          }} />
      )}
      {bpText !== null && (
        <Modal title="Blueprint da tropa" icon="description" onClose={() => setBpText(null)} wide>
          <pre className="code-view">{bpText}</pre>
        </Modal>
      )}
      {result && (
        <Modal title="Tropa gerada" icon="rocket_launch" onClose={() => setResult(null)}>
          <div className="col" style={{ gap: 10 }}>
            <Notice kind={result.report.warnings.length ? "warn" : "ok"}>
              <b>{result.manifest.name}</b> foi para a biblioteca e está ligada no perfil ativo ({result.report.files} arquivos).
              {result.report.warnings.length > 0 && <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </Notice>
            <p className="muted small">Tropas novas são <b>experimentais</b>: abra uma escaramuça e procure a unidade na fábrica da mesma facção da base. Se não aparecer ou o jogo reclamar, desligue o mod na biblioteca e relate o que aconteceu nas issues do projeto no GitHub.</p>
            <footer><button className="btn primary" onClick={() => setResult(null)}>Fechar</button></footer>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AnimPicker({ all, base, onClose, onPick, onPreview }: { all: string[] | null; base: string; onClose: () => void; onPick: (f: string) => void; onPreview: (f: string) => void }) {
  const [q, setQ] = useState(base);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (all ?? []).filter((a) => !t || a.includes(t)).slice(0, 300);
  }, [all, q]);
  return (
    <Modal title="Trocar animação" icon="animation" onClose={onClose} wide>
      <div className="col" style={{ gap: 10 }}>
        <div className="search-bar"><Icon name="search" /><input className="input dense" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar: uul0101, walk, death…" /></div>
        <p className="faint small">Animações de qualquer unidade do jogo. Funcionam melhor entre unidades com os mesmos ossos (mesma família de modelo).</p>
        <div className="anim-list">
          {all === null ? <div className="bar indeterminate"><i /></div> : list.map((a) => (
            <div key={a} className="anim-row">
              <Icon name="animation" size={18} />
              <span className="grow mono small">{a}</span>
              <button className="btn sm text" onClick={() => onPreview(a)}><Icon name="play_arrow" size={16} /></button>
              <button className="btn sm" onClick={() => onPick(a)}>Usar</button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Animação nova por quadros-chave: escolha o osso, o instante e a rotação/posição. */
function Animator({ creation, source, bones, fields, onClose, onSaved }: {
  creation: string; source: { unit?: string; model?: string }; bones: string[]; fields: string[];
  onClose: () => void; onSaved: (asset: string, field: string) => void;
}) {
  const [name, setName] = useState("minha_animacao");
  const [duration, setDuration] = useState(1.5);
  const [field, setField] = useState(fields[0] ?? "Display.AnimationIdle");
  const [keys, setKeys] = useState<AnimKey[]>(() => {
    const b = bones.find((x) => /turret/i.test(x)) ?? bones[1] ?? bones[0] ?? "Root";
    return [{ bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 0.75, pos: [0, 0, 0], rot: [0, 45, 0] }, { bone: b, time: 1.5, pos: [0, 0, 0], rot: [0, 0, 0] }];
  });
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const setKey = (i: number, k: Partial<AnimKey>) => setKeys((ks) => ks.map((x, j) => (j === i ? { ...x, ...k } : x)));
  const num = (v: string) => Number(v.replace(",", ".")) || 0;
  return (
    <Modal title="Nova animação" icon="animation" onClose={onClose} wide>
      <div className="col" style={{ gap: 12 }}>
        <p className="muted small">Cada linha é um quadro-chave: no instante indicado o osso fica com essa rotação (graus) e deslocamento. Entre um quadro e outro o movimento é suave. Ossos sem quadros ficam parados.</p>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <label className="field" style={{ flex: 1, minWidth: 180 }}><span className="label">Nome</span><input className="input" value={name} onChange={(e) => setName(e.target.value.replace(/[^\w-]/g, "_"))} /></label>
          <label className="field" style={{ width: 140 }}><span className="label">Duração (s)</span><input className="input" type="number" step={0.1} min={0.1} max={60} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 1)} /></label>
          <label className="field" style={{ flex: 1, minWidth: 200 }}><span className="label">Usar como</span>
            <select className="select" value={field} onChange={(e) => setField(e.target.value)}>
              {[...new Set([...fields, "Display.AnimationIdle", "Display.AnimationWalk", "Display.AnimationDeath", "Display.AnimationActivate"])].map((f) => <option key={f} value={f}>{animLabel(f)} ({f.split(".").pop()})</option>)}
            </select></label>
        </div>
        <div className="key-table">
          <div className="key-head"><span>Osso</span><span>Tempo (s)</span><span>Girar X/Y/Z (°)</span><span>Mover X/Y/Z</span><span /></div>
          {keys.map((k, i) => (
            <div key={i} className="key-row">
              <select className="pinput" value={k.bone} onChange={(e) => setKey(i, { bone: e.target.value })}>{(bones.length ? bones : ["Root"]).map((b) => <option key={b}>{b}</option>)}</select>
              <input className="pinput" value={k.time} onChange={(e) => setKey(i, { time: Math.max(0, Math.min(duration, num(e.target.value))) })} />
              <span className="vec3">{[0, 1, 2].map((a) => <input key={a} className="pinput" value={k.rot[a]} onChange={(e) => { const r = [...k.rot] as [number, number, number]; r[a] = num(e.target.value); setKey(i, { rot: r }); }} />)}</span>
              <span className="vec3">{[0, 1, 2].map((a) => <input key={a} className="pinput" value={k.pos[a]} onChange={(e) => { const r = [...k.pos] as [number, number, number]; r[a] = num(e.target.value); setKey(i, { pos: r }); }} />)}</span>
              <button className="btn icon-btn sm" aria-label="Remover quadro" onClick={() => setKeys((ks) => ks.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setKeys((ks) => [...ks, { ...(ks[ks.length - 1] ?? { bone: bones[0] ?? "Root", pos: [0, 0, 0], rot: [0, 0, 0] }), time: Math.min(duration, (ks[ks.length - 1]?.time ?? 0) + 0.5) }])}><Icon name="add" size={16} /> Quadro-chave</button>
        </div>
        <footer>
          <button className="btn text" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !keys.length || !name.trim()} onClick={async () => {
            setBusy(true);
            try { const asset = await api.animCreate(creation, name, source, keys, duration); onSaved(asset, field); }
            catch (e) { toast("error", errorText(e)); }
            finally { setBusy(false); }
          }}><Icon name="save" size={17} /> {busy ? "Criando…" : "Criar animação"}</button>
        </footer>
      </div>
    </Modal>
  );
}
