// Editor de modelos 3D em aba própria: formas básicas, mover/girar/escalar com encaixe, grupos
// (= ossos no jogo), vértices, cores e texturas por peça, importar OBJ/GLB, exportar para o jogo.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ContextMenu, Panel, ProjectBar, PropertyGrid, Ribbon, RibbonButton, RibbonGroup, StatusBar, StudioLayout, Tree,
  useActiveEditor, useHotkeys, type CtxItem, type Prop, type TreeNode,
} from "../../components/studio/kit";
import { Empty, Icon, Modal } from "../../components/ui";
import { api, pickFile, pickSave } from "../../lib/api";
import { errorText, useStore } from "../../lib/store";
import type { LayerSet } from "../../lib/types";
import { useProject } from "../../lib/useProject";
import {
  defaultMaterial, migrateModel, newId, newModelDoc, newPart, PART_DEFAULTS, PART_ICON, PART_LABEL,
  type ModelDoc, type ModelGroup, type ModelPart, type PartType, type Vec3,
} from "./docs";
import { bake, boneName, exportFile, groupPivot, importMesh, toEditableMesh, type BakeStats, type TexResolver } from "./modelGeo";
import type { GizmoMode, TRS } from "./ModelViewport";

const ModelViewport = lazy(() => import("./ModelViewport"));

const SWATCHES = ["#9aa7b4", "#5b6470", "#2c2f33", "#e8e8e8", "#56645a", "#8b6b3d", "#c8352b", "#2f6fd6", "#d9a227", "#7bd88f", "#ffb800", "#ffffff"];
const PARAM_LABEL: Record<string, string> = { w: "Largura", h: "Altura", d: "Profundidade", r: "Raio", rt: "Raio de cima", rb: "Raio de baixo", tube: "Espessura", seg: "Segmentos" };

export default function ModelStudio({ id }: { id: string }) {
  const p = useProject<ModelDoc>(id, migrateModel, newModelDoc());
  const active = useActiveEditor();
  const doc = p.doc;
  const { toast, run } = useStore.getState();
  const [ribbon, setRibbon] = useState("home");
  const [sel, setSel] = useState<string[]>([]);
  const [mode, setMode] = useState<GizmoMode>("translate");
  const [snapMove, setSnapMove] = useState<number | null>(0.25);
  const [snapRot, setSnapRot] = useState<number | null>(15);
  const [space, setSpace] = useState<"world" | "local">("world");
  const [wire, setWire] = useState(false);
  const [teamColor, setTeamColor] = useState("#2f6fd6");
  const [vertex, setVertex] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [gameTex, setGameTex] = useState<LayerSet[] | null>(null);
  const [texPick, setTexPick] = useState(false);
  const [report, setReport] = useState<BakeStats | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const snapshot = useRef<(() => string | null) | null>(null);
  const focus = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const clipboard = useRef<ModelPart[]>([]);

  // texturas: arquivo do projeto ou textura do jogo (cache por referência)
  const texCache = useRef(new Map<string, Promise<string | null>>());
  const resolveTex: TexResolver = useCallback((t) => {
    const key = `${t.source}:${t.ref}`;
    if (!texCache.current.has(key)) {
      texCache.current.set(key, (t.source === "asset" ? api.creationAsset(id, t.ref) : api.gameTexture(t.ref, 512)).catch(() => null));
    }
    return texCache.current.get(key)!;
  }, [id]);

  const selParts = useMemo(() => doc.parts.filter((x) => sel.includes(x.id)), [doc.parts, sel]);
  const one = selParts.length === 1 ? selParts[0] : null;
  const selGroup = sel.length === 1 && sel[0].startsWith("g:") ? doc.groups.find((g) => g.id === sel[0].slice(2)) ?? null : null;
  const partIds = selParts.map((x) => x.id);

  useEffect(() => { if (mode !== "vertex") setVertex(null); }, [mode, one?.id]);

  // ------------------------------------------------------------ edição
  const update = (fn: (d: ModelDoc) => ModelDoc, amend = false) => (amend ? p.amend : p.commit)(fn);
  const patchParts = (ids: string[], fn: (q: ModelPart) => ModelPart, amend = false) =>
    update((d) => ({ ...d, parts: d.parts.map((q) => (ids.includes(q.id) ? fn(q) : q)) }), amend);

  const addPart = (type: Exclude<PartType, "mesh">) => {
    const q = newPart(type, { group: selGroup?.id ?? one?.group ?? null });
    // coloca ao lado da seleção, para não nascer dentro de outra peça
    if (one) q.pos = [one.pos[0] + 2.5, q.pos[1], one.pos[2]];
    update((d) => ({ ...d, parts: [...d.parts, { ...q, name: uniqueName(d, q.name) }] }));
    setSel([q.id]);
    setMode("translate");
  };

  const duplicate = () => {
    if (!selParts.length) return;
    const copies = selParts.map((q) => ({ ...q, id: newId(), name: uniqueName(doc, q.name), pos: [q.pos[0] + 1, q.pos[1], q.pos[2] + 1] as Vec3 }));
    update((d) => ({ ...d, parts: [...d.parts, ...copies] }));
    setSel(copies.map((c) => c.id));
  };
  const remove = () => {
    if (selGroup) {
      update((d) => ({ ...d, groups: d.groups.filter((g) => g.id !== selGroup.id).map((g) => (g.parent === selGroup.id ? { ...g, parent: selGroup.parent } : g)), parts: d.parts.map((q) => (q.group === selGroup.id ? { ...q, group: selGroup.parent } : q)) }));
      setSel([]);
      return;
    }
    if (!partIds.length) return;
    update((d) => ({ ...d, parts: d.parts.filter((q) => !partIds.includes(q.id)) }));
    setSel([]);
  };
  const group = () => {
    if (!selParts.length) return;
    const g: ModelGroup = { id: newId("g"), name: uniqueGroup(doc, "Grupo"), parent: selParts[0].group ?? null };
    update((d) => ({ ...d, groups: [...d.groups, g], parts: d.parts.map((q) => (partIds.includes(q.id) ? { ...q, group: g.id } : q)) }));
    setSel([`g:${g.id}`]);
  };
  const ungroup = () => {
    const gid = selGroup?.id ?? one?.group;
    if (!gid) return;
    const g = doc.groups.find((x) => x.id === gid);
    update((d) => ({ ...d, groups: d.groups.filter((x) => x.id !== gid).map((x) => (x.parent === gid ? { ...x, parent: g?.parent ?? null } : x)), parts: d.parts.map((q) => (q.group === gid ? { ...q, group: g?.parent ?? null } : q)) }));
  };
  const copy = () => { clipboard.current = selParts.map((q) => structuredClone(q)); };
  const paste = () => {
    if (!clipboard.current.length) return;
    const copies = clipboard.current.map((q) => ({ ...q, id: newId(), pos: [q.pos[0] + 1.5, q.pos[1], q.pos[2]] as Vec3 }));
    update((d) => ({ ...d, parts: [...d.parts, ...copies] }));
    setSel(copies.map((c) => c.id));
  };

  const onTransform = useCallback((u: Record<string, TRS>, phase: "start" | "move" | "end") => {
    if (phase === "start") return;
    // o primeiro movimento cria um passo no histórico, o resto continua nele
    const fn = (d: ModelDoc) => ({ ...d, parts: d.parts.map((q) => (u[q.id] ? { ...q, ...u[q.id] } : q)) });
    if (phase === "move" && !dragging.current) { dragging.current = true; p.commit(fn); }
    else p.amend(fn);
    if (phase === "end") dragging.current = false;
  }, [p]);
  const dragging = useRef(false);

  const onVertexMove = useCallback((partId: string, index: number, local: Vec3, phase: "start" | "move" | "end") => {
    if (phase === "start") return;
    const fn = (d: ModelDoc) => ({
      ...d, parts: d.parts.map((q) => {
        if (q.id !== partId || !q.mesh) return q;
        const positions = q.mesh.positions.slice();
        positions.splice(index * 3, 3, ...local);
        return { ...q, mesh: { ...q.mesh, positions } };
      }),
    });
    if (phase === "move" && !dragging.current) { dragging.current = true; p.commit(fn); }
    else p.amend(fn);
    if (phase === "end") dragging.current = false;
  }, [p]);

  const startVertexMode = () => {
    if (!one) { toast("info", "Selecione uma peça para editar os vértices."); return; }
    if (one.type !== "mesh") {
      const edited = toEditableMesh(one);
      patchParts([one.id], () => edited);
      toast("info", `"${one.name}" virou uma malha editável. Clique num ponto e arraste o gizmo.`);
    }
    setMode("vertex");
  };

  const importModel = async (file: File) => {
    try {
      const m = await importMesh(file);
      const q: ModelPart = { ...newPart("box"), type: "mesh", name: file.name.replace(/\.[^.]+$/, ""), params: {}, mesh: { positions: m.positions, indices: m.indices, uvs: m.uvs }, pos: [0, 0, 0] };
      update((d) => ({ ...d, parts: [...d.parts, q] }));
      setSel([q.id]);
      toast("ok", `${file.name} importado (${m.triangles.toLocaleString("pt-BR")} triângulos).`);
      if (m.triangles > 20000) toast("info", "Modelo pesado: o jogo aceita até 65536 vértices por modelo. Prefira versões simplificadas.");
    } catch (e) { toast("error", errorText(e)); }
  };

  const importImage = async (file: File) => {
    if (!partIds.length) { toast("info", "Selecione as peças que vão receber a textura."); return; }
    if (file.size > 16 << 20) { toast("error", "Imagem grande demais (máximo 16 MB)."); return; }
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
    const name = await api.creationAssetPut(id, file.name, data);
    patchParts(partIds, (q) => ({ ...q, material: { ...q.material, texture: { source: "asset", ref: name }, color: "#ffffff" } }));
  };

  // ------------------------------------------------------------ exportar
  const doBake = async () => {
    setBusy("bake");
    try { return await bake(doc, resolveTex); } finally { setBusy(null); }
  };
  const prepare = async () => {
    try {
      const { baked, stats } = await doBake();
      setReport(stats);
      const r = await run(`model:${id}`, () => api.modelPrepare(id, baked), "Modelo pronto para o jogo: já dá para usar em mapas e tropas.");
      if (r?.warnings.length) setReport({ ...stats, warnings: [...stats.warnings, ...r.warnings] });
      await save();
    } catch (e) { toast("error", errorText(e)); }
  };
  const exportAs = async (format: "obj" | "glb") => {
    try {
      const { baked } = await doBake();
      const blob = await exportFile(baked, format);
      const name = `${(p.meta?.name ?? "modelo").replace(/[^\w-]+/g, "_")}.${format}`;
      const dest = await pickSave(name, [{ name: format.toUpperCase(), extensions: [format] }]);
      if (dest) {
        // o app grava pelo núcleo (fora do navegador não há caminho de disco)
        const data = await blobToDataUrl(blob);
        await api.creationAssetPut(id, name, data);
        await api.creationAssetCopy(id, name, dest);
        toast("ok", `Exportado: ${dest}`);
      } else if (!("__TAURI_INTERNALS__" in window)) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
      }
    } catch (e) { toast("error", errorText(e)); }
  };
  const exportGame = async () => {
    try {
      const dir = await pickFile([], true);
      if (!dir) return;
      const { baked } = await doBake();
      const files = await run(`model:${id}`, () => api.modelExportGame(baked, dir, p.meta?.name ?? "modelo"));
      if (files) toast("ok", `${files.length} arquivos gravados em ${dir}`);
    } catch (e) { toast("error", errorText(e)); }
  };
  const validate = async () => {
    try { const { stats } = await doBake(); setReport(stats); } catch (e) { toast("error", errorText(e)); }
  };

  const save = async () => p.save({ thumb: snapshot.current?.() ?? null });

  useHotkeys(active, {
    "ctrl+s": () => void save(),
    "ctrl+z": p.undo, "ctrl+y": p.redo, "ctrl+shift+z": p.redo,
    "ctrl+d": duplicate, "ctrl+g": group, "ctrl+shift+g": ungroup,
    "ctrl+c": copy, "ctrl+v": paste,
    "ctrl+a": () => setSel(doc.parts.map((q) => q.id)),
    delete: remove, backspace: remove,
    q: () => setMode("select"), w: () => setMode("translate"), e: () => setMode("rotate"), r: () => setMode("scale"),
    v: startVertexMode, f: () => focus.current?.(),
    escape: () => { setSel([]); setVertex(null); },
  });

  // ------------------------------------------------------------ explorador
  const nodes = useMemo<TreeNode[]>(() => {
    const partNode = (q: ModelPart): TreeNode => ({ id: q.id, label: q.name, icon: PART_ICON[q.type], color: q.material.color, hidden: !!q.hidden, locked: !!q.locked, detail: q.material.team ? "time" : undefined });
    const groupNode = (g: ModelGroup): TreeNode => ({
      id: `g:${g.id}`, label: g.name, icon: "folder_special", color: "#f2b33d", hidden: !!g.hidden, detail: `osso ${boneName(g.name)}`,
      children: [...doc.groups.filter((x) => x.parent === g.id).map(groupNode), ...doc.parts.filter((q) => q.group === g.id).map(partNode)],
    });
    return [{
      id: "root", label: p.meta?.name ?? "Modelo", icon: "view_in_ar", color: "#5aa9e6", detail: `${doc.parts.length} peças`,
      children: [...doc.groups.filter((g) => !g.parent || !doc.groups.some((x) => x.id === g.parent)).map(groupNode), ...doc.parts.filter((q) => !q.group || !doc.groups.some((g) => g.id === q.group)).map(partNode)],
    }];
  }, [doc, p.meta?.name]);

  const onTreeSelect = (nid: string, m: "set" | "toggle" | "range") => {
    if (nid === "root") { setSel([]); return; }
    if (m === "toggle") setSel((s) => (s.includes(nid) ? s.filter((x) => x !== nid) : [...s.filter((x) => !x.startsWith("g:")), nid]));
    else setSel([nid]);
  };
  // grupo selecionado: o gizmo move as peças dele (e dos subgrupos)
  const gizmoIds = useMemo(() => {
    if (!selGroup) return partIds;
    const ids = new Set<string>([selGroup.id]);
    let grew = true;
    while (grew) { grew = false; for (const g of doc.groups) if (g.parent && ids.has(g.parent) && !ids.has(g.id)) { ids.add(g.id); grew = true; } }
    return doc.parts.filter((q) => q.group && ids.has(q.group)).map((q) => q.id);
  }, [selGroup, partIds, doc]);

  // ------------------------------------------------------------ propriedades
  const sections = useMemo(() => {
    const out: { title: string; props: Prop[] }[] = [];
    if (one) {
      const set = (fn: (q: ModelPart) => ModelPart) => patchParts([one.id], fn);
      out.push({ title: "Peça", props: [
        { kind: "text", label: "Nome", value: one.name, onChange: (v) => set((q) => ({ ...q, name: v })) },
        { kind: "info", label: "Forma", value: PART_LABEL[one.type] },
        { kind: "select", label: "Grupo (osso)", value: one.group ?? "", onChange: (v) => set((q) => ({ ...q, group: v || null })), options: [{ value: "", label: "— nenhum (raiz) —" }, ...doc.groups.map((g) => ({ value: g.id, label: g.name }))] },
        { kind: "toggle", label: "Visível", value: !one.hidden, onChange: (v) => set((q) => ({ ...q, hidden: !v })) },
      ] });
      out.push({ title: "Transformação", props: [
        { kind: "vec3", label: "Posição", value: one.pos, step: 0.25, onChange: (v) => set((q) => ({ ...q, pos: v })) },
        { kind: "vec3", label: "Rotação (°)", value: one.rot, step: 15, onChange: (v) => set((q) => ({ ...q, rot: v })) },
        { kind: "vec3", label: "Escala", value: one.scale, step: 0.1, onChange: (v) => set((q) => ({ ...q, scale: v.map((x) => Math.max(0.01, x)) as Vec3 })) },
      ] });
      if (one.type !== "mesh") {
        out.push({ title: "Forma", props: Object.keys(PART_DEFAULTS[one.type]).map((k): Prop => ({
          kind: "number", label: PARAM_LABEL[k] ?? k, value: one.params[k] ?? 1, step: k === "seg" ? 1 : 0.1, min: k === "seg" ? 3 : 0.01, max: k === "seg" ? 64 : 500,
          onChange: (v) => set((q) => ({ ...q, params: { ...q.params, [k]: k === "seg" ? Math.round(v) : v } })),
        })) });
      } else {
        out.push({ title: "Malha", props: [
          { kind: "info", label: "Vértices", value: (one.mesh?.positions.length ?? 0) / 3 },
          { kind: "info", label: "Triângulos", value: (one.mesh?.indices.length ?? 0) / 3 },
          { kind: "custom", label: "Vértices", node: <button className="btn sm" onClick={startVertexMode}><Icon name="scatter_plot" size={16} /> Editar vértices</button> },
          ...(vertex !== null && one.mesh ? [{ kind: "vec3", label: `Vértice ${vertex}`, value: [one.mesh.positions[vertex * 3], one.mesh.positions[vertex * 3 + 1], one.mesh.positions[vertex * 3 + 2]] as Vec3, step: 0.05, onChange: (v: Vec3) => onVertexMove(one.id, vertex, v, "end") } as Prop] : []),
        ] });
      }
      const mt = one.material;
      out.push({ title: "Material", props: [
        { kind: "color", label: "Cor", value: mt.color, onChange: (v) => set((q) => ({ ...q, material: { ...q.material, color: v } })) },
        { kind: "custom", label: "Paleta", node: <span className="swatches">{SWATCHES.map((c) => <button key={c} style={{ background: c }} aria-label={c} onClick={() => set((q) => ({ ...q, material: { ...q.material, color: c } }))} />)}</span> },
        { kind: "custom", label: "Textura", node: (
          <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => imageInput.current?.click()}><Icon name="upload" size={15} /> Imagem</button>
            <button className="btn sm" onClick={() => { setTexPick(true); if (!gameTex) void api.mapAssets().then((a) => setGameTex(a.layers)).catch(() => setGameTex([])); }}><Icon name="texture" size={15} /> Do jogo</button>
            {mt.texture && <button className="btn sm text" onClick={() => set((q) => ({ ...q, material: { ...q.material, texture: null } }))}><Icon name="close" size={15} /></button>}
          </span>
        ) },
        ...(mt.texture ? [{ kind: "info", label: "Arquivo", value: mt.texture.ref.split("/").pop() } as Prop, { kind: "slider", label: "Repetição", value: mt.uvScale, min: 1, max: 16, onChange: (v: number) => set((q) => ({ ...q, material: { ...q.material, uvScale: v } })) } as Prop] : []),
        { kind: "slider", label: "Rugosidade", value: mt.roughness, min: 0, max: 1, step: 0.05, onChange: (v) => set((q) => ({ ...q, material: { ...q.material, roughness: v } })) },
        { kind: "slider", label: "Metal", value: mt.metalness, min: 0, max: 1, step: 0.05, onChange: (v) => set((q) => ({ ...q, material: { ...q.material, metalness: v } })) },
        { kind: "toggle", label: "Brilha no escuro", value: !!mt.emissive, onChange: (v) => set((q) => ({ ...q, material: { ...q.material, emissive: v ? q.material.color : null } })) },
        ...(mt.emissive ? [{ kind: "color", label: "Cor do brilho", value: mt.emissive, onChange: (v: string) => set((q) => ({ ...q, material: { ...q.material, emissive: v } })) } as Prop] : []),
        { kind: "toggle", label: "Cor do time", value: !!mt.team, onChange: (v) => set((q) => ({ ...q, material: { ...q.material, team: v } })), hint: "No jogo, esta peça recebe a cor do jogador (azul, vermelho…)." },
      ] });
    } else if (selGroup) {
      const set = (fn: (g: ModelGroup) => ModelGroup) => update((d) => ({ ...d, groups: d.groups.map((g) => (g.id === selGroup.id ? fn(g) : g)) }));
      const piv = groupPivot(doc, selGroup);
      out.push({ title: "Grupo (osso)", props: [
        { kind: "text", label: "Nome", value: selGroup.name, onChange: (v) => set((g) => ({ ...g, name: v })), hint: "Vira o nome do osso no jogo. Tropas usam nomes como Turret, Barrel, Muzzle01." },
        { kind: "info", label: "Nome do osso", value: boneName(selGroup.name) },
        { kind: "select", label: "Dentro de", value: selGroup.parent ?? "", onChange: (v) => set((g) => ({ ...g, parent: v || null })), options: [{ value: "", label: "— raiz —" }, ...doc.groups.filter((g) => g.id !== selGroup.id).map((g) => ({ value: g.id, label: g.name }))] },
        { kind: "vec3", label: "Pivô", value: piv, step: 0.25, onChange: (v) => set((g) => ({ ...g, pivot: v })), hint: "Ponto em volta do qual o grupo gira nas animações (ex.: o centro da torre)." },
        { kind: "custom", label: "", node: <span className="row" style={{ gap: 6 }}>{selGroup.pivot && <button className="btn sm text" onClick={() => set((g) => ({ ...g, pivot: undefined }))}>Pivô automático</button>}<button className="btn sm" onClick={ungroup}><Icon name="call_split" size={15} /> Desagrupar</button></span> },
        { kind: "toggle", label: "Visível", value: !selGroup.hidden, onChange: (v) => set((g) => ({ ...g, hidden: !v })) },
        { kind: "info", label: "Peças", value: doc.parts.filter((q) => q.group === selGroup.id).length },
      ] });
    } else if (selParts.length > 1) {
      out.push({ title: `${selParts.length} peças`, props: [
        { kind: "color", label: "Cor de todas", value: selParts[0].material.color, onChange: (v) => patchParts(partIds, (q) => ({ ...q, material: { ...q.material, color: v } })) },
        { kind: "toggle", label: "Cor do time", value: selParts.every((q) => q.material.team), onChange: (v) => patchParts(partIds, (q) => ({ ...q, material: { ...q.material, team: v } })) },
        { kind: "custom", label: "Ações", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}><button className="btn sm" onClick={group}><Icon name="folder" size={15} /> Agrupar</button><button className="btn sm" onClick={duplicate}><Icon name="content_copy" size={15} /> Duplicar</button><button className="btn sm" onClick={remove}><Icon name="delete" size={15} /> Excluir</button></span> },
      ] });
    } else {
      out.push({ title: "Modelo", props: [
        { kind: "info", label: "Peças", value: doc.parts.length },
        { kind: "info", label: "Grupos (ossos)", value: doc.groups.length + 1 },
        { kind: "text", label: "Anotações", value: doc.notes, multiline: true, onChange: (v) => update((d) => ({ ...d, notes: v })) },
        { kind: "info", label: "Dica", value: "Insira formas pela faixa \"Inserir\". Agrupe peças que se movem juntas (ex.: torre + canhão)." },
      ] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [one, selGroup, selParts, doc, vertex, gameTex]);

  if (p.status === "loading") return <div className="studio-root"><div className="bar indeterminate" style={{ margin: 30 }}><i /></div></div>;
  if (p.status === "error") return <div className="studio-root"><Empty icon="error" title="Não deu para abrir o projeto">{p.error}</Empty></div>;

  const modeBtn = (m: GizmoMode, icon: string, label: string, key: string) => <RibbonButton icon={icon} label={label} active={mode === m} onClick={() => (m === "vertex" ? startVertexMode() : setMode(m))} hint={`${label} (${key})`} />;
  const insertBtn = (t: Exclude<PartType, "mesh">) => <RibbonButton key={t} icon={PART_ICON[t]} label={PART_LABEL[t]} onClick={() => addPart(t)} color="#5aa9e6" />;
  const tris = doc.parts.reduce((n, q) => n + (q.type === "mesh" ? (q.mesh?.indices.length ?? 0) / 3 : 0), 0);

  return (
    <div className="studio-root">
      <div className="studio-top">
        <Ribbon active={ribbon} onTab={setRibbon} tabs={[{ id: "home", label: "Início" }, { id: "insert", label: "Inserir" }, { id: "material", label: "Material" }, { id: "view", label: "Exibir" }, { id: "export", label: "Exportar" }]}>
          {ribbon === "home" && <>
            <RibbonGroup label="Ferramentas">
              {modeBtn("select", "near_me", "Selecionar", "Q")}
              {modeBtn("translate", "open_with", "Mover", "W")}
              {modeBtn("rotate", "rotate_90_degrees_ccw", "Girar", "E")}
              {modeBtn("scale", "open_in_full", "Escalar", "R")}
              {modeBtn("vertex", "scatter_plot", "Vértices", "V")}
            </RibbonGroup>
            <RibbonGroup label="Encaixe">
              <div className="ribbon-stack" style={{ width: 170 }}>
                <label className="row small" style={{ gap: 6 }}><span style={{ width: 52 }}>Mover</span>
                  <select className="pinput" value={snapMove ?? 0} onChange={(e) => setSnapMove(Number(e.target.value) || null)}>
                    <option value={0}>livre</option><option value={0.1}>0,1</option><option value={0.25}>0,25</option><option value={0.5}>0,5</option><option value={1}>1</option>
                  </select></label>
                <label className="row small" style={{ gap: 6 }}><span style={{ width: 52 }}>Girar</span>
                  <select className="pinput" value={snapRot ?? 0} onChange={(e) => setSnapRot(Number(e.target.value) || null)}>
                    <option value={0}>livre</option><option value={5}>5°</option><option value={15}>15°</option><option value={45}>45°</option><option value={90}>90°</option>
                  </select></label>
              </div>
              <RibbonButton icon={space === "world" ? "public" : "my_location"} label={space === "world" ? "Mundo" : "Local"} onClick={() => setSpace((s) => (s === "world" ? "local" : "world"))} hint="Eixos do gizmo: do mundo ou da peça" />
            </RibbonGroup>
            <RibbonGroup label="Editar">
              <RibbonButton icon="content_copy" label="Duplicar" onClick={duplicate} disabled={!selParts.length} hint="Ctrl+D" />
              <RibbonButton icon="folder" label="Agrupar" onClick={group} disabled={!selParts.length} hint="Ctrl+G" />
              <RibbonButton icon="call_split" label="Desagrupar" onClick={ungroup} disabled={!selGroup && !one?.group} hint="Ctrl+Shift+G" />
              <RibbonButton icon="delete" label="Excluir" onClick={remove} disabled={!selParts.length && !selGroup} hint="Del" />
            </RibbonGroup>
            <RibbonGroup label="Vista">
              <RibbonButton icon="center_focus_strong" label="Focar" onClick={() => focus.current?.()} hint="F" />
            </RibbonGroup>
          </>}
          {ribbon === "insert" && <>
            <RibbonGroup label="Formas">{(["box", "cylinder", "sphere", "cone", "wedge", "torus", "plane", "capsule"] as const).map(insertBtn)}</RibbonGroup>
            <RibbonGroup label="Importar">
              <RibbonButton icon="file_upload" label="OBJ / GLB" onClick={() => fileInput.current?.click()} hint="Modelos de outros programas (Blender, etc.)" />
            </RibbonGroup>
          </>}
          {ribbon === "material" && <>
            <RibbonGroup label="Cor rápida">
              <span className="swatches big">{SWATCHES.map((c) => <button key={c} style={{ background: c }} aria-label={c} disabled={!partIds.length} onClick={() => patchParts(partIds, (q) => ({ ...q, material: { ...q.material, color: c } }))} />)}</span>
            </RibbonGroup>
            <RibbonGroup label="Textura">
              <RibbonButton icon="upload" label="Imagem" onClick={() => imageInput.current?.click()} disabled={!partIds.length} />
              <RibbonButton icon="texture" label="Do jogo" onClick={() => { setTexPick(true); if (!gameTex) void api.mapAssets().then((a) => setGameTex(a.layers)).catch(() => setGameTex([])); }} disabled={!partIds.length} />
              <RibbonButton icon="format_color_reset" label="Sem textura" onClick={() => patchParts(partIds, (q) => ({ ...q, material: { ...q.material, texture: null } }))} disabled={!partIds.length} />
            </RibbonGroup>
            <RibbonGroup label="Acabamento">
              <RibbonButton icon="flag" label="Cor do time" active={selParts.length > 0 && selParts.every((q) => q.material.team)} disabled={!partIds.length} onClick={() => { const on = !selParts.every((q) => q.material.team); patchParts(partIds, (q) => ({ ...q, material: { ...q.material, team: on } })); }} />
              <RibbonButton icon="light_mode" label="Brilho" active={selParts.length > 0 && selParts.every((q) => !!q.material.emissive)} disabled={!partIds.length} onClick={() => { const on = !selParts.every((q) => q.material.emissive); patchParts(partIds, (q) => ({ ...q, material: { ...q.material, emissive: on ? q.material.color : null } })); }} />
              <RibbonButton icon="restart_alt" label="Material padrão" disabled={!partIds.length} onClick={() => patchParts(partIds, (q) => ({ ...q, material: defaultMaterial() }))} />
            </RibbonGroup>
          </>}
          {ribbon === "view" && <>
            <RibbonGroup label="Exibir">
              <RibbonButton icon="grid_4x4" label="Aramado" active={wire} onClick={() => setWire((w) => !w)} />
              <RibbonButton icon="center_focus_strong" label="Focar" onClick={() => focus.current?.()} />
            </RibbonGroup>
            <RibbonGroup label="Prévia da cor do time">
              <span className="swatches big">{["#2f6fd6", "#c8352b", "#d9a227", "#3fa34d", "#8e44ad", "#e67e22"].map((c) => <button key={c} style={{ background: c, outline: teamColor === c ? "2px solid #fff" : undefined }} aria-label={c} onClick={() => setTeamColor(c)} />)}</span>
            </RibbonGroup>
          </>}
          {ribbon === "export" && <>
            <RibbonGroup label="Jogo">
              <RibbonButton icon="rocket_launch" label={busy === "bake" ? "Preparando…" : "Preparar para o jogo"} onClick={() => void prepare()} color="#a3e635" hint="Converte para os formatos do jogo e deixa disponível para mapas e tropas" disabled={!!busy} />
              <RibbonButton icon="fact_check" label="Validar" onClick={() => void validate()} disabled={!!busy} />
              <RibbonButton icon="folder_open" label="Arquivos .scm/.dds" onClick={() => void exportGame()} disabled={!!busy} />
            </RibbonGroup>
            <RibbonGroup label="Outros programas">
              <RibbonButton icon="download" label="OBJ" onClick={() => void exportAs("obj")} disabled={!!busy} />
              <RibbonButton icon="download" label="GLB" onClick={() => void exportAs("glb")} disabled={!!busy} />
            </RibbonGroup>
          </>}
        </Ribbon>
        <ProjectBar p={p} onSave={() => void save()} />
      </div>
      <StudioLayout id="model"
        left={
          <Panel title="Caixa de formas" icon="category" grow collapsible={false} id="model-toolbox">
            <div className="toolbox-grid">
              {(["box", "cylinder", "sphere", "cone", "wedge", "torus", "plane", "capsule"] as const).map((t) => (
                <button key={t} className="tool-tile" onClick={() => addPart(t)}><Icon name={PART_ICON[t]} /><span>{PART_LABEL[t]}</span></button>
              ))}
              <button className="tool-tile" onClick={() => fileInput.current?.click()}><Icon name="file_upload" /><span>Importar</span></button>
            </div>
            <div className="spanel-pad">
              <p className="faint small"><b>Grupos viram ossos</b> no jogo: para uma tropa, agrupe a torre (nome <code>Turret</code>) e o cano (<code>Barrel</code>, com a ponta <code>Muzzle01</code>) como no modelo original.</p>
              <p className="faint small">Atalhos: Q selecionar · W mover · E girar · R escalar · V vértices · F focar · Ctrl+D duplicar · Ctrl+G agrupar.</p>
            </div>
          </Panel>
        }
        center={
          <div className="viewport">
            <Suspense fallback={<div className="bar indeterminate" style={{ margin: 20 }}><i /></div>}>
              <ModelViewport doc={doc} selected={gizmoIds} mode={mode} snap={{ move: snapMove, rot: snapRot, scale: 0.05 }} space={space}
                resolveTex={resolveTex} teamColor={teamColor} wireframe={wire}
                onPick={(pid, add) => { if (!pid) { if (!add) setSel([]); return; } setSel((s) => (add ? (s.includes(pid) ? s.filter((x) => x !== pid) : [...s.filter((x) => !x.startsWith("g:")), pid]) : [pid])); }}
                onTransform={onTransform} vertex={vertex} onVertexPick={setVertex} onVertexMove={onVertexMove}
                snapshotRef={snapshot} focusRef={focus} />
            </Suspense>
            <div className="viewport-overlay">
              <span className="vp-chip"><Icon name={mode === "vertex" ? "scatter_plot" : mode === "rotate" ? "rotate_90_degrees_ccw" : mode === "scale" ? "open_in_full" : mode === "select" ? "near_me" : "open_with"} size={15} />
                {mode === "vertex" ? (vertex === null ? "Clique num ponto para escolher o vértice" : `Vértice ${vertex}: arraste o gizmo`) : "Clique numa peça para selecionar; Shift soma"}</span>
            </div>
            {doc.parts.length === 0 && <div className="vp-hint">Comece inserindo uma forma (Inserir → Bloco) ou importe um OBJ/GLB.</div>}
          </div>
        }
        right={<>
          <Panel title="Explorador" icon="account_tree" grow id="model-explorer">
            <div className="tree-filter"><input placeholder="Filtrar peças…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar peças" /></div>
            <Tree nodes={nodes} selected={new Set(sel)} filter={filter} onSelect={onTreeSelect}
              onToggleHidden={(nid) => nid.startsWith("g:") ? update((d) => ({ ...d, groups: d.groups.map((g) => (`g:${g.id}` === nid ? { ...g, hidden: !g.hidden } : g)) })) : patchParts([nid], (q) => ({ ...q, hidden: !q.hidden }))}
              onToggleLocked={(nid) => { if (!nid.startsWith("g:")) patchParts([nid], (q) => ({ ...q, locked: !q.locked })); }}
              onContext={(nid, x, y) => { if (nid === "root") return; if (!sel.includes(nid)) setSel([nid]); setCtx({ x, y }); }} />
          </Panel>
          <Panel title="Propriedades" icon="tune" grow id="model-props"><PropertyGrid sections={sections} /></Panel>
        </>}
      />
      <StatusBar>
        <span><b>{doc.parts.length}</b> peças · <b>{doc.groups.length}</b> grupos{tris ? ` · ${tris.toLocaleString("pt-BR")} triângulos importados` : ""}</span>
        <span className="grow" />
        {selParts.length > 0 && <span>{selParts.length} selecionada{selParts.length > 1 ? "s" : ""}</span>}
        <span>encaixe {snapMove ?? "livre"} · {snapRot ? `${snapRot}°` : "livre"}</span>
      </StatusBar>

      <input ref={fileInput} type="file" accept=".obj,.glb,.gltf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importModel(f); e.target.value = ""; }} />
      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importImage(f); e.target.value = ""; }} />

      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={[
        { icon: "content_copy", label: "Duplicar", shortcut: "Ctrl+D", onClick: duplicate, disabled: !selParts.length },
        { icon: "folder", label: "Agrupar", shortcut: "Ctrl+G", onClick: group, disabled: !selParts.length },
        { icon: "call_split", label: "Desagrupar", onClick: ungroup, disabled: !selGroup && !one?.group },
        { icon: "center_focus_strong", label: "Focar", shortcut: "F", onClick: () => focus.current?.() },
        "-",
        { icon: "delete", label: "Excluir", shortcut: "Del", danger: true, onClick: remove },
      ] as (CtxItem | "-")[]} />}

      {texPick && (
        <Modal title="Textura do jogo" icon="texture" onClose={() => setTexPick(false)} wide>
          <p className="muted small">Texturas de chão dos mapas do jogo (repetem bem). A cor da peça tinge a textura: use branco para a cor original.</p>
          <div className="layer-grid">
            {gameTex === null ? <div className="bar indeterminate"><i /></div> : gameTex.slice(0, 200).map((l) => (
              <button key={l.d} className="layer-tile" onClick={() => { patchParts(partIds, (q) => ({ ...q, material: { ...q.material, texture: { source: "game", ref: l.d }, color: "#ffffff", uvScale: Math.max(2, q.material.uvScale) } })); setTexPick(false); }}>
                <GameThumb path={l.d} />
                <b>{l.name.replace(/_/g, " ")}</b>
                <span className="faint small">{l.map.replace(/^SC2_/, "")}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {report && (
        <Modal title="Validação do modelo" icon="fact_check" onClose={() => setReport(null)}>
          <div className="col" style={{ gap: 10 }}>
            <div className="stat-row">
              <span><b>{report.vertices.toLocaleString("pt-BR")}</b><small>vértices (máx. 65536)</small></span>
              <span><b>{report.triangles.toLocaleString("pt-BR")}</b><small>triângulos</small></span>
              <span><b>{report.bones}</b><small>ossos</small></span>
              <span><b>{report.atlas}px</b><small>atlas de textura</small></span>
            </div>
            {report.warnings.length ? <ul className="small warn-list">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p className="small" style={{ color: "var(--ok)" }}><Icon name="check_circle" size={16} /> Tudo certo para o jogo.</p>}
            <footer><button className="btn primary" onClick={() => setReport(null)}>Fechar</button></footer>
          </div>
        </Modal>
      )}
    </div>
  );
}

function GameThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let a = true; void api.gameTexture(path, 128).then((u) => a && setUrl(u)).catch(() => {}); return () => { a = false; }; }, [path]);
  return url ? <img className="tex-thumb" src={url} alt="" width={96} height={96} /> : <span className="tex-thumb empty" style={{ width: 96, height: 96 }}><Icon name="texture" /></span>;
}

function uniqueName(d: ModelDoc, base: string) {
  const names = new Set(d.parts.map((q) => q.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}
function uniqueGroup(d: ModelDoc, base: string) {
  const names = new Set(d.groups.map((g) => g.name));
  for (let i = 1; ; i++) if (!names.has(`${base}${i}`)) return `${base}${i}`;
}
const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });
