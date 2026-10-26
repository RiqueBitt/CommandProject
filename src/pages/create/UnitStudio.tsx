// Editor de tropas em aba própria: parte de uma unidade do jogo e separa aparência, atributos,
// armas, animações e comportamento (categorias). Mudar a aparência não apaga o resto.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Panel, ProjectBar, PropertyGrid, Ribbon, RibbonButton, RibbonGroup, StatusBar, StudioLayout, Tree,
  useActiveEditor, useHotkeys, type Prop, type TreeNode,
} from "../../components/studio/kit";
import { Empty, Icon, Modal, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { locale, t, tr } from "../../lib/i18n";
import { errorText, useStore } from "../../lib/store";
import { useTabs } from "../../lib/tabs";
import type { AnimKey, BpLeaf, CreationMeta, Finding, MixCheck, MixSpec, ScaAnimation, UnitBuildReq, UnitBuildResult, UnitDetails, UnitInfo, UnitPack } from "../../lib/types";
import { useProject } from "../../lib/useProject";
import { ANIM_TEMPLATES, animFromKeys, sampleKey } from "./animKeys";
import { migrateUnit, newUnitDoc, type UnitDoc } from "./docs";
import IconStudio from "./IconStudio";
import TextureLab from "./TextureLab";
import UnitViewport, { viewFromBaked, viewFromPreview, type ViewModel } from "./UnitViewport";

type Section = "general" | "look" | "mix" | "texture" | "balance" | `attr:${string}` | `weapon:${number}` | "weapons" | "anims" | `anim:${string}` | "cats" | "advanced" | "bp" | "check";

const ATTRS: { id: string; label: string; icon: string; fields: [string, string][] }[] = [
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
const PAINT = ["#2b2f33", "#6b7178", "#c9cdd2", "#8a6a3c", "#4d6b3a", "#7a2f2a", "#2c4f7a", "#d9a227"];
const ANIM_LABEL: Record<string, string> = { AnimationWalk: "Andar", AnimationIdle: "Parado", AnimationDeath: "Morte", AnimationActivate: "Ativar", AnimationOpen: "Abrir", AnimationBuild: "Construir", AnimationTakeOff: "Decolar", AnimationLand: "Pousar", AnimationTransform: "Transformar", AnimationUpgrade: "Melhorar", AnimationFire: "Disparar", AnimationReload: "Recarregar" };
const animLabel = (field: string) => { const k = field.split(".").pop() ?? field; return ANIM_LABEL[k] ? t(ANIM_LABEL[k]) : k.replace(/^Animation/, ""); };

/** modelos de função: multiplicadores sobre os valores da base ("Weapon.*" = todas as armas) */
const ROLE_PRESETS: { id: string; label: string; icon: string; desc: string; mul: Record<string, number>; air?: boolean }[] = [
  { id: "heavy", label: "Tanque pesado", icon: "shield", desc: "Muita vida, lento e caro.", mul: { "Defense.MaxHealth": 1.8, "Defense.Health": 1.8, "Physics.MaxSpeed": 0.75, "Economy.BuildCostMass": 1.6, "Economy.BuildCostEnergy": 1.6, "Economy.BuildTime": 1.5, "Weapon.*.Damage": 1.3 } },
  { id: "artillery", label: "Artilharia", icon: "track_changes", desc: "Alcance longo, tiro forte e lento, frágil.", mul: { "Weapon.*.MaxRadius": 1.6, "Weapon.*.Damage": 1.5, "Weapon.*.RateOfFire": 0.6, "Defense.MaxHealth": 0.7, "Defense.Health": 0.7, "Physics.MaxSpeed": 0.85 } },
  { id: "scout", label: "Batedor", icon: "visibility", desc: "Rápido, enxerga longe, barato e fraco.", mul: { "Physics.MaxSpeed": 1.6, "Defense.MaxHealth": 0.6, "Defense.Health": 0.6, "Intel.VisionRadius": 1.5, "Economy.BuildCostMass": 0.6, "Economy.BuildCostEnergy": 0.6, "Economy.BuildTime": 0.6, "Weapon.*.Damage": 0.6 } },
  { id: "swarm", label: "Barata em massa", icon: "groups", desc: "Metade do custo e do tempo, menos vida.", mul: { "Economy.BuildCostMass": 0.5, "Economy.BuildCostEnergy": 0.5, "Economy.BuildTime": 0.5, "Defense.MaxHealth": 0.55, "Defense.Health": 0.55, "Weapon.*.Damage": 0.6 } },
  { id: "sniper", label: "Atirador de longe", icon: "gps_fixed", desc: "Dano alto e alcance maior, atira devagar.", mul: { "Weapon.*.MaxRadius": 1.4, "Weapon.*.Damage": 1.8, "Weapon.*.RateOfFire": 0.5, "Physics.MaxSpeed": 0.9 } },
  { id: "fast-air", label: "Aérea rápida", icon: "flight", desc: "Mais veloz no ar, um pouco mais frágil.", air: true, mul: { "Air.MaxAirspeed": 1.4, "Physics.MaxSpeed": 1.4, "Defense.MaxHealth": 0.8, "Defense.Health": 0.8 } },
  { id: "elite", label: "Elite", icon: "military_tech", desc: "Tudo +40%, custa bem mais.", mul: { "Defense.MaxHealth": 1.4, "Defense.Health": 1.4, "Weapon.*.Damage": 1.4, "Economy.BuildCostMass": 1.6, "Economy.BuildCostEnergy": 1.6, "Economy.BuildTime": 1.4 } },
];

interface Stats { hp: number; mass: number; energy: number; time: number; speed: number; vision: number; dps: number; range: number; hpPerMass: number; dpsPerMass: number; eff: number }
function statsOf(get: (p: string) => number | null, weapons: { index: number; dummy: boolean }[]): Stats {
  const n = (p: string) => get(p) ?? 0;
  let dps = 0, range = 0;
  for (const w of weapons) {
    if (w.dummy) continue;
    const salvo = Math.max(1, get(`Weapon.${w.index}.MuzzleSalvoSize`) ?? 1);
    dps += n(`Weapon.${w.index}.Damage`) * n(`Weapon.${w.index}.RateOfFire`) * salvo;
    range = Math.max(range, n(`Weapon.${w.index}.MaxRadius`));
  }
  const hp = n("Defense.MaxHealth"), mass = n("Economy.BuildCostMass"), energy = n("Economy.BuildCostEnergy");
  const cost = mass + energy / 10;
  return {
    hp, mass, energy, time: n("Economy.BuildTime"), speed: get("Physics.MaxSpeed") ?? n("Air.MaxAirspeed"), vision: n("Intel.VisionRadius"), dps, range,
    hpPerMass: mass ? hp / mass : 0, dpsPerMass: mass ? dps / mass : 0, eff: cost ? Math.sqrt(Math.max(0, hp) * Math.max(0, dps)) / cost : 0,
  };
}
const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString(locale()) : (Math.round(v * 100) / 100).toLocaleString(locale()));
const isPath = (t: string) => /^\/[\w/.-]+\.(bp|sca|scm|dds|lua)$/i.test(t.trim());

interface AnimDraft { index: number | null; name: string; field: string; duration: number; keys: AnimKey[] }

export default function UnitStudio({ id }: { id: string }) {
  const p = useProject<UnitDoc>(id, migrateUnit, newUnitDoc());
  const active = useActiveEditor();
  const doc = p.doc;
  const { toast, run, refreshMods } = useStore.getState();
  const [ribbon, setRibbon] = useState("home");
  const [section, setSection] = useState<Section>("general");
  const [details, setDetails] = useState<UnitDetails | null | undefined>(undefined);
  const [others, setOthers] = useState<Record<string, UnitDetails>>({});
  const [catalog, setCatalog] = useState<UnitInfo[] | null>(null);
  const [view, setView] = useState<ViewModel | null>(null);
  const [models, setModels] = useState<CreationMeta[] | null>(null);
  const [packs, setPacks] = useState<UnitPack[]>([]);
  const [anim, setAnim] = useState<ScaAnimation | null>(null);
  const [animField, setAnimField] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [teamColor, setTeamColor] = useState(TEAM[0]);
  const [allAnims, setAllAnims] = useState<string[] | null>(null);
  const [animPick, setAnimPick] = useState<string | null>(null);
  const [draft, setDraft] = useState<AnimDraft | null>(null);
  const [bpText, setBpText] = useState<string | null>(null);
  const [result, setResult] = useState<UnitBuildResult | null>(null);
  const [albedoUrl, setAlbedoUrl] = useState<string | null>(null);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [newCat, setNewCat] = useState("");
  const [advFilter, setAdvFilter] = useState("");
  const [weaponPick, setWeaponPick] = useState<number | null>(null); // posição alvo (0 = nova)
  const [compareWith, setCompareWith] = useState<string>("");
  const [paint, setPaint] = useState({ on: false, color: PAINT[0], size: 6, opacity: 0.8 });
  const [missing, setMissing] = useState<string[]>([]);
  const [newPack, setNewPack] = useState("");
  const [scrub, setScrub] = useState(0);
  const [mixChecks, setMixChecks] = useState<MixCheck[] | null>(null);
  const [texPreview, setTexPreview] = useState<string | null>(null);
  const [iconLab, setIconLab] = useState(false);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [checking, setChecking] = useState(false);
  const snapshot = useRef<(() => string | null) | null>(null);
  const iconShot = useRef<(() => string | null) | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const busy = useStore((s) => s.busy[`unit:${id}`]);
  const animBusy = useStore((s) => s.busy[`anim:${id}`]);

  // ------------------------------------------------------------ dados
  useEffect(() => {
    void api.unitCatalog().then(setCatalog).catch(() => setCatalog([]));
    void api.creations().then((l) => setModels(l.filter((m) => m.kind === "model"))).catch(() => setModels([]));
    void api.unitPacks().then(setPacks).catch(() => setPacks([]));
  }, []);
  useEffect(() => {
    if (p.status !== "ready" || !doc.base) return;
    setDetails(undefined);
    void api.unitDetails(doc.base).then(setDetails).catch((e) => { setDetails(null); toast("error", errorText(e)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.base, p.status]);
  // unidades de onde vieram armas copiadas (e a de comparação)
  const wantOthers = useMemo(() => [...new Set([...(doc.weaponCopies ?? []).map((c) => c[1]), compareWith].filter(Boolean))], [doc.weaponCopies, compareWith]);
  useEffect(() => {
    for (const u of wantOthers) if (!others[u]) void api.unitDetails(u).then((d) => setOthers((o) => ({ ...o, [u]: d }))).catch(() => {});
  }, [wantOthers, others]);
  const modelSrc = doc.appearance.model;
  // misturador ativo: chassi = base, torre/arma de outras tropas (só com o modelo da base)
  const mix: MixSpec | null = modelSrc.source === "base" && doc.base && doc.mix && (doc.mix.turret || doc.mix.weapon) ? { ...doc.mix, chassis: doc.base } : null;
  const mixKey = mix ? JSON.stringify(mix) : "";
  useEffect(() => {
    if (p.status !== "ready" || !doc.base) return;
    let alive = true;
    setView(null);
    setMixChecks(null);
    const t = window.setTimeout(() => {
      const req = modelSrc.source === "creation"
        ? api.modelBaked(modelSrc.creation).then((b) => (b ? viewFromBaked(b) : null))
        : mix
          ? api.unitMixPreview(doc.base!, mix).then((m) => { if (alive) setMixChecks(m.checks); return viewFromPreview(m); })
          : api.unitPreview(doc.base!).then(viewFromPreview);
      void req.then((v) => alive && setView(v)).catch((e) => {
        if (!alive) return;
        setView(null);
        if (mix) setMixChecks([{ level: "err", text: errorText(e) }]);
      });
    }, mix ? 350 : 0);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.base, p.status, modelSrc.source, modelSrc.source === "creation" ? modelSrc.creation : "", mixKey]);
  useEffect(() => {
    if (!doc.appearance.albedoAsset) { setAlbedoUrl(null); return; }
    void api.creationAsset(id, doc.appearance.albedoAsset).then(setAlbedoUrl).catch(() => setAlbedoUrl(null));
  }, [id, doc.appearance.albedoAsset]);
  useEffect(() => {
    if (!doc.appearance.iconAsset) { setIconUrl(null); return; }
    void api.creationAsset(id, doc.appearance.iconAsset).then(setIconUrl).catch(() => setIconUrl(null));
  }, [id, doc.appearance.iconAsset]);

  // ------------------------------------------------------------ armas (da base + copiadas)
  const copies = useMemo(() => doc.weaponCopies ?? [], [doc.weaponCopies]);
  const weapons = useMemo(() => {
    const base = (details?.weapons ?? []).map((w) => ({ ...w, from: null as string | null }));
    for (const [tg, u, s] of copies) {
      const ow = others[u]?.weapons.find((w) => w.index === s);
      const label = ow?.label ?? t("Arma {n} de {unit}", { n: s, unit: u });
      if (tg > 0) { const i = base.findIndex((w) => w.index === tg); if (i >= 0) base[i] = { index: tg, label, dummy: ow?.dummy ?? false, from: u }; }
      else base.push({ index: base.length + 1, label, dummy: ow?.dummy ?? false, from: u });
    }
    return base;
  }, [details, copies, others]);
  const leaves = useMemo(() => {
    const m = new Map((details?.leaves ?? []).map((l) => [l.path, l]));
    let appended = details?.weapons.length ?? 0;
    for (const [t, u, s] of copies) {
      const od = others[u];
      const target = t > 0 ? t : ++appended;
      if (t > 0) for (const k of [...m.keys()]) if (k.startsWith(`Weapon.${t}.`)) m.delete(k);
      if (!od) continue;
      for (const l of od.leaves) if (l.path.startsWith(`Weapon.${s}.`)) {
        const path = `Weapon.${target}.${l.path.slice(`Weapon.${s}.`.length)}`;
        m.set(path, { ...l, path });
      }
    }
    return m;
  }, [details, copies, others]);
  const baseLeaves = useMemo(() => new Map((details?.leaves ?? []).map((l) => [l.path, l])), [details]);
  const leafValue = (l: BpLeaf | undefined) => (l ? (l.kind === "number" ? l.number : l.kind === "bool" ? l.flag : l.text) : null);
  const value = (path: string): number | string | boolean | null => (path in doc.overrides ? doc.overrides[path] : leafValue(leaves.get(path)));
  const num = (path: string) => { const v = value(path); return typeof v === "number" ? v : null; };
  const changed = (path: string) => path in doc.overrides;
  const setValue = (path: string, v: number | string | boolean) => p.commit((d) => {
    const orig = leafValue(leaves.get(path)) ?? undefined;
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
  const allCats = useMemo(() => [...new Set((catalog ?? []).flatMap((u) => u.categories ?? []))].sort(), [catalog]);

  // animações: as do blueprint, com as trocas do projeto
  const animFields = useMemo(() => {
    const m = new Map<string, string>((details?.animations ?? []).map(([f, path]) => [f, path]));
    for (const [f, a] of Object.entries(doc.animations)) m.set(f, a.file);
    return [...m.entries()];
  }, [details, doc.animations]);

  const playAnim = async (field: string, file: string) => {
    setAnimField(field);
    if (file.startsWith("asset:")) {
      const c = (doc.customAnims ?? []).find((x) => `asset:${x.asset}` === file);
      if (c && view) { setAnim(animFromKeys(view, c.keys, c.duration)); setPlaying(true); }
      else toast("info", t("Esta animação foi criada antes do editor guardar os quadros: gere a tropa para vê-la no jogo."));
      return;
    }
    try { setAnim(await api.animRead(file)); setPlaying(true); } catch (e) { setAnim(null); toast("error", t("Não deu para ler a animação: {error}", { error: errorText(e) })); }
  };

  // prévia ao vivo da animação em edição
  const draftAnim = useMemo(() => (draft && view ? animFromKeys(view, draft.keys, draft.duration) : null), [draft, view]);
  const shownAnim = draft ? draftAnim : anim;

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
    weaponCopies: copies, iconAsset: doc.appearance.iconAsset ?? null, boneMap: doc.appearance.boneMap ?? {}, pack: doc.pack ?? null,
    mix,
  });

  // arquivos citados (projéteis, animações…) que não existem no jogo
  useEffect(() => {
    if (!details || !doc.base) return;
    // pasta da base: /units/<facção>/<id>/ no jogo (ou /units/<id>/ em mods)
    const inBase = (v: string) => new RegExp(`^/units/(?:[^/]+/)?${doc.base}/`, "i").test(v);
    const paths = new Set<string>();
    for (const [path, l] of leaves) {
      const v = path in doc.overrides ? doc.overrides[path] : l.text;
      if (typeof v === "string" && isPath(v) && !inBase(v)) paths.add(v);
    }
    for (const [k, v] of Object.entries(doc.overrides)) if (typeof v === "string" && isPath(v) && !leaves.has(k)) paths.add(v);
    for (const a of Object.values(doc.animations)) if (!a.file.startsWith("asset:")) paths.add(a.file);
    const t = window.setTimeout(() => { void api.unitRefsCheck([...paths]).then(setMissing).catch(() => setMissing([])); }, 400);
    return () => window.clearTimeout(t);
  }, [details, leaves, doc.overrides, doc.animations, doc.base]);

  const problems = useMemo(() => {
    const out: { level: "err" | "warn"; text: string; section: Section }[] = [];
    if (!doc.base) out.push({ level: "err", text: t("Escolha a unidade base."), section: "general" });
    if (!/^[a-z][a-z0-9_]{3,15}$/.test(doc.newId)) out.push({ level: "err", text: t("O id precisa ter 4 a 16 letras minúsculas, números ou _, começando por letra."), section: "general" });
    if (catalog?.some((u) => u.id === doc.newId)) out.push({ level: "err", text: t("Já existe a unidade {id} no jogo: troque o id.", { id: doc.newId }), section: "general" });
    if (!doc.name.trim()) out.push({ level: "err", text: t("Dê um nome para a tropa."), section: "general" });
    for (const [pth, label] of [["Defense.MaxHealth", "Vida máxima"], ["Economy.BuildTime", "Tempo de construção"]] as const) {
      const v = num(pth);
      if (v !== null && v <= 0) out.push({ level: "err", text: t("{label} precisa ser maior que zero.", { label: t(label) }), section: "attr:defense" });
    }
    for (const w of weapons) {
      const r = num(`Weapon.${w.index}.MaxRadius`), f = num(`Weapon.${w.index}.RateOfFire`), dmg = num(`Weapon.${w.index}.Damage`);
      if (r !== null && r <= 0 && !w.dummy) out.push({ level: "err", text: t("{weapon}: alcance precisa ser maior que zero.", { weapon: w.label }), section: `weapon:${w.index}` });
      if (f !== null && f <= 0 && !w.dummy) out.push({ level: "err", text: t("{weapon}: cadência precisa ser maior que zero.", { weapon: w.label }), section: `weapon:${w.index}` });
      if (dmg !== null && dmg < 0) out.push({ level: "err", text: t("{weapon}: dano não pode ser negativo.", { weapon: w.label }), section: `weapon:${w.index}` });
      if (dmg !== null && dmg > 100000) out.push({ level: "warn", text: t("{weapon}: dano muito alto ({n}).", { weapon: w.label, n: dmg }), section: `weapon:${w.index}` });
      if (w.from) out.push({ level: "warn", text: t("{weapon} veio de {unit}: confira no jogo se os pontos de disparo existem nesta tropa.", { weapon: w.label, unit: w.from }), section: `weapon:${w.index}` });
    }
    const speedV = num("Physics.MaxSpeed");
    if (speedV !== null && speedV > 60) out.push({ level: "warn", text: t("Velocidade {n} é muito alta para o jogo.", { n: speedV }), section: "attr:physics" });
    if (modelSrc.source === "creation" && view && details) {
      const have = new Set(view.bones.map((b) => b.name.toLowerCase()));
      const map = doc.appearance.boneMap ?? {};
      const miss = details.bones.filter((b) => !have.has(b.toLowerCase()) && !map[b]);
      if (miss.length) out.push({ level: "warn", text: t("O modelo próprio não tem {n} osso(s) que as armas usam ({bones}). Ligue no assistente de ossos.", { n: miss.length, bones: `${miss.slice(0, 4).join(", ")}${miss.length > 4 ? "…" : ""}` }), section: "look" });
    }
    for (const m of missing) out.push({ level: "err", text: t("Arquivo citado não existe no jogo: {file}", { file: m }), section: "advanced" });
    const tv = doc.texgen?.versions.find((v) => v.asset === doc.appearance.albedoAsset);
    if (tv && tv.modelKey !== `${doc.base}|${modelSrc.source === "creation" ? modelSrc.creation : ""}|${mixKey}`) out.push({ level: "warn", text: t("A textura gerada foi feita para outro modelo: gere e aplique de novo."), section: "texture" });
    if (mix && mixChecks === null) out.push({ level: "warn", text: t("A mistura ainda está sendo montada."), section: "mix" });
    for (const c of mixChecks ?? []) if (c.level === "err" || c.level === "warn") out.push({ level: c.level, text: t("Mistura: {text}", { text: tr(c.text) }), section: "mix" });
    if (!categories.length) out.push({ level: "err", text: t("A tropa ficou sem categorias."), section: "cats" });
    if (!categories.some((c) => c.toUpperCase().startsWith("BUILTBY"))) out.push({ level: "warn", text: t("Nenhuma categoria BUILTBY…: talvez nenhuma fábrica consiga construir a tropa."), section: "cats" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, details, catalog, categories, weapons, missing, view, mixChecks, mixKey]);

  const save = async () => p.save({ thumb: snapshot.current?.() ?? null });
  // verificação completa no núcleo (mesma que roda antes de gerar)
  const runChecks = async () => {
    if (!doc.base || problems.some((x) => x.level === "err")) return;
    setChecking(true);
    try { setFindings(await api.unitValidate(id, request())); } catch (e) { setFindings([{ level: "err", area: t("Verificação"), text: errorText(e) }]); } finally { setChecking(false); }
  };
  useEffect(() => { setFindings(null); }, [doc]);
  useEffect(() => { if (section === "check" && findings === null && !checking) void runChecks(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [section, findings]);
  const build = async (play: boolean) => {
    const errs = problems.filter((x) => x.level === "err");
    if (errs.length) { setSection("check"); toast("error", errs[0].text); return; }
    await save();
    const r = await run(`unit:${id}`, () => api.unitBuild(id, request()), (x) => (doc.pack ? t("Tropa \"{name}\" gerada no pacote \"{pack}\" ({mod}).", { name: doc.name, pack: doc.pack, mod: x.manifest.name }) : t("Tropa \"{name}\" gerada ({mod}).", { name: doc.name, mod: x.manifest.name })));
    if (!r) return;
    setResult(r);
    await refreshMods();
    void api.unitPacks().then(setPacks).catch(() => {});
    if (play) await run("launch", () => api.launchGame(), t("Abrindo o jogo…"));
  };

  const applyPreset = (preset: (typeof ROLE_PRESETS)[number] | null) => p.commit((d) => {
    const overrides = { ...d.overrides };
    const paths = (k: string) => (k.startsWith("Weapon.*.") ? weapons.filter((w) => !w.dummy).map((w) => `Weapon.${w.index}.${k.slice(9)}`) : [k]);
    // tira os valores de qualquer modelo anterior
    for (const pr of ROLE_PRESETS) for (const k of Object.keys(pr.mul)) for (const pth of paths(k)) delete overrides[pth];
    if (preset) for (const [k, m] of Object.entries(preset.mul)) for (const pth of paths(k)) {
      const b = leafValue(leaves.get(pth));
      if (typeof b !== "number" || b === 0) continue;
      const v = b * m;
      overrides[pth] = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100;
    }
    return { ...d, overrides };
  });

  const savePaint = async (png: string) => {
    try {
      const name = await api.creationAssetPut(id, "pintura.png", png);
      p.commit((d) => ({ ...d, appearance: { ...d.appearance, albedoAsset: name } }));
    } catch (e) { toast("error", errorText(e)); }
  };
  const makeIcon = async () => {
    const url = iconShot.current?.();
    if (!url) { toast("error", t("Não deu para fotografar a vista 3D.")); return; }
    const name = await api.creationAssetPut(id, "icone.png", url);
    p.commit((d) => ({ ...d, appearance: { ...d.appearance, iconAsset: name } }));
    toast("ok", t("Ícone criado a partir da vista 3D. Ele substitui o ícone da base no jogo."));
  };

  useHotkeys(active, { "ctrl+s": () => void save(), "ctrl+z": p.undo, "ctrl+y": p.redo, "ctrl+shift+z": p.redo });

  // ------------------------------------------------------------ árvore
  const nodes = useMemo<TreeNode[]>(() => [{
    id: "root", label: doc.name || t("Tropa"), icon: "smart_toy", color: "#f2b33d", detail: doc.newId,
    children: [
      { id: "general", label: t("Geral"), icon: "badge", detail: doc.pack ? t("pacote {name}", { name: doc.pack }) : undefined },
      { id: "look", label: t("Aparência"), icon: "palette", detail: modelSrc.source === "creation" ? t("modelo próprio") : undefined },
      { id: "texture", label: t("Gerador de texturas"), icon: "texture", detail: doc.texgen?.versions.length ? t("{n} versões", { n: doc.texgen.versions.length }) : undefined },
      { id: "mix", label: t("Misturar 3 tropas"), icon: "merge_type", color: mix ? "#ffd166" : undefined, detail: mix ? [mix.turret && t("torre"), mix.weapon && t("arma")].filter(Boolean).join(" + ") : undefined },
      { id: "balance", label: t("Equilíbrio"), icon: "balance" },
      { id: "grp:attr", label: t("Atributos"), icon: "tune", children: ATTRS.map((a) => ({ id: `attr:${a.id}`, label: t(a.label), icon: a.icon, detail: String(a.fields.filter(([f]) => changed(f)).length || "") })) },
      { id: "weapons", label: t("Armas"), icon: "gps_fixed", detail: String(weapons.length), children: weapons.map((w) => ({ id: `weapon:${w.index}`, label: String(value(`Weapon.${w.index}.Label`) ?? w.label), icon: w.dummy ? "block" : w.from ? "content_copy" : "gps_fixed", detail: w.from ? t("de {unit}", { unit: w.from }) : w.dummy ? t("efeito") : undefined })) },
      { id: "anims", label: t("Animações"), icon: "animation", children: animFields.map(([f, file]) => ({ id: `anim:${f}`, label: animLabel(f), icon: "play_circle", detail: file.startsWith("asset:") ? t("criada aqui") : doc.animations[f] ? t("trocada") : undefined })) },
      { id: "cats", label: t("Comportamento"), icon: "category", detail: `${categories.length}` },
      { id: "advanced", label: t("Todos os campos"), icon: "list" },
      { id: "bp", label: t("Blueprint (texto)"), icon: "description" },
      { id: "check", label: t("Validação"), icon: problems.some((x) => x.level === "err") ? "error" : "verified", color: problems.some((x) => x.level === "err") ? "#e5534b" : "#7bd88f", detail: problems.length ? String(problems.length) : "ok" },
    ],
  }],
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [doc, details, animFields, categories, problems, weapons]);

  // ------------------------------------------------------------ propriedades
  const fieldProp = (path: string, label: string): Prop | null => {
    const l = leaves.get(path);
    const v = value(path);
    if (v === null && !l) return null;
    const mark = changed(path) ? " •" : "";
    if (path === "Physics.MotionType") {
      return { kind: "select", label: label + mark, value: String(v ?? ""), onChange: (x) => setValue(path, x), options: Object.entries(MOTION).map(([value, lab]) => ({ value, label: t(lab) })), hint: t("Mudar o tipo de movimento pode exigir animações e física compatíveis.") };
    }
    if (typeof v === "number") return { kind: "number", label: label + mark, value: v, step: Math.abs(v) < 10 ? 0.1 : 1, onChange: (x) => setValue(path, x), hint: changed(path) ? t("Original: {v}", { v: l?.number ?? "—" }) : undefined };
    if (typeof v === "boolean") return { kind: "toggle", label: label + mark, value: v, onChange: (x) => setValue(path, x) };
    return { kind: "text", label: label + mark, value: String(v ?? ""), onChange: (x) => setValue(path, x), hint: missing.includes(String(v)) ? t("Este arquivo não existe no jogo.") : undefined };
  };

  const cur = useMemo(() => statsOf(num, weapons),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.overrides, leaves, weapons]);
  const ref = useMemo(() => {
    if (compareWith && others[compareWith]) {
      const od = others[compareWith];
      const m = new Map(od.leaves.map((l) => [l.path, l]));
      return { name: od.name, s: statsOf((pth) => { const l = m.get(pth); return l?.kind === "number" ? l.number : null; }, od.weapons) };
    }
    return { name: details?.name ?? "base", s: statsOf((pth) => { const l = baseLeaves.get(pth); return l?.kind === "number" ? l.number : null; }, details?.weapons ?? []) };
  }, [compareWith, others, details, baseLeaves]);

  function openDraft(index: number | null) {
    const bones = view?.bones.map((b) => b.name) ?? [];
    if (!bones.length) { toast("info", t("Espere o modelo carregar para animar.")); return; }
    if (index !== null) {
      const c = (doc.customAnims ?? [])[index];
      if (c) { setDraft({ index, name: c.name, field: c.field, duration: c.duration, keys: c.keys.map((k) => ({ ...k })) }); setPlaying(false); setScrub(0); return; }
    }
    const b = bones.find((x) => /turret/i.test(x)) ?? bones[1] ?? bones[0];
    setDraft({ index: null, name: "minha_animacao", field: "Display.AnimationIdle", duration: 2, keys: [{ bone: b, time: 0, pos: [0, 0, 0], rot: [0, 0, 0] }, { bone: b, time: 1, pos: [0, 0, 0], rot: [0, 40, 0] }, { bone: b, time: 2, pos: [0, 0, 0], rot: [0, 0, 0] }] });
    setPlaying(true);
    setScrub(0);
  }
  const saveDraft = async () => {
    if (!draft || !doc.base) return;
    const source = modelSrc.source === "creation" ? { model: modelSrc.creation } : { unit: doc.base };
    const asset = await run(`anim:${id}`, () => api.animCreate(id, draft.name, source, draft.keys, draft.duration));
    if (!asset) return;
    p.commit((d) => {
      const list = [...(d.customAnims ?? [])];
      const entry = { name: draft.name, field: draft.field, duration: draft.duration, keys: draft.keys, asset };
      if (draft.index !== null && list[draft.index]) list[draft.index] = entry; else list.push(entry);
      return { ...d, customAnims: list, animations: { ...d.animations, [draft.field]: { file: `asset:${asset}`, rate: d.animations[draft.field]?.rate ?? null } } };
    });
    toast("ok", t("Animação \"{name}\" salva e usada em {field}.", { name: draft.name, field: animLabel(draft.field) }));
    setDraft(null);
    setSection(`anim:${draft.field}`);
  };

  const sections = useMemo(() => {
    const out: { title: string; props: Prop[] }[] = [];
    if (!doc.base) return out;
    if (section === "general") {
      out.push({ title: t("Identidade"), props: [
        { kind: "text", label: t("Nome"), value: doc.name, onChange: (v) => p.commit((d) => ({ ...d, name: v.slice(0, 60) })) },
        { kind: "text", label: t("Descrição"), value: doc.description, multiline: true, onChange: (v) => p.commit((d) => ({ ...d, description: v.slice(0, 300) })) },
        { kind: "text", label: t("Id da unidade"), value: doc.newId, onChange: (v) => p.commit((d) => ({ ...d, newId: v.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) })), hint: t("Nome da pasta no jogo. Precisa ser único.") },
      ] });
      out.push({ title: t("Base"), props: [
        { kind: "select", label: t("Unidade base"), value: doc.base ?? "", onChange: (v) => p.commit((d) => ({ ...d, base: v })), options: (catalog ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.id})` })), hint: t("Atributos, armas e comportamento começam iguais aos dela.") },
        { kind: "info", label: t("Facção"), value: details?.faction ?? "…" },
        { kind: "info", label: t("Função"), value: details?.role ?? "…" },
        { kind: "info", label: t("Alterações"), value: t("{n} campo(s)", { n: Object.keys(doc.overrides).length }) },
      ] });
      out.push({ title: t("Pacote (várias tropas num mod)"), props: [
        { kind: "select", label: t("Pacote"), value: doc.pack ?? "", onChange: (v) => p.commit((d) => ({ ...d, pack: v || null })),
          options: [{ value: "", label: t("Sem pacote (mod próprio)") }, ...packs.map((x) => ({ value: x.name, label: x.units.length === 1 ? t("{name} (1 tropa)", { name: x.name }) : t("{name} ({n} tropas)", { name: x.name, n: x.units.length }) })), ...(doc.pack && !packs.some((x) => x.name === doc.pack) ? [{ value: doc.pack, label: t("{name} (novo)", { name: doc.pack }) }] : [])] },
        { kind: "custom", label: t("Novo pacote"), node: <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const n = newPack.trim(); if (!n) return; p.commit((d) => ({ ...d, pack: n.slice(0, 40) })); setNewPack(""); }}>
          <input className="pinput" placeholder={t("ex.: Minha facção")} value={newPack} onChange={(e) => setNewPack(e.target.value)} /><button className="btn sm"><Icon name="add" size={15} /></button></form> },
        { kind: "info", label: "", value: t("Tropas do mesmo pacote vão juntas num mod só na biblioteca: liga e desliga tudo de uma vez.") },
      ] });
      out.push({ title: t("Anotações"), props: [{ kind: "text", label: t("Notas"), value: doc.notes, multiline: true, onChange: (v) => p.commit((d) => ({ ...d, notes: v })) }] });
    } else if (section === "look") {
      const a = doc.appearance;
      const setA = (fn: (x: UnitDoc["appearance"]) => UnitDoc["appearance"]) => p.commit((d) => ({ ...d, appearance: fn(d.appearance) }));
      out.push({ title: t("Modelo 3D"), props: [
        { kind: "select", label: t("Modelo"), value: a.model.source === "creation" ? a.model.creation : "", onChange: (v) => setA((x) => ({ ...x, model: v ? { source: "creation", creation: v, name: models?.find((m) => m.id === v)?.name ?? v } : { source: "base" } })),
          options: [{ value: "", label: t("O da unidade base") }, ...(models ?? []).map((m) => ({ value: m.id, label: t("Modelo próprio: {name}", { name: m.name }) }))], hint: t("Modelos próprios precisam ser preparados no editor 3D (Exportar → Preparar para o jogo).") },
        { kind: "number", label: t("Escala"), value: (typeof doc.overrides["Display.UniformScale"] === "number" ? doc.overrides["Display.UniformScale"] as number : (leaves.get("Display.UniformScale")?.number ?? 1)), step: 0.005, min: 0.001, max: 10, onChange: (v) => setValue("Display.UniformScale", v) },
      ] });
      if (a.model.source === "creation" && details) {
        const mine = view?.bones.map((b) => b.name) ?? [];
        const map = a.boneMap ?? {};
        out.push({ title: t("Assistente de ossos"), props: [
          { kind: "info", label: "", value: t("As armas e efeitos saem de ossos com estes nomes. Escolha qual grupo do seu modelo faz o papel de cada um.") },
          ...details.bones.map((b) => {
            const auto = mine.find((m) => m.toLowerCase() === b.toLowerCase());
            return { kind: "select", label: `${auto || map[b] ? "✓" : "✗"} ${b}`, value: map[b] ?? (auto ? "__same" : ""),
              onChange: (v: string) => setA((x) => { const bm = { ...(x.boneMap ?? {}) }; if (!v || v === "__same") delete bm[b]; else bm[b] = v; return { ...x, boneMap: bm }; }),
              options: [{ value: "", label: t("— nenhum —") }, ...(auto ? [{ value: "__same", label: t("{name} (mesmo nome)", { name: auto }) }] : []), ...mine.filter((m) => m !== auto).map((m) => ({ value: m, label: m }))] } as Prop;
          }),
        ] });
      }
      out.push({ title: t("Textura"), props: [
        { kind: "slider", label: t("Matiz"), value: a.tint.hue, min: -180, max: 180, unit: "°", onChange: (v) => setA((x) => ({ ...x, tint: { ...x.tint, hue: v } })) },
        { kind: "slider", label: t("Saturação"), value: a.tint.sat, min: -100, max: 100, unit: "%", onChange: (v) => setA((x) => ({ ...x, tint: { ...x.tint, sat: v } })) },
        { kind: "slider", label: t("Brilho"), value: a.tint.bright, min: -60, max: 60, unit: "%", onChange: (v) => setA((x) => ({ ...x, tint: { ...x.tint, bright: v } })) },
        { kind: "custom", label: t("Pintar no modelo"), node: <button className={`btn sm ${paint.on ? "primary" : ""}`} onClick={() => { setPaint((x) => ({ ...x, on: !x.on })); setRibbon("look"); }}><Icon name="brush" size={15} /> {paint.on ? t("Pincel ligado") : t("Ligar pincel")}</button> },
        { kind: "custom", label: t("Imagem própria"), node: <span className="row" style={{ gap: 6 }}>
          <button className="btn sm" onClick={() => imageInput.current?.click()}><Icon name="upload" size={15} /> {t("Importar PNG")}</button>
          {a.albedoAsset && <button className="btn sm text" title={t("Voltar à textura original")} onClick={() => setA((x) => ({ ...x, albedoAsset: null }))}><Icon name="undo" size={15} /> {t("Original")}</button>}
        </span> },
      ] });
      out.push({ title: t("Ícone"), props: [
        { kind: "custom", label: "", node: <span className="row" style={{ gap: 10, alignItems: "center" }}>
          <span className="unit-icon">{iconUrl ? <img src={iconUrl} alt={t("Ícone")} /> : <Icon name="smart_toy" size={26} />}</span>
          <span className="col" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={() => setIconLab(true)}><Icon name="tune" size={15} /> {t("Gerador de ícones")}</button>
            <button className="btn sm" onClick={() => void makeIcon()}><Icon name="photo_camera" size={15} /> {t("Foto da vista 3D")}</button>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm text" onClick={() => iconInput.current?.click()}><Icon name="upload" size={15} /> PNG</button>
              {a.iconAsset && <button className="btn sm text" onClick={() => setA((x) => ({ ...x, iconAsset: null }))}><Icon name="close" size={15} /></button>}
            </span>
          </span>
        </span> },
        { kind: "info", label: "", value: a.iconAsset ? t("Substitui o ícone da base (mesmo tamanho e formato).") : t("Sem ícone próprio: usa o da base.") },
      ] });
      out.push({ title: t("Prévia"), props: [{ kind: "custom", label: t("Cor do time"), node: <span className="swatches">{TEAM.map((c) => <button key={c} style={{ background: c, outline: teamColor === c ? "2px solid #fff" : undefined }} aria-label={c} onClick={() => setTeamColor(c)} />)}</span> }] });
    } else if (section === "texture") {
      out.push({ title: t("Gerador de texturas"), props: [{ kind: "custom", label: "", node: <TextureLab projectId={id} name={doc.name} model={view}
        modelKey={`${doc.base}|${modelSrc.source === "creation" ? modelSrc.creation : ""}|${mixKey}`}
        value={doc.texgen ?? null} onChange={(v) => p.commit((d) => ({ ...d, texgen: v }))} onPreview={setTexPreview}
        applied={doc.appearance.albedoAsset} onApply={(asset) => p.commit((d) => ({ ...d, appearance: { ...d.appearance, albedoAsset: asset } }))} /> }] });
    } else if (section === "mix") {
      const m = doc.mix ?? { chassis: doc.base, turret: null, weapon: null, turretScale: 0, weaponScale: 0, turretOffset: [0, 0, 0] as [number, number, number], turretYaw: 0 };
      const setM = (fn: (x: typeof m) => typeof m) => p.commit((d) => ({ ...d, mix: fn(d.mix ?? m) }));
      const unitOpts = [{ value: "", label: t("— a do chassi —") }, ...(catalog ?? []).filter((u) => u.id !== doc.base).map((u) => ({ value: u.id, label: `${u.name} (${u.id}) · ${u.faction}` }))];
      if (modelSrc.source === "creation") {
        out.push({ title: t("Misturar 3 tropas"), props: [{ kind: "info", label: "", value: t("O misturador usa o modelo do jogo como chassi. Volte para \"O da unidade base\" em Aparência para usá-lo.") }] });
      } else {
        out.push({ title: t("Peças"), props: [
          { kind: "info", label: "", value: t("Junte o chassi (a unidade base), a torre de uma segunda tropa e o cano/arma de uma terceira. Os modelos, as texturas e as animações são combinados num modelo só, com os ossos que o jogo espera.") },
          { kind: "info", label: t("1 · Chassi"), value: details ? `${details.name} (${doc.base})` : doc.base ?? "—" },
          { kind: "select", label: t("2 · Torre de"), value: m.turret ?? "", onChange: (v) => setM((x) => ({ ...x, turret: v || null })), options: unitOpts },
          { kind: "select", label: t("3 · Arma de"), value: m.weapon ?? "", onChange: (v) => setM((x) => ({ ...x, weapon: v || null })), options: unitOpts, hint: t("O cano e a arma do blueprint (projétil, dano, efeitos) vêm desta tropa.") },
        ] });
        out.push({ title: t("Encaixe"), props: [
          { kind: "slider", label: t("Escala da torre"), value: Math.round((m.turretScale || 0) * 100), min: 0, max: 280, unit: "%", onChange: (v) => setM((x) => ({ ...x, turretScale: v < 30 ? 0 : v / 100 })), hint: m.turretScale ? undefined : t("0 = automática (pela largura do chassi)") },
          { kind: "slider", label: t("Escala da arma"), value: Math.round((m.weaponScale || 0) * 100), min: 0, max: 300, unit: "%", onChange: (v) => setM((x) => ({ ...x, weaponScale: v < 30 ? 0 : v / 100 })), hint: m.weaponScale ? undefined : t("0 = automática") },
          { kind: "slider", label: t("Giro da torre"), value: m.turretYaw, min: -180, max: 180, unit: "°", onChange: (v) => setM((x) => ({ ...x, turretYaw: v })) },
          ...(["Lado", "Altura", "Frente"] as const).map((lab, k) => ({ kind: "number", label: t(lab), value: m.turretOffset[k], step: 0.01, min: -2, max: 2,
            onChange: (v: number) => setM((x) => { const o = [...x.turretOffset] as [number, number, number]; o[k] = v; return { ...x, turretOffset: o }; }) } as Prop)),
          { kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm text" onClick={() => setM((x) => ({ ...x, turretScale: 0, weaponScale: 0, turretOffset: [0, 0, 0], turretYaw: 0 }))}><Icon name="restart_alt" size={15} /> {t("Encaixe automático")}</button>
            {doc.mix && <button className="btn sm text" onClick={() => p.commit((d) => ({ ...d, mix: null }))}><Icon name="undo" size={15} /> {t("Desfazer mistura")}</button>}
          </span> },
        ] });
        out.push({ title: t("Verificações"), props: !mix ? [{ kind: "info", label: "", value: t("Escolha a torre ou a arma de outra tropa.") }]
          : mixChecks === null ? [{ kind: "info", label: "", value: t("Montando a mistura…") }]
          : mixChecks.map((c) => ({ kind: "custom", label: c.level === "err" ? t("Erro") : c.level === "warn" ? t("Aviso") : c.level === "fix" ? t("Corrigido") : "OK", node: <span className={`check-item ${c.level}`}>{tr(c.text)}</span> } as Prop)) });
      }
    } else if (section === "balance") {
      const rows: [string, keyof Stats, boolean][] = [
        ["Vida", "hp", true], ["Dano por segundo", "dps", true], ["Alcance", "range", true], ["Velocidade", "speed", true], ["Visão", "vision", true],
        ["Custo em massa", "mass", false], ["Custo em energia", "energy", false], ["Tempo de construção", "time", false],
        ["Vida por massa", "hpPerMass", true], ["Dano/s por massa", "dpsPerMass", true],
      ];
      const ratio = ref.s.eff ? cur.eff / ref.s.eff : 1;
      out.push({ title: t("Comparação"), props: [
        { kind: "select", label: t("Comparar com"), value: compareWith, onChange: setCompareWith, options: [{ value: "", label: t("A base ({name})", { name: details?.name ?? "…" }) }, ...(catalog ?? []).filter((u) => u.id !== doc.base).map((u) => ({ value: u.id, label: `${u.name} (${u.id})` }))] },
        { kind: "custom", label: "", node: <table className="bal-table">
          <thead><tr><th /><th>{ref.name}</th><th>{t("Esta tropa")}</th><th /></tr></thead>
          <tbody>{rows.map(([label, k, up]) => {
            const a0 = ref.s[k], b0 = cur[k];
            const pct = a0 ? Math.round(((b0 - a0) / Math.abs(a0)) * 100) : 0;
            const good = pct === 0 ? "" : (pct > 0) === up ? "good" : "bad";
            return <tr key={k}><td>{t(label)}</td><td>{fmt(a0)}</td><td><b>{fmt(b0)}</b></td><td className={good}>{pct ? `${pct > 0 ? "+" : ""}${pct}%` : "="}</td></tr>;
          })}</tbody>
        </table> },
        { kind: "custom", label: "", node: <Notice kind={ratio > 1.6 || ratio < 0.5 ? "warn" : "ok"}>
          {t("Força pelo custo:")} <b>{Math.round(ratio * 100)}%</b> {t("da referência.")} {ratio > 1.6 ? t("Pode desequilibrar as partidas: aumente o custo ou reduza vida/dano.") : ratio < 0.5 ? t("Ficou fraca para o preço.") : t("Dentro do razoável.")}
        </Notice> },
        { kind: "info", label: "", value: t("Estimativa simples (vida × dano por segundo ÷ custo). Teste no jogo antes de usar em partidas sérias.") },
      ] });
      out.push({ title: t("Modelos de função"), props: [
        { kind: "custom", label: "", node: <div className="role-grid">
          {ROLE_PRESETS.filter((r) => !r.air || categories.some((c) => c.toUpperCase() === "AIR")).map((r) => (
            <button key={r.id} className="role-card" onClick={() => applyPreset(r)} title={t(r.desc)}><Icon name={r.icon} size={20} /><b>{t(r.label)}</b><small>{t(r.desc)}</small></button>
          ))}
          <button className="role-card" onClick={() => applyPreset(null)}><Icon name="undo" size={20} /><b>{t("Voltar à base")}</b><small>{t("Tira os valores dos modelos.")}</small></button>
        </div> },
        { kind: "info", label: "", value: t("Os modelos ajustam vários atributos a partir dos valores da base (não se somam). Depois ajuste à mão.") },
      ] });
    } else if (section.startsWith("attr:")) {
      const g = ATTRS.find((a) => `attr:${a.id}` === section);
      if (g) {
        const props = g.fields.map(([f, label]) => fieldProp(f, t(label))).filter((x): x is Prop => !!x);
        out.push({ title: t(g.label), props: props.length ? props : [{ kind: "info", label: "", value: t("A unidade base não tem estes campos.") }] });
        const changedHere = g.fields.filter(([f]) => changed(f));
        if (changedHere.length) out.push({ title: t("Alterados"), props: [{ kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>{changedHere.map(([f, label]) => <button key={f} className="chip" onClick={() => reset(f)} title={t("Voltar ao valor original")}>{t(label)} <Icon name="undo" size={14} /></button>)}</span> }] });
      }
    } else if (section === "weapons") {
      out.push({ title: t("Armas"), props: [
        { kind: "info", label: t("Total"), value: t("{n} arma(s)", { n: weapons.length }) },
        { kind: "custom", label: "", node: <button className="btn sm" onClick={() => setWeaponPick(0)}><Icon name="add" size={15} /> {t("Adicionar arma de outra unidade")}</button> },
        { kind: "info", label: "", value: t("Copiar a arma inteira traz junto o projétil, os efeitos e os sons originais dela.") },
      ] });
    } else if (section.startsWith("weapon:")) {
      const i = Number(section.split(":")[1]);
      const w = weapons.find((x) => x.index === i);
      const baseCount = details?.weapons.length ?? 0;
      let appended = 0;
      const copyIdx = copies.findIndex(([t]) => { if (t > 0) return t === i; appended++; return baseCount + appended === i; });
      const props = WEAPON_FIELDS.map(([f, label]) => fieldProp(`Weapon.${i}.${f}`, t(label))).filter((x): x is Prop => !!x);
      const dps = (num(`Weapon.${i}.Damage`) ?? 0) * (num(`Weapon.${i}.RateOfFire`) ?? 0) * Math.max(1, num(`Weapon.${i}.MuzzleSalvoSize`) ?? 1);
      out.push({ title: w?.label ?? t("Arma {n}", { n: i }), props: [
        ...(w?.from ? [{ kind: "info", label: t("Origem"), value: t("copiada de {unit}", { unit: w.from }) } as Prop] : []),
        { kind: "info", label: t("Dano por segundo"), value: fmt(dps) },
        ...props,
      ] });
      out.push({ title: t("Trocar"), props: [
        { kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <button className="btn sm" onClick={() => setWeaponPick(i)}><Icon name="swap_horiz" size={15} /> {t("Trocar por arma de outra unidade")}</button>
          {copyIdx >= 0 && <button className="btn sm text" onClick={() => p.commit((d) => {
            const list = [...(d.weaponCopies ?? [])];
            const [t] = list.splice(copyIdx, 1)[0];
            // tira as alterações da arma copiada (e reposiciona as armas novas que vinham depois)
            const overrides: UnitDoc["overrides"] = {};
            for (const [k, v] of Object.entries(d.overrides)) {
              const m = /^Weapon\.(\d+)\.(.*)$/.exec(k);
              if (!m) { overrides[k] = v; continue; }
              const n = Number(m[1]);
              if (n === i) continue;
              overrides[t === 0 && n > i ? `Weapon.${n - 1}.${m[2]}` : k] = v;
            }
            return { ...d, weaponCopies: list, overrides };
          })}><Icon name="undo" size={15} /> {copies[copyIdx]?.[0] === 0 ? t("Remover arma") : t("Voltar à original")}</button>}
        </span> },
      ] });
      const known = new Set(WEAPON_FIELDS.map(([f]) => `Weapon.${i}.${f}`));
      const extra = [...leaves.values()].filter((l) => l.path.startsWith(`Weapon.${i}.`) && !known.has(l.path) && l.kind !== "text").slice(0, 60);
      if (extra.length) out.push({ title: t("Mais campos desta arma"), props: extra.map((l) => fieldProp(l.path, l.path.slice(`Weapon.${i}.`.length))).filter((x): x is Prop => !!x) });
    } else if (section === "anims" || section.startsWith("anim:")) {
      const field = section.startsWith("anim:") ? section.slice(5) : animField;
      out.push({ title: t("Animações"), props: [
        { kind: "info", label: t("Total"), value: t("{n} animações", { n: animFields.length }) },
        { kind: "custom", label: t("Criar"), node: <button className="btn sm" onClick={() => openDraft(null)}><Icon name="add" size={15} /> {t("Nova animação")}</button> },
        ...((doc.customAnims ?? []).length ? [{ kind: "custom", label: t("Feitas aqui"), node: <span className="col" style={{ gap: 4 }}>{(doc.customAnims ?? []).map((c, k) => (
          <button key={k} className="btn sm text" style={{ justifyContent: "flex-start" }} onClick={() => openDraft(k)}><Icon name="edit" size={15} /> {c.name} <small className="faint">({animLabel(c.field)})</small></button>
        ))}</span> } as Prop] : []),
      ] });
      if (field) {
        const cur2 = animFields.find(([f]) => f === field)?.[1] ?? "";
        const rate = doc.animations[field]?.rate ?? null;
        out.push({ title: animLabel(field), props: [
          { kind: "info", label: t("Campo"), value: field },
          { kind: "info", label: t("Arquivo"), value: cur2.startsWith("asset:") ? t("{name} (criada aqui)", { name: cur2.slice(6) }) : cur2.split("/").pop() },
          { kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => void playAnim(field, cur2)}><Icon name="play_arrow" size={15} /> {t("Ver")}</button>
            <button className="btn sm" onClick={() => { setAnimPick(field); if (!allAnims) void api.unitAnimations().then(setAllAnims).catch(() => setAllAnims([])); }}><Icon name="swap_horiz" size={15} /> {t("Trocar")}</button>
            {doc.animations[field] && <button className="btn sm text" onClick={() => p.commit((d) => { const a = { ...d.animations }; delete a[field]; return { ...d, animations: a }; })}><Icon name="undo" size={15} /> {t("Original")}</button>}
          </span> },
          { kind: "number", label: t("Velocidade"), value: rate ?? 1, step: 0.1, min: 0.05, max: 10, onChange: (v) => p.commit((d) => ({ ...d, animations: { ...d.animations, [field]: { file: d.animations[field]?.file ?? cur2, rate: v } } })) },
        ] });
      }
    } else if (section === "cats") {
      const builtBy = categories.filter((c) => c.toUpperCase().startsWith("BUILTBY"));
      const builtOpts = allCats.filter((c) => c.startsWith("BUILTBY") && !builtBy.includes(c));
      const addCat = (c: string) => p.commit((d) => ({ ...d, categoriesAdd: [...d.categoriesAdd.filter((x) => x !== c), c], categoriesRemove: d.categoriesRemove.filter((x) => x !== c) }));
      const rmCat = (c: string) => p.commit((d) => ({ ...d, categoriesAdd: d.categoriesAdd.filter((x) => x !== c), categoriesRemove: (details?.categories ?? []).includes(c) ? [...d.categoriesRemove, c] : d.categoriesRemove }));
      out.push({ title: t("Quem constrói (fábricas)"), props: [
        { kind: "custom", label: "", node: <div className="cat-chips">{builtBy.length ? builtBy.map((c) => <button key={c} className="chip" title={t("Remover")} onClick={() => rmCat(c)}>{c} <Icon name="close" size={13} /></button>) : <span className="faint small">{t("nenhuma")}</span>}</div> },
        { kind: "select", label: t("Adicionar fábrica"), value: "", onChange: (v) => v && addCat(v), options: [{ value: "", label: t("— escolha —") }, ...builtOpts.map((c) => ({ value: c, label: c }))] },
        { kind: "info", label: t("Pesquisa"), value: t("A tropa nova segue as regras de construção das categorias acima. Exigir uma pesquisa própria ainda não é possível (experimental).") },
      ] });
      out.push({ title: t("Categorias (comportamento no jogo)"), props: [
        { kind: "custom", label: "", node: <div className="cat-chips">{categories.map((c) => (
          <button key={c} className="chip" title={t("Remover")} onClick={() => rmCat(c)}>{c} <Icon name="close" size={13} /></button>
        ))}</div> },
        { kind: "custom", label: t("Adicionar"), node: <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); const c = newCat.trim().toUpperCase().replace(/[^A-Z0-9_]/g, ""); if (!c) return; addCat(c); setNewCat(""); }}>
          <input className="pinput" placeholder={t("EX.: AMPHIBIOUS")} list={`cats-${id}`} value={newCat} onChange={(e) => setNewCat(e.target.value)} /><button className="btn sm"><Icon name="add" size={15} /></button>
          <datalist id={`cats-${id}`}>{allCats.map((c) => <option key={c} value={c} />)}</datalist></form> },
        { kind: "info", label: t("Dica"), value: t("Categorias decidem quem constrói a tropa, alvos das armas e como a IA a usa. Mantenha as de facção e de fábrica da base.") },
      ] });
    } else if (section === "advanced") {
      const f = advFilter.trim().toLowerCase();
      const list = [...leaves.values()].filter((l: BpLeaf) => l.kind !== "text" || l.path.endsWith("Label") || (l.text && isPath(l.text))).filter((l) => !f || l.path.toLowerCase().includes(f)).slice(0, 150);
      out.push({ title: t("Todos os campos do blueprint"), props: [
        { kind: "custom", label: t("Filtrar"), node: <input className="pinput" placeholder={t("ex.: Weapon.1, Speed, Radius")} value={advFilter} onChange={(e) => setAdvFilter(e.target.value)} /> },
        ...list.map((l) => fieldProp(l.path, l.path)).filter((x): x is Prop => !!x),
      ] });
    } else if (section === "bp") {
      out.push({ title: t("Blueprint gerado"), props: [
        { kind: "custom", label: "", node: <button className="btn sm" onClick={async () => { try { setBpText(await api.unitBlueprintPreview(request())); } catch (e) { toast("error", errorText(e)); } }}><Icon name="visibility" size={15} /> {t("Ver o texto final")}</button> },
        { kind: "info", label: "", value: t("O blueprint da base com as suas alterações. O resto (comentários, ordem) fica como no original.") },
      ] });
    } else if (section === "check") {
      out.push({ title: t("Projeto"), props: problems.length ? problems.map((x) => ({ kind: "custom", label: x.level === "err" ? t("Erro") : t("Aviso"), node: <button className={`check-item ${x.level}`} onClick={() => setSection(x.section)}>{x.text}</button> } as Prop)) : [{ kind: "info", label: "", value: t("Campos do projeto em ordem.") }] });
      const areas = [...new Set((findings ?? []).map((f) => f.area))];
      out.push({ title: t("Combate, movimento e animações"), props: [
        { kind: "info", label: "", value: t("Confere o blueprint final, o modelo e as animações como o jogo vai usar: movimento, colisão, seleção, ossos das armas, giro da torre, peças soltas e articulações. Erros impedem gerar a tropa.") },
        ...(problems.some((x) => x.level === "err") ? [{ kind: "info", label: "", value: t("Corrija os erros do projeto acima para rodar esta verificação.") } as Prop]
          : checking || findings === null ? [{ kind: "info", label: "", value: t("Conferindo…") } as Prop]
          : areas.flatMap((ar) => (findings ?? []).filter((f) => f.area === ar).map((f) => ({ kind: "custom", label: tr(ar), node: <span className={`check-item ${f.level}`}>{tr(f.text)}</span> } as Prop)))),
        { kind: "custom", label: "", node: <button className="btn sm" disabled={checking} onClick={() => void runChecks()}><Icon name="refresh" size={15} /> {t("Conferir de novo")}</button> },
      ] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, doc, details, leaves, catalog, models, animFields, animField, allAnims, categories, problems, newCat, advFilter, view, teamColor, weapons, cur, ref, compareWith, packs, newPack, iconUrl, paint.on, missing, allCats, mixChecks, mixKey, findings, checking]);

  if (p.status === "loading") return <div className="studio-root"><div className="bar indeterminate" style={{ margin: 30 }}><i /></div></div>;
  if (p.status === "error") return <div className="studio-root"><Empty icon="error" title={t("Não deu para abrir o projeto")}>{p.error}</Empty></div>;

  return (
    <div className="studio-root">
      <div className="studio-top">
        <Ribbon active={ribbon} onTab={setRibbon} tabs={[{ id: "home", label: t("Início") }, { id: "look", label: t("Aparência") }, { id: "anim", label: t("Animação") }, { id: "test", label: t("Testar e gerar") }]}>
          {ribbon === "home" && <>
            <RibbonGroup label={t("Editar")}>
              <RibbonButton icon="badge" label={t("Geral")} active={section === "general"} onClick={() => setSection("general")} />
              <RibbonButton icon="balance" label={t("Equilíbrio")} active={section === "balance"} onClick={() => setSection("balance")} color="#ffd166" />
              <RibbonButton icon="shield" label={t("Defesa")} active={section === "attr:defense"} onClick={() => setSection("attr:defense")} />
              <RibbonButton icon="payments" label={t("Custo")} active={section === "attr:economy"} onClick={() => setSection("attr:economy")} />
              <RibbonButton icon="speed" label={t("Movimento")} active={section === "attr:physics"} onClick={() => setSection("attr:physics")} />
              <RibbonButton icon="gps_fixed" label={t("Armas")} active={section.startsWith("weapon")} onClick={() => setSection(weapons[0] ? `weapon:${weapons[0].index}` : "weapons")} />
              <RibbonButton icon="category" label={t("Comportamento")} active={section === "cats"} onClick={() => setSection("cats")} />
            </RibbonGroup>
            <RibbonGroup label={t("Gerar")}>
              <RibbonButton icon="fact_check" label={t("Validar")} onClick={() => setSection("check")} color={problems.some((x) => x.level === "err") ? "#e5534b" : "#7bd88f"} />
              <RibbonButton icon="rocket_launch" label={busy ? t("Gerando…") : t("Gerar tropa")} onClick={() => void build(false)} disabled={busy || !doc.base} color="#a3e635" />
            </RibbonGroup>
          </>}
          {ribbon === "look" && <>
            <RibbonGroup label={t("Modelo")}>
              <RibbonButton icon="palette" label={t("Aparência")} active={section === "look"} onClick={() => setSection("look")} />
              <RibbonButton icon="merge_type" label={t("Misturar 3 tropas")} active={section === "mix"} onClick={() => setSection("mix")} color="#ffd166" />
              <RibbonButton icon="view_in_ar" label={t("Novo modelo 3D")} onClick={async () => {
                const m = await run("newmodel", () => api.creationCreate("model", t("{name} (modelo)", { name: doc.name }), { schema: 1, parts: [], groups: [], gridSize: 1, notes: "" }));
                if (m) { useTabs.getState().open(m); toast("info", t("Modele, prepare para o jogo e escolha o modelo em Aparência.")); }
              }} />
              <RibbonButton icon="texture" label={t("Gerar textura")} active={section === "texture"} onClick={() => setSection("texture")} color="#7bd88f" />
              <RibbonButton icon="upload" label={t("Textura PNG")} onClick={() => imageInput.current?.click()} />
              <RibbonButton icon="photo_camera" label={t("Gerador de ícones")} onClick={() => setIconLab(true)} />
            </RibbonGroup>
            <RibbonGroup label={t("Pintar no modelo")}>
              <RibbonButton icon="brush" label={paint.on ? t("Pincel ligado") : t("Pincel")} active={paint.on} onClick={() => setPaint((x) => ({ ...x, on: !x.on }))} hint={t("Pinte direto no modelo 3D. Cada pincelada vira a textura da tropa.")} />
              <div className="ribbon-stack" style={{ width: 200 }}>
                <span className="swatches big">{PAINT.map((c) => <button key={c} style={{ background: c, outline: paint.color === c ? "2px solid #fff" : undefined }} aria-label={c} onClick={() => setPaint((x) => ({ ...x, color: c, on: true }))} />)}
                  <input type="color" value={paint.color} onChange={(e) => setPaint((x) => ({ ...x, color: e.target.value, on: true }))} aria-label={t("Outra cor")} /></span>
              </div>
              <div className="ribbon-stack" style={{ width: 170 }}>
                <label className="range" style={{ gridTemplateColumns: "54px 1fr 30px" }}><span>{t("Tamanho")}</span><input type="range" min={1} max={30} value={paint.size} onChange={(e) => setPaint((x) => ({ ...x, size: Number(e.target.value) }))} /><output>{paint.size}</output></label>
                <label className="range" style={{ gridTemplateColumns: "54px 1fr 30px" }}><span>{t("Força")}</span><input type="range" min={0.1} max={1} step={0.05} value={paint.opacity} onChange={(e) => setPaint((x) => ({ ...x, opacity: Number(e.target.value) }))} /><output>{Math.round(paint.opacity * 100)}</output></label>
              </div>
              <RibbonButton icon="undo" label={t("Textura original")} onClick={() => p.commit((d) => ({ ...d, appearance: { ...d.appearance, albedoAsset: null } }))} disabled={!doc.appearance.albedoAsset} />
            </RibbonGroup>
            <RibbonGroup label={t("Cor do time (prévia)")}>
              <span className="swatches big">{TEAM.map((c) => <button key={c} style={{ background: c, outline: teamColor === c ? "2px solid #fff" : undefined }} aria-label={c} onClick={() => setTeamColor(c)} />)}</span>
            </RibbonGroup>
          </>}
          {ribbon === "anim" && <>
            <RibbonGroup label={t("Animações")}>
              <RibbonButton icon="animation" label={t("Lista")} active={section === "anims"} onClick={() => setSection("anims")} />
              <RibbonButton icon="add" label={t("Nova animação")} onClick={() => openDraft(null)} color="#a3e635" />
            </RibbonGroup>
            <RibbonGroup label={t("Prévia")}>
              <RibbonButton icon={playing ? "pause" : "play_arrow"} label={playing ? t("Pausar") : t("Tocar")} onClick={() => setPlaying((v) => !v)} disabled={!shownAnim} />
              <div className="ribbon-stack" style={{ width: 170 }}>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 34px" }}><span>{t("Velocidade")}</span><input type="range" min={0.1} max={3} step={0.1} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /><output>{speed}×</output></label>
              </div>
            </RibbonGroup>
          </>}
          {ribbon === "test" && <>
            <RibbonGroup label={t("Conferir")}>
              <RibbonButton icon="balance" label={t("Equilíbrio")} onClick={() => setSection("balance")} />
              <RibbonButton icon="fact_check" label={t("Validar")} onClick={() => setSection("check")} />
              <RibbonButton icon="description" label={t("Ver blueprint")} onClick={async () => { try { setBpText(await api.unitBlueprintPreview(request())); } catch (e) { toast("error", errorText(e)); } }} />
            </RibbonGroup>
            <RibbonGroup label={t("Gerar")}>
              <RibbonButton icon="rocket_launch" label={busy ? t("Gerando…") : t("Gerar tropa")} onClick={() => void build(false)} disabled={busy || !doc.base} color="#a3e635" />
              <RibbonButton icon="play_circle" label={t("Gerar e jogar")} onClick={() => void build(true)} disabled={busy || !doc.base} color="#a3e635" />
            </RibbonGroup>
          </>}
        </Ribbon>
        <ProjectBar p={p} onSave={() => void save()} />
      </div>
      <StudioLayout id="unit"
        left={<Panel title={t("Explorador da tropa")} icon="account_tree" grow collapsible={false} id="unit-explorer">
          <Tree nodes={nodes} selected={new Set([section])} onSelect={(nid) => {
            if (nid === "root" || nid.startsWith("grp:")) return;
            setSection(nid as Section);
            if (nid.startsWith("anim:")) { const f = nid.slice(5); const file = animFields.find(([x]) => x === f)?.[1]; if (file) void playAnim(f, file); }
          }} />
        </Panel>}
        center={
          <div className="unit-center">
            <div className="viewport">
              {!doc.base ? <div style={{ display: "grid", placeItems: "center", height: "100%" }}><Empty icon="smart_toy" title={t("Escolha a unidade base")}>{t("Em Geral → Base.")}</Empty></div> : (
                <UnitViewport model={view} tint={doc.appearance.tint} albedoOverride={section === "texture" && texPreview ? texPreview : albedoUrl} teamColor={teamColor} anim={shownAnim} playing={playing} speed={speed}
                  snapshotRef={snapshot} iconRef={iconShot} paint={paint} onPainted={(png) => void savePaint(png)} seek={draft && !playing ? scrub : null}
                  onTime={(t) => { if (draft && draftAnim) setScrub(t % Math.max(0.05, draftAnim.duration)); }} />
              )}
              <div className="viewport-overlay">
                <span className="vp-chip"><Icon name="smart_toy" size={15} /> {doc.name} <small className="faint">({doc.newId || t("sem id")})</small></span>
                {details && <span className="vp-chip"><span className={`fac fac-${details.faction.toLowerCase()}`}>{details.faction.slice(0, 1)}</span> {t("baseada em {name}", { name: details.name })}</span>}
                {mix && <span className="vp-chip"><Icon name="merge_type" size={15} /> {t("Mistura:")} {[mix.turret && t("torre de {unit}", { unit: mix.turret }), mix.weapon && t("arma de {unit}", { unit: mix.weapon })].filter(Boolean).join(" · ")}</span>}
                {paint.on && <span className="vp-chip" style={{ color: "var(--warn)" }}><Icon name="brush" size={15} /> {t("Pintando: arraste sobre o modelo · botão direito gira")}</span>}
                {anim && animField && !draft && <span className="vp-chip"><Icon name="animation" size={15} /> {animLabel(animField)} <button aria-label={t("Parar")} onClick={() => { setAnim(null); setAnimField(null); }}><Icon name="stop" size={15} /></button></span>}
              </div>
              {details === undefined && doc.base && <div className="vp-hint">{t("Lendo a unidade do jogo…")}</div>}
              {view === null && details && <div className="vp-hint">{modelSrc.source === "creation" ? t("Prepare o modelo próprio para o jogo para vê-lo aqui.") : t("Sem prévia 3D para esta unidade.")}</div>}
            </div>
            {draft && view && (
              <AnimTimeline draft={draft} setDraft={setDraft} bones={view.bones.map((b) => b.name)} fields={animFields.map(([f]) => f)}
                time={scrub} setTime={(t) => { setPlaying(false); setScrub(t); }} playing={playing} setPlaying={setPlaying}
                busy={!!animBusy} onSave={() => void saveDraft()} onClose={() => { setDraft(null); setPlaying(true); }} />
            )}
          </div>
        }
        right={<Panel title={t("Propriedades")} icon="tune" grow collapsible={false} id="unit-props">
          {details === null ? <div className="pgrid-empty">{t("Não deu para ler a unidade base.")}</div> : <PropertyGrid sections={sections} />}
        </Panel>}
      />
      <StatusBar>
        <span><b>{Object.keys(doc.overrides).length}</b> {t("campos alterados")} · <b>{weapons.length}</b> {t("armas")} · <b>{Object.keys(doc.animations).length}</b> {t("animações trocadas")} · <b>{categories.length}</b> {t("categorias")}</span>
        <span className="grow" />
        <span style={{ color: "var(--warn)" }}>{t("Experimental: confirme no jogo se a tropa aparece na fábrica.")}</span>
      </StatusBar>

      <input ref={imageInput} type="file" accept="image/png" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        const name = await api.creationAssetPut(id, f.name, await readFile(f));
        p.commit((d) => ({ ...d, appearance: { ...d.appearance, albedoAsset: name } }));
        setSection("look");
      }} />
      <input ref={iconInput} type="file" accept="image/png" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        const name = await api.creationAssetPut(id, `icone-${f.name}`, await readFile(f));
        p.commit((d) => ({ ...d, appearance: { ...d.appearance, iconAsset: name } }));
      }} />

      {animPick && (
        <AnimPicker all={allAnims} base={doc.base ?? ""} onClose={() => setAnimPick(null)} onPick={(file) => {
          p.commit((d) => ({ ...d, animations: { ...d.animations, [animPick]: { file, rate: d.animations[animPick]?.rate ?? null } } }));
          void playAnim(animPick, file);
          setAnimPick(null);
        }} onPreview={(file) => void playAnim(animPick, file)} />
      )}
      {weaponPick !== null && (
        <WeaponPicker catalog={catalog ?? []} exclude={doc.base ?? ""} target={weaponPick} onClose={() => setWeaponPick(null)} onPick={(unit, src, d) => {
          setOthers((o) => ({ ...o, [unit]: d }));
          const target = weaponPick;
          p.commit((doc0) => {
            const list = [...(doc0.weaponCopies ?? [])].filter((c) => target === 0 || c[0] !== target);
            list.push([target, unit, src]);
            const overrides = target > 0 ? Object.fromEntries(Object.entries(doc0.overrides).filter(([k]) => !k.startsWith(`Weapon.${target}.`))) : doc0.overrides;
            return { ...doc0, weaponCopies: list, overrides };
          });
          const idx = target > 0 ? target : weapons.length + 1;
          setWeaponPick(null);
          setSection(`weapon:${idx}`);
          toast("ok", target > 0 ? t("Arma de {name} no lugar da original.", { name: d.name }) : t("Arma de {name} adicionada.", { name: d.name }));
        }} />
      )}
      {iconLab && (
        <IconStudio title={doc.name} unitId={doc.newId || doc.base || "tropa"} model={view} albedo={albedoUrl} tint={doc.appearance.tint} categories={categories}
          onClose={() => setIconLab(false)}
          onUse={async (png) => {
            const name = await api.creationAssetPut(id, "icone.png", png);
            p.commit((d) => ({ ...d, appearance: { ...d.appearance, iconAsset: name } }));
            toast("ok", t("Ícone aplicado. Ele substitui o ícone da base no jogo."));
            setIconLab(false);
          }} />
      )}
      {bpText !== null && (
        <Modal title={t("Blueprint da tropa")} icon="description" onClose={() => setBpText(null)} wide>
          <pre className="code-view">{bpText}</pre>
        </Modal>
      )}
      {result && (
        <Modal title={t("Tropa gerada")} icon="rocket_launch" onClose={() => setResult(null)}>
          <div className="col" style={{ gap: 10 }}>
            <Notice kind={result.report.warnings.length ? "warn" : "ok"}>
              <b>{result.manifest.name}</b> {t("foi para a biblioteca e está ligada no perfil ativo ({n} arquivos).", { n: result.report.files })}
              {(result.report.checks ?? []).some((c) => c.level === "ok") && <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{(result.report.checks ?? []).filter((c) => c.level === "ok").map((c, i) => <li key={i}>✓ {tr(c.area)}: {tr(c.text)}</li>)}</ul>}
              {result.report.warnings.length > 0 && <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.report.warnings.map((w, i) => <li key={i}>{tr(w)}</li>)}</ul>}
            </Notice>
            <p className="muted small">{t("Tropas novas são")} <b>{t("experimentais")}</b>{t(": abra uma escaramuça e procure a unidade na fábrica da mesma facção da base. Se não aparecer ou o jogo reclamar, desligue o mod na biblioteca e relate o que aconteceu nas issues do projeto no GitHub.")}</p>
            <footer><button className="btn primary" onClick={() => setResult(null)}>{t("Fechar")}</button></footer>
          </div>
        </Modal>
      )}
    </div>
  );
}

const readFile = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(f); });

function AnimPicker({ all, base, onClose, onPick, onPreview }: { all: string[] | null; base: string; onClose: () => void; onPick: (f: string) => void; onPreview: (f: string) => void }) {
  const [q, setQ] = useState(base);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (all ?? []).filter((a) => !t || a.includes(t)).slice(0, 300);
  }, [all, q]);
  return (
    <Modal title={t("Trocar animação")} icon="animation" onClose={onClose} wide>
      <div className="col" style={{ gap: 10 }}>
        <div className="search-bar"><Icon name="search" /><input className="input dense" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar: uul0101, walk, death…")} /></div>
        <p className="faint small">{t("Animações de qualquer unidade do jogo. Funcionam melhor entre unidades com os mesmos ossos (mesma família de modelo).")}</p>
        <div className="anim-list">
          {all === null ? <div className="bar indeterminate"><i /></div> : list.map((a) => (
            <div key={a} className="anim-row">
              <Icon name="animation" size={18} />
              <span className="grow mono small">{a}</span>
              <button className="btn sm text" onClick={() => onPreview(a)}><Icon name="play_arrow" size={16} /></button>
              <button className="btn sm" onClick={() => onPick(a)}>{t("Usar")}</button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** Galeria de armas: escolhe a unidade, vê as armas dela (dano, cadência, alcance, projétil) e copia. */
function WeaponPicker({ catalog, exclude, target, onClose, onPick }: { catalog: UnitInfo[]; exclude: string; target: number; onClose: () => void; onPick: (unit: string, src: number, d: UnitDetails) => void }) {
  const [q, setQ] = useState("");
  const [unit, setUnit] = useState<string | null>(null);
  const [d, setD] = useState<UnitDetails | null | undefined>(undefined);
  useEffect(() => {
    if (!unit) return;
    setD(undefined);
    void api.unitDetails(unit).then(setD).catch(() => setD(null));
  }, [unit]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return catalog.filter((u) => u.id !== exclude && (!t || `${u.name} ${u.id} ${u.faction} ${u.role}`.toLowerCase().includes(t))).slice(0, 200);
  }, [catalog, q, exclude]);
  const leaf = (path: string) => { const l = d?.leaves.find((x) => x.path === path); return l ? (l.kind === "number" ? l.number : l.text) : null; };
  return (
    <Modal title={target ? t("Trocar a arma {n}", { n: target }) : t("Adicionar arma")} icon="gps_fixed" onClose={onClose} wide>
      <div className="wpick">
        <div className="col" style={{ gap: 8, minHeight: 0 }}>
          <div className="search-bar"><Icon name="search" /><input className="input dense" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar unidade: artilharia, cybran, ucl0103…")} /></div>
          <div className="anim-list">{list.map((u) => (
            <button key={u.id} className="pick row-pick" aria-pressed={unit === u.id} onClick={() => setUnit(u.id)}>
              <span className={`fac fac-${u.faction.toLowerCase()}`}>{u.faction.slice(0, 1)}</span>
              <span className="grow"><b>{u.name}</b> <small className="faint">{u.id}</small></span>
              <small className="faint">{u.role}</small>
            </button>
          ))}</div>
        </div>
        <div className="col" style={{ gap: 8, minHeight: 0, overflow: "auto" }}>
          {!unit ? <p className="faint small">{t("Escolha uma unidade para ver as armas dela.")}</p> : d === undefined ? <div className="bar indeterminate"><i /></div> : !d ? <p className="faint small">{t("Não deu para ler essa unidade.")}</p> : d.weapons.length === 0 ? <p className="faint small">{t("{name} não tem armas.", { name: d.name })}</p> : d.weapons.map((w) => {
            const dmg = Number(leaf(`Weapon.${w.index}.Damage`) ?? 0), rof = Number(leaf(`Weapon.${w.index}.RateOfFire`) ?? 0);
            const proj = String(leaf(`Weapon.${w.index}.ProjectileId`) ?? "").split("/").filter(Boolean).slice(-2, -1)[0];
            return (
              <div key={w.index} className="wcard">
                <div className="row" style={{ gap: 8 }}><Icon name={w.dummy ? "block" : "gps_fixed"} size={18} /><b className="grow">{w.label}</b>{w.dummy && <span className="chip">{t("efeito")}</span>}</div>
                <div className="wstats">
                  <span><small>{t("Dano")}</small><b>{fmt(dmg)}</b></span><span><small>{t("Tiros/s")}</small><b>{fmt(rof)}</b></span>
                  <span><small>{t("Dano/s")}</small><b>{fmt(dmg * rof)}</b></span><span><small>{t("Alcance")}</small><b>{fmt(Number(leaf(`Weapon.${w.index}.MaxRadius`) ?? 0))}</b></span>
                </div>
                {proj && <small className="faint mono">{t("projétil: {name}", { name: proj })}</small>}
                <button className="btn sm primary" onClick={() => onPick(d.id, w.index, d)}><Icon name="content_copy" size={15} /> {target ? t("Usar no lugar") : t("Adicionar")}</button>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

/** Linha do tempo: ossos à esquerda, quadros-chave (losangos) no tempo, edição do quadro escolhido. */
function AnimTimeline({ draft, setDraft, bones, fields, time, setTime, playing, setPlaying, busy, onSave, onClose }: {
  draft: AnimDraft; setDraft: (d: AnimDraft) => void; bones: string[]; fields: string[]; time: number; setTime: (t: number) => void;
  playing: boolean; setPlaying: (v: boolean) => void; busy: boolean; onSave: () => void; onClose: () => void;
}) {
  const [selBone, setSelBone] = useState(draft.keys[0]?.bone ?? bones[0]);
  const [selKey, setSelKey] = useState<number | null>(0);
  const track = useRef<HTMLDivElement>(null);
  const boneList = useRef<HTMLDivElement>(null);
  const dragK = useRef<number | null>(null);
  const dur = Math.max(0.05, draft.duration);
  const keys = draft.keys;
  const set = (patch: Partial<AnimDraft>) => setDraft({ ...draft, ...patch });
  const setKey = (i: number, k: Partial<AnimKey>) => set({ keys: keys.map((x, j) => (j === i ? { ...x, ...k } : x)) });
  const used = new Set(keys.map((k) => k.bone));
  const rows = [...bones.filter((b) => used.has(b)), ...bones.filter((b) => !used.has(b))];
  const tAt = (clientX: number) => { const r = track.current!.getBoundingClientRect(); return Math.max(0, Math.min(dur, Math.round(((clientX - r.left) / r.width) * dur * 100) / 100)); };
  const addKey = () => {
    const s = sampleKey(keys, selBone, time);
    const k: AnimKey = { bone: selBone, time: Math.round(time * 100) / 100, ...s };
    const list = [...keys.filter((x) => !(x.bone === selBone && Math.abs(x.time - k.time) < 0.01)), k];
    set({ keys: list });
    setSelKey(list.length - 1);
  };
  const sk = selKey !== null ? keys[selKey] : null;
  return (
    <div className="timeline">
      <div className="tl-head">
        <Icon name="animation" size={18} />
        <input className="pinput" style={{ width: 160 }} value={draft.name} onChange={(e) => set({ name: e.target.value.replace(/[^\w-]/g, "_").slice(0, 40) })} aria-label={t("Nome")} />
        <select className="pinput" value={draft.field} onChange={(e) => set({ field: e.target.value })} aria-label={t("Usar como")}>
          {[...new Set([...fields, "Display.AnimationIdle", "Display.AnimationWalk", "Display.AnimationDeath", "Display.AnimationActivate", "Display.AnimationFire", "Display.AnimationBuild"])].map((f) => <option key={f} value={f}>{t("Usar como: {name}", { name: animLabel(f) })}</option>)}
        </select>
        <label className="row small" style={{ gap: 4 }}>{t("Duração")} <input className="pinput" style={{ width: 60 }} type="number" step={0.1} min={0.1} max={60} value={draft.duration} onChange={(e) => { const v = Math.max(0.1, Number(e.target.value) || 1); set({ duration: v, keys: keys.map((k) => ({ ...k, time: Math.min(k.time, v) })) }); }} />s</label>
        <select className="pinput" value="" onChange={(e) => { const t = ANIM_TEMPLATES.find((x) => x.id === e.target.value); if (t) { set({ keys: t.make(selBone, bones), duration: t.duration, field: t.field }); setSelKey(0); } }} aria-label={t("Modelo")}>
          <option value="">{t("Começar de um modelo…")}</option>
          {ANIM_TEMPLATES.map((tp) => <option key={tp.id} value={tp.id}>{t("{name} (osso {bone})", { name: t(tp.label), bone: selBone })}</option>)}
        </select>
        <span className="grow" />
        <button className="btn sm icon-btn" onClick={() => setPlaying(!playing)} aria-label={playing ? t("Pausar") : t("Tocar")}><Icon name={playing ? "pause" : "play_arrow"} size={18} /></button>
        <span className="mono small">{time.toFixed(2)}s</span>
        <button className="btn sm" onClick={addKey}><Icon name="add" size={15} /> {t("Quadro em {bone}", { bone: selBone })}</button>
        <button className="btn sm primary" disabled={busy || !keys.length || !draft.name.trim()} onClick={onSave}><Icon name="save" size={15} /> {busy ? t("Salvando…") : t("Salvar animação")}</button>
        <button className="btn sm icon-btn" onClick={onClose} aria-label={t("Fechar")}><Icon name="close" size={18} /></button>
      </div>
      <div className="tl-body">
        <div className="tl-bones" ref={boneList} onScroll={(e) => { if (track.current) track.current.scrollTop = e.currentTarget.scrollTop; }}>
          {rows.map((b) => <button key={b} className={`tl-bone ${b === selBone ? "on" : ""} ${used.has(b) ? "used" : ""}`} onClick={() => setSelBone(b)}>{b}</button>)}
        </div>
        <div className="tl-tracks" ref={track} onScroll={(e) => { if (boneList.current) boneList.current.scrollTop = e.currentTarget.scrollTop; }}
          onPointerDown={(e) => { if ((e.target as HTMLElement).dataset.key) return; setTime(tAt(e.clientX)); }}
          onPointerMove={(e) => { if (dragK.current !== null && e.buttons & 1) setKey(dragK.current, { time: tAt(e.clientX) }); }}
          onPointerUp={() => { dragK.current = null; }}>
          <div className="tl-ruler">{Array.from({ length: 11 }, (_, i) => <span key={i} style={{ left: `${i * 10}%` }}>{((dur * i) / 10).toFixed(dur < 2 ? 2 : 1)}</span>)}</div>
          {rows.map((b) => (
            <div key={b} className={`tl-row ${b === selBone ? "on" : ""}`}>
              {keys.map((k, i) => k.bone === b && (
                <button key={i} data-key="1" className={`tl-key ${selKey === i ? "on" : ""}`} style={{ left: `${(k.time / dur) * 100}%` }} title={`${k.time.toFixed(2)}s`}
                  onPointerDown={(e) => { e.stopPropagation(); track.current?.setPointerCapture(e.pointerId); dragK.current = i; setSelKey(i); setSelBone(b); setTime(k.time); }} />
              ))}
            </div>
          ))}
          <div className="tl-head-line" style={{ left: `${(time / dur) * 100}%` }} />
        </div>
        <div className="tl-key-edit">
          {sk ? <>
            <b className="small">{sk.bone} · {sk.time.toFixed(2)}s</b>
            {(["X", "Y", "Z"] as const).map((ax, a) => (
              <label key={`r${ax}`} className="range" style={{ gridTemplateColumns: "56px 1fr 44px" }}><span>{t("Girar {axis}", { axis: ax })}</span>
                <input type="range" min={-180} max={180} value={sk.rot[a]} onChange={(e) => { const r = [...sk.rot] as [number, number, number]; r[a] = Number(e.target.value); setKey(selKey!, { rot: r }); }} /><output>{sk.rot[a]}°</output></label>
            ))}
            {(["X", "Y", "Z"] as const).map((ax, a) => (
              <label key={`p${ax}`} className="range" style={{ gridTemplateColumns: "56px 1fr 44px" }}><span>{t("Mover {axis}", { axis: ax })}</span>
                <input type="range" min={-1} max={1} step={0.01} value={sk.pos[a]} onChange={(e) => { const r = [...sk.pos] as [number, number, number]; r[a] = Number(e.target.value); setKey(selKey!, { pos: r }); }} /><output>{sk.pos[a]}</output></label>
            ))}
            <button className="btn sm text" onClick={() => { set({ keys: keys.filter((_, j) => j !== selKey) }); setSelKey(null); }}><Icon name="delete" size={15} /> {t("Apagar quadro")}</button>
          </> : <p className="faint small">{t("Escolha um losango na linha do tempo, ou clique em \"Quadro\" para criar um no instante atual. Arraste os losangos para mudar o tempo.")}</p>}
        </div>
      </div>
    </div>
  );
}
