// Backend simulado para rodar a interface no navegador (npm run dev) sem Tauri.
// Os dados imitam uma instalação real com alguns mods da comunidade.

import type * as T from "./types";

type Listener = (p: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
export const mockEvents = {
  on(name: string, cb: Listener) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(cb);
    return () => listeners.get(name)?.delete(cb);
  },
  emit(name: string, p: unknown) {
    listeners.get(name)?.forEach((cb) => cb(p));
  },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sha = (s: string) => Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(s.charCodeAt(i % s.length) * (i + 7)) % 16]).join("");

function manifest(id: string, name: string, version: string, category: T.Category, files: string[], extra: Partial<T.Manifest> = {}): T.Manifest {
  return {
    schema: 1, id, name, version, category, authors: [], description: "", tags: [], requiresDlc: false,
    files: files.map((f) => ({ name: f, sha256: sha(f + version), size: 2_000_000 + f.length * 91_000 })),
    dependencies: [], conflicts: [], multiplayer: "sync", source: { kind: "local" }, installedAt: new Date().toISOString(),
    ...extra,
  };
}

const mods: T.Manifest[] = [
  manifest("storm", "STORM Rework", "3.1.1", "gameplay", ["zz_STORM.scd", "_modsupport_v7.scd"], {
    authors: ["Comunidade STORM"], requiresDlc: true, source: { kind: "hub", hubId: "storm" },
    description: "Rework completo de economia e pesquisa, mantendo o ritmo do SC2.",
  }),
  manifest("supcom-2020", "Supreme Commander 2 0 2 0", "2.0.4", "gameplay", ["lua.scd", "z_lua_dlc1.scd"], {
    description: "Antigo SupCom 2013: novas unidades, balanceamento e IA.", requiresDlc: true, conflicts: ["storm"],
  }),
  manifest("kael-balance", "Kael's Balance Mod", "0.4.0", "balance", ["_kael_balance.scd"], { authors: ["KaelAlexis"] }),
  manifest("littlepatch", "LittlePatch", "2018.9.1", "fixes", ["zz_littlepatch.scd"], {
    description: "Corrige atalhos de habilidades e melhora as hotkeys.", authors: ["GeekyRodent"],
  }),
  manifest("kael-maps", "Kael's MapPack", "0.4.0", "maps", ["_4v4_mappack_by_kael.scd"]),
  manifest("hud-safira", "HUD Safira", "1.2.0", "ui", ["zz_cp_skin_safira.scd"], { multiplayer: "local", source: { kind: "studio" } }),
];

let profiles: T.ProfileSet = {
  active: "padrao",
  profiles: [
    { id: "padrao", name: "Padrão", notes: "", mods: [
      { id: "storm", enabled: true }, { id: "littlepatch", enabled: true }, { id: "kael-maps", enabled: true },
      { id: "hud-safira", enabled: true }, { id: "kael-balance", enabled: false },
    ] },
    { id: "classico", name: "Clássico (sem mods)", notes: "", mods: [] },
    { id: "sc2020", name: "SupCom 2020", notes: "", mods: [{ id: "supcom-2020", enabled: true }] },
  ],
};

let settings: T.Settings = {
  gamePath: null, launchMode: "steam", launchArgs: [], applyBeforeLaunch: true, restoreOnExit: false,
  hubUrls: ["https://hub.exemplo.com/index.json"], pythonPath: null, checkModUpdates: true, onboarded: true,
  serverUrl: "http://localhost:8787", nickname: "Rique", checkAppUpdates: true, keepLargeAddress: false, showcaseUnit: null, showcase: true,
};

const game: T.GameInstall = {
  root: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2",
  gamedata: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2\\gamedata",
  exe: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2\\bin\\SupremeCommander2.exe",
  store: "steam",
};

let deployed: string[] = ["storm", "littlepatch", "kael-maps"];

const mem = { limitMb: 2048 };
function memStatus(): T.MemoryStatus {
  return { system: { totalMb: 16_303, availableMb: 9_120 }, limitMb: mem.limitMb, recommendedMb: 4096, choices: [2048, 2560, 3072, 3584, 4096], laa: laaStatus() };
}
function active() { return profiles.profiles.find((p) => p.id === profiles.active)!; }
function enabledIds() { return active().mods.filter((m) => m.enabled).map((m) => m.id); }
function plan(): T.Plan {
  const want = enabledIds();
  const add = want.filter((id) => !deployed.includes(id)).flatMap((id) => mods.find((m) => m.id === id)?.files.map((f) => f.name) ?? []);
  const remove = deployed.filter((id) => !want.includes(id)).flatMap((id) => mods.find((m) => m.id === id)?.files.map((f) => f.name) ?? []);
  const warnings = want.includes("storm") && want.includes("supcom-2020") ? ["\"Supreme Commander 2 0 2 0\" declara conflito com \"storm\""] : [];
  return { add, replace: [], remove, restore: [], unchanged: [], warnings };
}

async function progress(task: string, steps: string[]) {
  for (let i = 0; i < steps.length; i++) {
    mockEvents.emit("cp://progress", { task, step: i + 1, total: steps.length, message: steps[i] });
    await sleep(220);
  }
}

const hubIndex: T.HubIndex = {
  schema: 1, name: "Hub da comunidade SC2", sourceUrl: settings.hubUrls[0], updatedAt: "2026-10-20T12:00:00Z",
  mods: [
    { id: "storm", name: "STORM Rework", summary: "Economia e pesquisa repensadas, com novas experimentais.", description: "", authors: ["Comunidade STORM"], category: "gameplay", tags: ["rework"], screenshots: [], downloads: 1840, rating: 4.7,
      versions: [{ version: "3.2.0", changelog: "Novas experimentais Illuminate; correção de desync em partidas 4v4.", requiresDlc: true, multiplayer: "sync", dependencies: [], conflicts: [], package: { url: "storm-3.2.0.zip", sha256: sha("storm320"), size: 48_000_000, kind: "zip" } }] },
    { id: "rk-balance", name: "RK PvP Balance", summary: "Balanceamento competitivo para 1v1 e 2v2.", description: "", authors: ["RK"], category: "balance", tags: ["pvp"], screenshots: [], downloads: 612, rating: 4.4,
      versions: [{ version: "1.0.0", changelog: "Primeira versão pública.", requiresDlc: true, multiplayer: "sync", dependencies: [], conflicts: [], package: { url: "rk.zip", sha256: sha("rk"), size: 3_400_000, kind: "zip" } }] },
    { id: "revamp-rve", name: "Revamp Expansion (RVE)", summary: "Conversão total: unidades do SupCom 1 e nova economia.", description: "", authors: ["Revamp Team"], category: "gameplay", tags: ["conversão total"], screenshots: [], downloads: 3920, rating: 4.8,
      versions: [{ version: "2.0.0-b1.1", changelog: "Beta 1.1 patch 2.", requiresDlc: true, multiplayer: "sync", dependencies: [], conflicts: ["storm"], package: { url: "rve.zip", sha256: sha("rve"), size: 210_000_000, kind: "zip" } }] },
    { id: "dune-rift", name: "Dune Rift (3v3)", summary: "Mapa de deserto com ponte central — feito com o SC2 Map Toolkit.", description: "", authors: ["plutonics72"], category: "maps", tags: ["3v3"], screenshots: [], downloads: 455, rating: 4.6,
      versions: [{ version: "4.0.0", changelog: "Sincronia de malha e colisão.", requiresDlc: false, multiplayer: "sync", dependencies: [], conflicts: [], package: { url: "dune.scd", sha256: sha("dune"), size: 31_000_000, kind: "scd", fileName: "_dune_rift_3v3.scd" } }] },
  ],
};

function gradientPng(hue: number): string {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createLinearGradient(0, 0, 128, 128);
  grd.addColorStop(0, `hsl(${hue},70%,55%)`);
  grd.addColorStop(1, `hsl(${(hue + 60) % 360},60%,25%)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,.6)";
  g.lineWidth = 6;
  g.strokeRect(14, 14, 100, 100);
  return c.toDataURL();
}

function cubeMesh(): T.MeshView {
  const p = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1, -0.6, 1.2, -0.6, 0.6, 1.2, -0.6, 0.6, 1.2, 0.6, -0.6, 1.2, 0.6];
  const idx = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0];
  return { positions: p, normals: p.map(() => 0), uvs: Array(16).fill(0), indices: idx, bones: [{ name: "Root", parent: -1, position: [0, 0, 0] }, { name: "Turret", parent: 0, position: [0, 1.2, 0] }],
    bboxMin: [-1, 0, -1], bboxMax: [1, 1.2, 1], version: 5, triangles: idx.length / 3, info: "" };
}

const projects: T.Project[] = [
  { id: "hud-safira", name: "HUD Safira", version: "1.2.0", description: "", category: "ui", multiplayer: "local", archiveName: "zz_hud_safira.scd", createdAt: "2026-10-20T10:00:00Z" },
];
const projectFiles: Record<string, T.ProjectFile[]> = {
  "hud-safira": [
    { path: "/lua/ui/game/economy.lua", size: 18_230, kind: "lua" },
    { path: "/textures/ui/common/game/economy-panel/bg.dds", size: 87_552, kind: "texture" },
    { path: "/units/uel0101/uel0101_lod0.scm", size: 120_220, kind: "model" },
  ],
};

const laa = { enabled: false };
function laaStatus(): T.LaaStatus {
  return { exe: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2\\bin\\SupremeCommander2.exe", is64bit: false, enabled: laa.enabled, patchedByUs: laa.enabled, revertedByUpdate: false, steamStub: false };
}
const shaderState = { reshade: false, pack: false, preset: null as string | null };
function shaderStatus(): T.ShaderStatus {
  return {
    binDir: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2\\bin",
    reshade: shaderState.reshade, reshadeVersion: shaderState.reshade ? "6.6.2" : null, foreignDll: false,
    packInstalled: shaderState.pack, packVersion: shaderState.pack ? "1.0.0" : null, updateAvailable: false,
    preset: shaderState.pack ? shaderState.preset : null,
    presets: [
      { id: "Natural", name: "Natural", description: "Mais nítido e com cores mais vivas, sem mudar o clima do jogo.", customized: false },
      { id: "Vivido", name: "Vívido", description: "Cores fortes, relevo marcado e brilho nas explosões.", customized: false },
      { id: "Cinematico", name: "Cinemático", description: "Tons quentes, contraste alto, vinheta e bloom generoso.", customized: false },
    ],
    toggleKey: "Scroll Lock", menuKey: "Home",
  };
}


// projetos de criação no navegador: guardados no localStorage (só para desenvolver a interface)
type MockProj = { meta: T.CreationMeta; doc: unknown; versions: { file: string; savedAt: string; doc: unknown }[]; assets: Record<string, string>; autosave?: unknown; thumb?: string };
const PKEY = "cp.mock.creations";
function loadProjects(): Record<string, MockProj> {
  try { return JSON.parse(localStorage.getItem(PKEY) ?? "{}"); } catch { return {}; }
}
function saveProjects(p: Record<string, MockProj>) {
  try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* sem espaço: fica só na memória */ }
}
const creationsDb = loadProjects();
function proj(id: string): MockProj {
  const p = creationsDb[id];
  if (!p) throw new Error(`projeto não encontrado: ${id}`);
  return p;
}

// Modo de depuração: dados reais do jogo exportados para /fixture (localStorage.cpFixture = "1").
// Só para conferir o editor no navegador com modelos, texturas e relevo de verdade.
const fxCache = new Map<string, Promise<unknown>>();
const fxGet = (f: string) => { let p = fxCache.get(f); if (!p) { p = fetch(`/fixture/${f}`).then((x) => x.json()); fxCache.set(f, p); } return p as Promise<Record<string, unknown>>; };
async function fixture(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  try { if (localStorage.getItem("cpFixture") !== "1") return undefined; } catch { return undefined; }
  if (cmd === "maptk_terrain3d") return fxGet("terrain3d.json");
  if (cmd === "map_assets") return fxGet("assets.json");
  if (cmd === "game_texture") { const t = await fxGet("textures.json"); return t[String(a.path)] ?? undefined; }
  if (cmd === "prop_preview") { const t = await fxGet("props.json"); const v = t[String(a.bp).toLowerCase()]; if (!v) throw new Error("o modelo dessa decoração não foi encontrado"); return v; }
  if (cmd === "creation_load" && a.id === "fixture-map") return { meta: fxMeta, doc: await fxGet("doc.json"), recoveryAt: null };
  if (cmd === "creations_list") return [fxMeta, ...Object.values(creationsDb).map((p) => p.meta)];
  if (cmd === "creation_save" || cmd === "creation_autosave" || cmd === "creation_set_thumb") return a.id === "fixture-map" ? (cmd === "creation_save" ? fxMeta : null) : undefined;
  return undefined;
}
const fxMeta: T.CreationMeta = { id: "fixture-map", kind: "map", name: "Mapa real (depuração)", description: "", createdAt: "2026-10-24T00:00:00Z", updatedAt: "2026-10-24T00:00:00Z", favorite: false, tags: [], hasThumb: false };

export async function mock<R>(cmd: string, a: Record<string, unknown>): Promise<R> {
  await sleep(120);
  const r = (v: unknown) => v as R;
  const fx = await fixture(cmd, a);
  if (fx !== undefined) return r(fx);
  switch (cmd) {
    case "creations_list": return r(Object.values(creationsDb).map((p) => p.meta).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)));
    case "creation_create": {
      const kind = a.kind as T.CreationKind, name = String(a.name).trim();
      const slug = { map: "mapa", unit: "tropa", model: "modelo" }[kind];
      const id = `${slug}-${name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32)}-${Date.now().toString(36)}`;
      const t = new Date().toISOString();
      const meta: T.CreationMeta = { id, kind, name, description: "", createdAt: t, updatedAt: t, favorite: false, tags: [], hasThumb: false };
      creationsDb[id] = { meta, doc: a.doc, versions: [], assets: {} };
      saveProjects(creationsDb);
      return r(meta);
    }
    case "creation_load": {
      const p = proj(String(a.id));
      return r({ meta: p.meta, doc: p.doc, recoveryAt: p.autosave ? new Date().toISOString() : null });
    }
    case "creation_save": {
      const p = proj(String(a.id));
      if (a.snapshot && JSON.stringify(p.doc) !== JSON.stringify(a.doc)) p.versions.unshift({ file: `${Date.now()}.json`, savedAt: new Date().toISOString(), doc: p.doc });
      p.versions = p.versions.slice(0, 40);
      p.doc = a.doc; p.autosave = undefined; p.meta.updatedAt = new Date().toISOString();
      saveProjects(creationsDb);
      return r(p.meta);
    }
    case "creation_autosave": { proj(String(a.id)).autosave = a.doc; saveProjects(creationsDb); return r(undefined); }
    case "creation_recovery": return r(proj(String(a.id)).autosave ?? null);
    case "creation_discard_recovery": { proj(String(a.id)).autosave = undefined; saveProjects(creationsDb); return r(undefined); }
    case "creation_versions": return r(proj(String(a.id)).versions.map((v) => ({ file: v.file, savedAt: v.savedAt, size: JSON.stringify(v.doc).length })));
    case "creation_restore": {
      const p = proj(String(a.id));
      const v = p.versions.find((x) => x.file === a.file);
      if (!v) throw new Error("versão não encontrada");
      p.versions.unshift({ file: `${Date.now()}.json`, savedAt: new Date().toISOString(), doc: p.doc });
      p.doc = v.doc; saveProjects(creationsDb);
      return r(v.doc);
    }
    case "creation_update": {
      const p = proj(String(a.id));
      if (typeof a.name === "string" && a.name.trim()) p.meta.name = a.name.trim();
      if (typeof a.description === "string") p.meta.description = a.description;
      if (typeof a.favorite === "boolean") p.meta.favorite = a.favorite;
      if (Array.isArray(a.tags)) p.meta.tags = a.tags as string[];
      p.meta.updatedAt = new Date().toISOString(); saveProjects(creationsDb);
      return r(p.meta);
    }
    case "creation_set_thumb": { const p = proj(String(a.id)); p.thumb = String(a.png); p.meta.hasThumb = true; saveProjects(creationsDb); return r(undefined); }
    case "creation_thumb": return r(proj(String(a.id)).thumb ?? null);
    case "creation_duplicate": {
      const p = proj(String(a.id));
      const id = `${p.meta.id}-c${Date.now().toString(36)}`;
      const t = new Date().toISOString();
      creationsDb[id] = { meta: { ...p.meta, id, name: `${p.meta.name} (cópia)`, createdAt: t, updatedAt: t }, doc: p.doc, versions: [], assets: { ...p.assets }, thumb: p.thumb };
      saveProjects(creationsDb);
      return r(creationsDb[id].meta);
    }
    case "creation_delete": { delete creationsDb[String(a.id)]; saveProjects(creationsDb); return r(undefined); }
    case "creation_asset_put": {
      const p = proj(String(a.id));
      const name = `${String(a.name).replace(/[^A-Za-z0-9._-]/g, "_")}`;
      p.assets[name] = String(a.data); saveProjects(creationsDb);
      return r(name);
    }
    case "creation_asset": {
      const d = proj(String(a.id)).assets[String(a.name)];
      if (!d) throw new Error("arquivo não encontrado");
      return r(d.startsWith("data:") ? d : `data:application/octet-stream;base64,${d}`);
    }
    case "creation_assets": return r(Object.entries(proj(String(a.id)).assets).map(([name, d]) => ({ name, size: d.length })));
    case "creation_export": return r(undefined);
    case "creation_import": throw new Error("importar projetos só funciona no app instalado");

    case "app_info": return r({ version: __APP_VERSION__, dataDir: "%APPDATA%\\io.github.riquebitt.commandproject", resourcesDir: null, os: "browser" });
    case "recover": return r(null);
    case "dashboard": {
      const p = plan();
      return r({
        game, gameRunning: false, activeProfile: profiles.active, activeProfileName: active().name,
        enabledMods: enabledIds().length, installedMods: mods.length, deployedProfile: "padrao", deployedAt: "2026-10-22T21:14:00Z",
        inSync: !p.add.length && !p.remove.length, pending: p, hasBaseline: true, unmanagedFiles: ["_osmosPack.scd"],
      } satisfies T.Dashboard);
    }
    case "get_settings": return r(settings);
    case "save_settings": settings = a.settings as T.Settings; return r(settings);
    case "set_game_path": return r(game);
    case "list_mods": {
      const act = active();
      return r(mods.map((m) => {
        const i = act.mods.findIndex((x) => x.id === m.id);
        return { manifest: m, dir: "", icon: null, enabled: i >= 0 && act.mods[i].enabled, order: i >= 0 ? i : null };
      }).sort((x, y) => (x.order ?? 999) - (y.order ?? 999)));
    }
    case "import_mod": {
      const m = manifest("importado-" + mods.length, String(a.path).split(/[\\/]/).pop() || "Mod", "1.0.0", "other", ["zz_importado.scd"]);
      mods.push(m);
      if (a.enable) active().mods.push({ id: m.id, enabled: true });
      return r(m);
    }
    case "remove_mod": {
      const i = mods.findIndex((m) => m.id === a.id);
      if (i >= 0) mods.splice(i, 1);
      profiles.profiles.forEach((p) => (p.mods = p.mods.filter((x) => x.id !== a.id)));
      return r(undefined);
    }
    case "update_mod_meta": {
      const m = mods.find((x) => x.id === a.id)!;
      Object.assign(m, a.patch as object);
      if (a.tags) m.tags = a.tags as string[];
      return r(m);
    }
    case "verify_mod": return r([]);
    case "get_profiles": return r(profiles);
    case "set_active_profile": profiles = { ...profiles, active: String(a.id) }; return r(profiles);
    case "create_profile": {
      const id = String(a.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const src = profiles.profiles.find((p) => p.id === a.copyFrom);
      profiles.profiles.push({ id, name: String(a.name), notes: "", mods: src ? structuredClone(src.mods) : [] });
      return r(profiles);
    }
    case "rename_profile": profiles.profiles.find((p) => p.id === a.id)!.name = String(a.name); return r(profiles);
    case "delete_profile":
      profiles.profiles = profiles.profiles.filter((p) => p.id !== a.id);
      if (profiles.active === a.id) profiles.active = profiles.profiles[0].id;
      return r(profiles);
    case "set_mod_enabled": {
      const act = active();
      const m = act.mods.find((x) => x.id === a.modId);
      if (m) m.enabled = Boolean(a.enabled); else act.mods.push({ id: String(a.modId), enabled: Boolean(a.enabled) });
      return r(undefined);
    }
    case "reorder_mods": {
      const act = active();
      const order = a.order as string[];
      act.mods.sort((x, y) => order.indexOf(x.id) - order.indexOf(y.id));
      return r(undefined);
    }
    case "plan_active": return r(plan());
    case "apply_active": {
      const p = plan();
      await progress("apply", [...p.remove.map((f) => `Removendo ${f}`), ...p.add.map((f) => `Instalando ${f}`), "Pronto"]);
      deployed = enabledIds();
      return r(p);
    }
    case "purge": await progress("purge", ["Restaurando arquivos originais", "Pronto"]); deployed = []; return r(plan());
    case "launch_game": {
      const p = plan();
      await progress("apply", ["Instalando arquivos", "Pronto"]);
      deployed = enabledIds();
      return r({ plan: { kind: "url", url: "steam://rungameid/40100" }, applied: p, watching: settings.restoreOnExit });
    }
    case "kill_game": return r(0);
    case "big_match_maps": {
      const ring = (n: number, size: number) => Array.from({ length: n }, (_, i) => [Math.round(size / 2 + Math.cos((i / n) * Math.PI * 2) * size * 0.4), Math.round(size / 2 + Math.sin((i / n) * Math.PI * 2) * size * 0.4)] as [number, number]);
      const map = (id: string, name: string, n: number, size: number, source = "Jogo"): T.MatchMap => ({ path: `/maps/${id.toLowerCase()}/${id.toLowerCase()}_scenario.lua`, id, name, armies: Array.from({ length: n }, (_, i) => `ARMY_${i + 1}`), starts: ring(n, size), size: [size, size], source, lobbyRisk: false });
      return r([map("CP_GUERRA24", "[24] Guerra total", 24, 2048, "Mapa Guerra total"), map("SC2_MP_801", "[8] Cerberus", 8, 1024), map("SC2_MP_402", "[4] Finn's Revenge", 4, 1024), map("SC2_MP_101", "[2] Duel", 2, 512)]);
    }
    case "big_match_preview": {
      // terreno de mentira para ver a prévia no navegador
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g"><stop offset="0" stop-color="#5f8a3a"/><stop offset="1" stop-color="#3d5f2c"/></radialGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="20" cy="40" r="7" fill="#3a6ea8"/><path d="M40 0 C38 20 50 30 46 64" stroke="#3a6ea8" stroke-width="3" fill="none"/></svg>`;
      return r("data:image/svg+xml;base64," + btoa(svg));
    }
    case "launch_big_match": {
      const p = plan();
      await progress("apply", ["Montando a partida grande", "Instalando arquivos", "Pronto"]);
      deployed = enabledIds();
      return r({ plan: { kind: "exe", exe: "SupremeCommander2.exe", args: ["/map", (a.spec as T.BigMatch).map], cwd: "bin" }, applied: p, watching: settings.restoreOnExit });
    }
    case "file_status": return r([
      { name: "_4v4_mappack_by_kael.scd", size: 41_220_118, origin: "managed", modId: "kael-maps", state: "ok" },
      { name: "_osmosPack.scd", size: 8_120_000, origin: "unmanaged", modId: null, state: "ok" },
      { name: "bp.scd", size: 3_884_012, origin: "stock", state: "ok" },
      { name: "lua.scd", size: 18_210_330, origin: "stock", state: "ok" },
      { name: "maps.scd", size: 1_482_330_120, origin: "stock", state: "ok" },
      { name: "textures.scd", size: 1_120_440_001, origin: "stock", state: "ok" },
      { name: "units.scd", size: 702_118_400, origin: "stock", state: "ok" },
      { name: "zz_STORM.scd", size: 22_420_000, origin: "managed", modId: "storm", state: "ok" },
    ] satisfies T.FileStatus[]);
    case "adopt_unmanaged": return r(manifest("osmos-pack", "osmosPack", "1.0.0", "maps", ["_osmosPack.scd"]));
    case "set_baseline_kind": return r(undefined);
    case "conflicts": return r({
      betweenMods: [{ loser: "_modsupport_v7.scd", loserMod: "storm", winner: "zz_littlepatch.scd", winnerMod: "littlepatch", count: 3, samples: ["/lua/ui/game/hotkeys.lua", "/lua/ui/game/orders.lua", "/lua/keymap/defaultkeymap.lua"] }],
      overridesStock: [{ loser: "lua.scd", loserMod: null, winner: "zz_STORM.scd", winnerMod: "storm", count: 214, samples: ["/lua/sim/unit.lua", "/lua/sim/economy.lua"] }],
      mountOrder: ["_4v4_mappack_by_kael.scd", "_modsupport_v7.scd", "lua.scd", "maps.scd", "zz_littlepatch.scd", "zz_STORM.scd"],
    } satisfies T.ConflictReport);
    case "fingerprint": return r({ code: "7F3A-91C2-0B5E", full: "7f3a91c20b5e" + "0".repeat(52), files: [] });
    case "export_sync_code": return r("CP1-fY9LTsNADIbvMuuq8mOevQMCAbuqQjNjB0W0hR0ixsFH3q1x" + "Q".repeat(40));
    case "inspect_sync_code":
    case "apply_sync_code": {
      const items: T.SyncItem[] = [
        { id: "storm", name: "STORM Rework", version: "3.1.1", state: "ok", installedVersion: "3.1.1", hubId: "storm" },
        { id: "rk-balance", name: "RK PvP Balance", version: "1.0.0", state: "missing", hubId: "rk-balance" },
      ];
      if (cmd === "inspect_sync_code") return r({ payload: { v: 1, profile: "Liga BR 2v2", mods: [] }, items });
      return r({ profileId: "sincronizado-liga-br-2v2", items });
    }
    case "hub_fetch": return r({ indexes: [hubIndex], errors: [] });
    case "hub_install": {
      const hm = hubIndex.mods.find((m) => m.id === a.modId)!;
      for (let i = 0; i <= 100; i += 10) {
        mockEvents.emit("cp://progress", { task: `hub:${hm.id}`, step: i, total: 100, message: "Baixando" });
        await sleep(90);
      }
      const v = hm.versions[0];
      const existing = mods.findIndex((m) => m.id === hm.id);
      const m = manifest(hm.id, hm.name, v.version, hm.category, [v.package.fileName ?? `zz_${hm.id}.scd`], { source: { kind: "hub", hubId: hm.id } });
      if (existing >= 0) mods[existing] = m; else mods.push(m);
      if (a.enable && !active().mods.some((x) => x.id === m.id)) active().mods.push({ id: m.id, enabled: true });
      return r(m);
    }
    case "hub_updates": return r([{ id: "storm", name: "STORM Rework", installed: mods.find((m) => m.id === "storm")?.version ?? "", latest: "3.2.0", changelog: "Novas experimentais Illuminate.", indexUrl: hubIndex.sourceUrl }].filter((u) => u.installed && u.installed !== u.latest));
    case "archives": return r([
      { name: "bp.scd", size: 3_884_012, origin: "stock" }, { name: "lua.scd", size: 18_210_330, origin: "stock" },
      { name: "textures.scd", size: 1_120_440_001, origin: "stock" }, { name: "units.scd", size: 702_118_400, origin: "stock" },
      { name: "zz_STORM.scd", size: 22_420_000, origin: "managed", modId: "storm" },
    ]);
    case "archive_entries": {
      const base = String(a.name).replace(".scd", "");
      const list = base === "textures"
        ? ["textures/ui/common/game/economy-panel/bg.dds", "textures/ui/common/game/economy-panel/mass-icon.dds", "textures/ui/common/dialogs/button_up.dds", "textures/ui/common/dialogs/button_down.dds", "textures/ui/uef/game/unit_bmp/uel0101_icon.dds"]
        : base === "units"
          ? ["units/uel0101/uel0101_lod0.scm", "units/uel0101/uel0101_albedo.dds", "units/uel0101/uel0101_unit.bp", "units/urb0101/urb0101_lod0.scm"]
          : ["lua/ui/game/economy.lua", "lua/ui/game/hud.lua", "lua/sim/unit.lua", "lua/keymap/defaultkeymap.lua", "lua/compiled/aibrain.lua"];
      return r(list.map((n, i) => ({ name: n, key: "/" + n, size: 4096 * (i + 3), compressed: 2048 * (i + 1), isDir: false })));
    }
    case "read_entry":
    case "project_read_text": {
      const p = String(a.entry ?? a.path);
      if (p.includes("compiled")) return r({ kind: "lua", size: 9000, text: null, compiled: true, warnings: [] });
      return r({ kind: p.endsWith(".bp") ? "blueprint" : "lua", size: 1800, compiled: false, warnings: [], text:
        `-- ${p}\nlocal UIUtil = import('/lua/ui/uiutil.lua')\nlocal Bitmap = import('/lua/maui/bitmap.lua').Bitmap\n\nfunction CreateEconomyBar(parent)\n    local bg = Bitmap(parent, UIUtil.UIFile('/game/economy-panel/bg.dds'))\n    bg.Left:Set(function() return parent.Left() + 6 end)\n    bg.Top:Set(function() return parent.Top() + 4 end)\n    return bg\nend\n` });
    }
    case "preview_texture":
    case "project_texture":
    case "ui_skin_preview": {
      const adj = a.adjust as T.ColorAdjust | null;
      return r({ info: { width: 256, height: 256, mipCount: 9, format: "dxt5", isCubemap: false }, png: gradientPng(200 + (adj?.hue ?? 0)) });
    }
    case "preview_model":
    case "project_model":
    case "project_import_obj": return r(cubeMesh());
    case "install_from_url": {
      for (let i = 0; i <= 100; i += 20) { mockEvents.emit("cp://progress", { task: "link", step: i, total: 100, message: "Baixando" }); await sleep(80); }
      const name = decodeURIComponent(String(a.url).split("/").pop() || "mod").replace(/\.(zip|scd)$/i, "");
      const m = manifest(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, "1.0.0", "other", [name + ".scd"], { source: { kind: "link", url: String(a.url) } });
      mods.push(m);
      if (a.enable) active().mods.push({ id: m.id, enabled: true });
      return r(m);
    }
    case "project_save_painted": return r({ width: 256, height: 256, mipCount: 9, format: "dxt5", isCubemap: false });
    case "project_adjust_texture": return r({ info: { width: 256, height: 256, mipCount: 9, format: "dxt5", isCubemap: false }, png: gradientPng(200 + ((a.adjust as T.ColorAdjust).hue ?? 0)) });
    case "project_export":
    case "export_entry":
    case "project_delete_file":
    case "save_project":
    case "delete_project":
    case "open_path": return r(undefined);
    case "list_projects": return r(projects);
    case "create_project": {
      const id = String(a.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      const p: T.Project = { id, name: String(a.name), version: "0.1.0", description: "", category: a.category as T.Category, multiplayer: "sync", archiveName: `zz_${id.replace(/-/g, "_")}.scd`, createdAt: new Date().toISOString() };
      projects.unshift(p);
      projectFiles[id] = [];
      return r(p);
    }
    case "project_files": return r(projectFiles[String(a.id)] ?? []);
    case "project_write_text": return r([]);
    case "project_override": {
      const key = "/" + String(a.entry).replace(/^\//, "");
      (projectFiles[String(a.id)] ??= []).push({ path: key, size: 4096, kind: key.endsWith(".lua") ? "lua" : key.endsWith(".dds") ? "texture" : key.endsWith(".scm") ? "model" : "other" });
      return r(key);
    }
    case "project_import_png": return r({ width: 256, height: 256, mipCount: 9, format: "dxt5", isCubemap: false });
    case "build_project": {
      const p = projects.find((x) => x.id === a.id)!;
      await progress("build", ["Empacotando", "Pronto"]);
      return r(manifest(p.id, p.name, p.version, p.category, [p.archiveName], { source: { kind: "studio" } }));
    }
    case "export_project_package": return r(String(a.dest));
    case "ui_skin_targets": return r({ count: 1873, sample: ["textures/ui/common/game/economy-panel/bg.dds", "textures/ui/common/dialogs/button_up.dds", "textures/ui/common/game/orders/attack_btn_up.dds"] });
    case "build_ui_skin": {
      await progress("skin", Array.from({ length: 8 }, (_, i) => `textures/ui/common/${i}.dds`));
      const o = a.opts as T.UiSkinOptions;
      return r(manifest("skin-" + o.name.toLowerCase(), "Skin de interface: " + o.name, "1.0.0", "ui", ["zz_cp_skin.scd"], { multiplayer: "local" }));
    }
    case "enhance_groups": return r([
      { group: "/units/", textures: 1840, bytes: 412_000_000, suggested: "upscale", buckets: [{ width: 512, height: 512, format: "dxt1", mipmaps: true, skip: false, count: 600 }, { width: 512, height: 512, format: "dxt5", mipmaps: true, skip: false, count: 600 }, { width: 256, height: 256, format: "dxt5", mipmaps: true, skip: false, count: 640 }], sample: ["units/uel0101/uel0101_albedo.dds", "units/uel0101/uel0101_normalsts.dds", "units/ual0201/ual0201_albedo.dds"] },
      { group: "/env/", textures: 960, bytes: 286_000_000, suggested: "upscale", buckets: [{ width: 1024, height: 1024, format: "dxt1", mipmaps: true, skip: false, count: 400 }, { width: 512, height: 512, format: "dxt5", mipmaps: true, skip: false, count: 560 }], sample: ["env/evergreen/layers/grass01_albedo.dds", "env/desert/layers/sand02_albedo.dds"] },
      { group: "/textures/ui/", textures: 1873, bytes: 96_000_000, suggested: "sharpen", buckets: [{ width: 128, height: 128, format: "dxt5", mipmaps: false, skip: false, count: 1873 }], sample: ["textures/ui/common/game/economy-panel/bg.dds"] },
      { group: "/projectiles/", textures: 210, bytes: 18_000_000, suggested: "upscale", buckets: [{ width: 128, height: 128, format: "dxt5", mipmaps: true, skip: false, count: 210 }], sample: ["projectiles/laser01/laser01_albedo.dds"] },
      { group: "/effects/", textures: 430, bytes: 41_000_000, suggested: "upscale", buckets: [{ width: 256, height: 256, format: "dxt5", mipmaps: true, skip: false, count: 430 }], sample: ["effects/textures/explosion01.dds"] },
      { group: "/textures/environment/", textures: 64, bytes: 12_000_000, suggested: "upscale", buckets: [{ width: 256, height: 1, format: "bgra8", mipmaps: false, skip: true, count: 64 }], sample: ["textures/environment/ramp_water.dds"] },
    ]);
    case "enhance_preview": {
      const o = a.opts as T.EnhanceOptions;
      const entry = String(a.entry);
      const cls = /normal/.test(entry) ? "normal" : /ramp/.test(entry) ? "skip" : "color";
      const size = a.mode === "upscale" && cls !== "skip" ? Math.min(512 * o.scale, o.maxSize) : 512;
      return r({ before: "hd/antes.jpg", after: cls === "skip" ? "hd/antes.jpg" : "hd/depois.jpg", info: { width: 512, height: 512, mipCount: 10, format: "dxt1", isCubemap: false }, width: size, height: size, class: cls });
    }
    case "build_enhance": {
      for (let i = 0; i <= 40; i += 4) { mockEvents.emit("cp://progress", { task: "hd", step: i, total: 40, message: `units/uel${String(100 + i).padStart(4, "0")}/albedo.dds (faltam ~0:${String(40 - i).padStart(2, "0")})` }); await sleep(150); }
      return r({ ...mods[0], id: "texturas-hd", name: (a.opts as T.EnhanceOptions).name, category: "textures" });
    }
    case "memory_status": return r(memStatus());
    case "memory_set": {
      mem.limitMb = a.limitMb as number;
      laa.enabled = mem.limitMb > 2048;
      return r(memStatus());
    }
    case "app_update_check": return r({ version: "9.9.0", notes: "Atualização de demonstração.", url: "https://github.com/RiqueBitt/CommandProject/releases", assetName: "CommandProject_9.9.0_x64-setup.exe", assetUrl: "https://github.com/x.exe", size: 13_700_000, sha256: null });
    case "app_update_install": {
      for (let i = 0; i <= 20; i++) { mockEvents.emit("cp://progress", { task: "update", step: i * 50, total: 1000, message: `Baixando a versão 9.9.0: ${(i * 0.65).toFixed(1).replace(".", ",")} de 13,1 MB · 4,2 MB/s` }); await sleep(120); }
      return r(undefined);
    }
    case "menu_theme_preview": {
      const o = a.opts as T.ThemeOptions;
      const img = (w: number, h: number, draw: (g: CanvasRenderingContext2D, after: boolean) => void, after: boolean) => {
        const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d")!, after); return c.toDataURL();
      };
      const accent = o.recolor ? o.accent : "#4f8fe0";
      const hover = o.recolor ? (o.hover || o.accent) : "#e08a2a";
      const grad = (g: CanvasRenderingContext2D, w: number, h: number, a: string, b: string) => { const x = g.createLinearGradient(0, 0, 0, h); x.addColorStop(0, a); x.addColorStop(1, b); g.fillStyle = x; g.fillRect(0, 0, w, h); };
      const btn = (isHover: boolean) => (g: CanvasRenderingContext2D, after: boolean) => {
        const col = after ? (isHover ? hover : accent) : isHover ? "#e08a2a" : "#4f8fe0";
        grad(g, 256, 40, "#20262e", "#12161b"); g.strokeStyle = col; g.lineWidth = 2; g.strokeRect(1, 1, 254, 38);
        g.fillStyle = col; g.globalAlpha = .35; g.fillRect(0, 0, 256 * (isHover ? 1 : .55), 40); g.globalAlpha = 1;
        g.beginPath(); g.moveTo(240, 4); g.lineTo(252, 20); g.lineTo(240, 36); g.fillStyle = col; g.fill();
      };
      const items: [string, number, number, (g: CanvasRenderingContext2D, after: boolean) => void][] = [
        ["blue_overlay.dds", 128, 512, (g, after) => { grad(g, 128, 512, "#05070a", after && o.recolor ? "#4a5040" : "#3f7fd0"); if (after && o.recolor) { g.fillStyle = `rgba(0,0,0,${o.bgDarkness * 0.8})`; g.fillRect(0, 0, 128, 512); } }],
        ["top_blue_grad.dds", 256, 32, (g, after) => grad(g, 256, 32, after && o.recolor ? "#3a4030" : "#2a5aa0", "rgba(0,0,0,0)")],
        ["line03.dds", 64, 4, (g, after) => { g.fillStyle = after ? accent : "#4f8fe0"; g.fillRect(0, 0, 64, 4); }],
        ["mainmenu/btn_u.dds", 256, 40, btn(false)],
        ["mainmenu/btn_o.dds", 256, 40, btn(true)],
        ["mainmenu/gamertag_bg.dds", 256, 32, (g) => grad(g, 256, 32, "#1a1f25", "#0b0e12")],
        ["mainmenu/sc_logo.dds", 256, 64, (g) => { g.fillStyle = "#d8dde3"; g.font = "bold 30px Arial"; g.fillText("SUPREME", 8, 30); g.fillText("COMMANDER 2", 8, 60); }],
      ];
      return r(items.map(([key, w, h, d]) => ({ key, width: w, height: h, before: img(w, h, d, false), after: img(w, h, d, true) })));
    }
    case "build_menu_theme": {
      for (let i = 0; i <= 380; i += 38) { mockEvents.emit("cp://progress", { task: "theme", step: i, total: 380, message: `textures/ui/common/pc/frontend/common/button${String(i % 12).padStart(2, "0")}_u.dds` }); await sleep(120); }
      const o = a.opts as T.ThemeOptions;
      const m = manifest("menu-moderno", o.name, "1.0.0", "ui", ["zz_cp_menu_moderno.scd"], { source: { kind: "studio" } });
      const i = mods.findIndex((x) => x.id === m.id);
      if (i >= 0) mods[i] = m; else { mods.push(m); active().mods.push({ id: m.id, enabled: true }); }
      return r(m);
    }
    case "showcase": return r(null); // sem jogo no navegador: a tela mostra o robô de reserva
    case "laa_status": return r(laaStatus());
    case "laa_set": laa.enabled = Boolean(a.enabled); return r(laaStatus());
    case "shaders_status": return r(shaderStatus());
    case "shaders_apply": {
      if (!shaderState.reshade) throw "o ReShade não está instalado";
      shaderState.pack = true;
      shaderState.preset = (a.preset as string | null) ?? null;
      return r(shaderStatus());
    }
    case "shaders_reset": return r(shaderStatus());
    case "shaders_remove": {
      shaderState.pack = false;
      shaderState.preset = null;
      if (a.reshade) shaderState.reshade = false;
      return r(shaderStatus());
    }
    case "shaders_install_reshade": {
      const steps = ["Procurando a versão mais nova do ReShade", "Baixando o ReShade 6.6.2", "Conferindo a assinatura digital", "Instalando", "Ativando os shaders"];
      for (let i = 0; i < steps.length; i++) { mockEvents.emit("cp://progress", { task: "reshade", step: i, total: 4, message: steps[i] }); await sleep(350); }
      Object.assign(shaderState, { reshade: true, pack: true, preset: (a.preset as string | null) ?? "Vivido" });
      return r(shaderStatus());
    }
    case "maptk_status": return r({ python: { program: "python", prefixArgs: [], version: "3.12.7" }, ready: true });
    case "maptk_run": {
      const c = a.command;
      if (c === "catalog") return r({ terrains: [
        { id: "SC2_MP_002", archive: "maps.scd", kind: "skirmish", name: "Open Palms", biome: "grass", waterY: 15, openness: 1, navmesh: "full", players: 6 },
        { id: "SC2_MP_203", archive: "maps.scd", kind: "skirmish", name: "MP 203", biome: "sand", waterY: 34, openness: 0.8, navmesh: "full", players: 4 },
        { id: "SC2_MP_007", archive: "maps.scd", kind: "skirmish", name: "4 FFA Land", biome: "grass", openness: 0.67, navmesh: "full", players: 4 },
        { id: "SC2_MP_302", archive: "maps.scd", kind: "skirmish", name: "Treallach Island", biome: "island", waterY: 56, openness: 0.82, navmesh: "full", players: 4 },
        { id: "SC2_CA_I01", archive: "maps.scd", kind: "campaign", name: "Illuminate Desert", biome: "sand", waterY: 34, openness: 0.28, navmesh: "pocket", players: 6, notes: "two shores split by a river; patch + causeway needed" },
      ] });
      if (c === "preview") {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 512;
        const g = cv.getContext("2d")!;
        for (let y = 0; y < 512; y += 4) for (let x = 0; x < 512; x += 4) {
          const h = Math.sin(x / 61) * Math.cos(y / 47) + Math.sin((x + y) / 90);
          const water = Math.abs(x - 300 - Math.sin(y / 40) * 30) < 26;
          g.fillStyle = water ? "#2c5a86" : `hsl(${100 - h * 18},${22 + h * 6}%,${36 + h * 9}%)`;
          g.fillRect(x, y, 4, 4);
        }
        return r({ path: "", dataUrl: cv.toDataURL(), terrain: (a.input as { terrain: string }).terrain, grid: 1024, size: 512, nLayers: 5, landLayer: 1, waterLevel: 34, navigablePct: 71.4 });
      }
      if (c === "examples") return r({ examples: [{ key: "duel_1v1", spec: { terrain: "SC2_MP_101", scenario_id: "SC2_MP_101D", name: "[2] Duel (1v1)", anchors: { "1": [350, 554], "2": [676, 554] }, teams: [[1], [2]], economy: { base_mass: 4, sites: 4, per_site: 2 }, norush: 55, patch: null } }] });
      return r({});
    }
    case "maptk_terrain3d": {
      const size = (a.size as number) ?? 256, grid = 1024, step = grid / size;
      const field = (x: number, z: number) => {
        const h = Math.sin(x / 122) * Math.cos(z / 94) + Math.sin((x + z) / 180);
        const river = Math.abs(x - 600 - Math.sin(z / 80) * 60);
        return Math.max(18, 44 + h * 14 - Math.max(0, 70 - river) * 0.42);
      };
      const buf = new Uint8Array((size + 1) * (size + 1) * 2);
      for (let j = 0, k = 0; j <= size; j++) for (let i = 0; i <= size; i++, k += 2) {
        const v = Math.round(field(i * step, j * step) * 128);
        buf[k] = v & 255; buf[k + 1] = v >> 8;
      }
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const cv = document.createElement("canvas");
      cv.width = cv.height = 512;
      const g = cv.getContext("2d")!;
      for (let y = 0; y < 512; y += 2) for (let x = 0; x < 512; x += 2) {
        const hgt = field(x * 2, y * 2);
        const n = Math.sin(x * 0.9) * Math.cos(y * 1.3) * 4;
        g.fillStyle = hgt < 33 ? `hsl(200,30%,${30 + n}%)` : hgt < 36 ? `hsl(42,35%,${52 + n}%)` : `hsl(${95 - (hgt - 40) * 1.5},${30 + n}%,${30 + (hgt - 36) * 0.7 + n}%)`;
        g.fillRect(x, y, 2, 2);
      }
      // bosques e pedras de exemplo (determinístico)
      const props: [number, number, number, number, number, number][] = [];
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 900; k++) {
        const cx = 160 + (k % 5) * 170, cz = 180 + Math.floor(k / 180) * 160;
        const x = cx + (rnd() - 0.5) * 120, z = cz + (rnd() - 0.5) * 120;
        if (field(x, z) < 36) continue;
        props.push([x, z, field(x, z), rnd() * 360, 0.8 + rnd() * 0.5, k % 9 === 0 ? 1 : 0]);
      }
      return r({ terrain: a.terrain, grid, size, heights: btoa(bin), heightScale: 1 / 128, yMin: 18, yMax: 72, waterLevel: 34, texture: cv.toDataURL(), props, propKinds: ["/props/Trees/spruce01/spruce01_prop.bp", "/props/Rocks/rock03/rock03_prop.bp"] });
    }
    case "map_assets": {
      const P = (cat: string, n: string) => ({ bp: `/props/${cat}/${n}/${n}_prop.bp`, name: n, category: cat });
      const props = [
        ...["spruce01", "spruce02", "pine01", "pine02", "oak01", "palm01", "palm02", "dead01", "birch01"].map((n) => P("Trees", n)),
        ...["rock01", "rock02", "rock03", "rock_desert01", "rock_snow01", "boulder01"].map((n) => P("Rocks", n)),
        ...["warehouse01", "tower01", "silo01", "hangar01"].map((n) => P("Buildings", n)),
        ...["crate01", "barrel01"].map((n) => P("Crates", n)),
        ...["uul0101_wreck", "ucl0103_wreck"].map((n) => P("Wreckage", n)),
      ];
      const L = (map: string, name: string) => {
        const base = `/textures/Terrain/${map}/${map.replace(/^SC2_/, "").toLowerCase()}_${name}`;
        return { map, name, d: `${base}_d.dds`, n: `${base}_n.dds`, s: `${base}_s.dds`, slotD: 64, slotN: 64, slotS: 64 };
      };
      const layers = ["SC2_MP_002", "SC2_MP_101", "SC2_MP_302", "SC2_MP_205"].flatMap((m, i) =>
        [["grass01", "earth01", "cliff01"], ["sand01", "rock01", "dunes01"], ["snow01", "ice01", "rock02"], ["lava01", "ash01", "metal01"]][i].map((n) => L(m, n)));
      for (const t of ["SC2_MP_001", "SC2_MP_003"]) layers.push(L(t, "grass01"), L(t, "earth01"), L(t, "hill01"));
      return r({ props, layers });
    }
    case "game_texture": {
      const path = String(a.path).toLowerCase();
      const hue = path.includes("snow") || path.includes("ice") ? 205 : path.includes("sand") || path.includes("dune") ? 42 : path.includes("lava") ? 12 : path.includes("rock") || path.includes("cliff") || path.includes("metal") ? 30 : path.includes("ash") ? 0 : path.includes("earth") || path.includes("hill") ? 28 : 96;
      const sat = path.includes("rock") || path.includes("cliff") || path.includes("metal") || path.includes("ash") ? 8 : path.includes("snow") || path.includes("ice") ? 25 : 38;
      const light = path.includes("snow") || path.includes("ice") ? 82 : path.includes("ash") ? 22 : 40;
      const cv = document.createElement("canvas");
      cv.width = cv.height = 64;
      const g = cv.getContext("2d")!;
      for (let y = 0; y < 64; y += 4) for (let x = 0; x < 64; x += 4) {
        g.fillStyle = `hsl(${hue},${sat}%,${light + Math.sin(x * 0.7 + y * 0.3) * 5 + ((x * 7 + y * 13) % 9) - 4}%)`;
        g.fillRect(x, y, 4, 4);
      }
      return r(cv.toDataURL());
    }
    case "prop_preview": {
      // cone simples no lugar do modelo do jogo
      const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
      const seg = 10;
      for (let i = 0; i < seg; i++) {
        const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, b = pos.length / 3;
        pos.push(0, 9, 0, Math.cos(a0) * 2.6, 0, Math.sin(a0) * 2.6, Math.cos(a1) * 2.6, 0, Math.sin(a1) * 2.6);
        for (const a of [a0, a0, a1]) nor.push(Math.cos(a), 0.3, Math.sin(a));
        uv.push(0.5, 0, 0, 1, 1, 1);
        idx.push(b, b + 2, b + 1);
      }
      return r({ mesh: { positions: pos, normals: nor, uvs: uv, indices: idx, bones: [], bboxMin: [-2.6, 0, -2.6], bboxMax: [2.6, 9, 2.6], version: 6, triangles: idx.length / 3, info: "prévia simulada" }, texture: null });
    }
    case "maptk_build": {
      const steps = ["terrain SC2_MP_002 (Open Palms), 3 layers, land layer L0", "placeable cells: 18211", "min spawn separation: 420", "total mass points: 52", "VERIFIED: all 52 positions navigable; all spawns mutually reachable", "packaged: _cp_meumapa.scd (0.1 MB)"];
      for (const [i, s] of steps.entries()) { mockEvents.emit("cp://progress", { task: "map", step: i + 1, total: 0, message: s }); await sleep(260); }
      const spec = a.spec as { name: string; scenario_id: string };
      const m = manifest("mapa-" + spec.scenario_id.toLowerCase(), spec.name, "1.0.0", "maps", ["_cp_meumapa.scd"], { source: { kind: "studio" } });
      mods.push(m);
      active().mods.push({ id: m.id, enabled: true });
      const extra = ((a.spec as { extra_mass?: unknown[] }).extra_mass ?? []).length;
      return r({ result: { mass: 52, sites: 9, extraMass: extra, warnings: extra ? ["massa 1 movida para (412, 380): o ponto escolhido não era plano/seco"] : [] }, manifest: m });
    }
    // ---------------------------------------------------------- tropas (simulado)
    case "unit_catalog": return r(mockUnits);
    case "unit_packs": return r([{ slug: "minha_faccao", name: "Minha facção", units: ["cpmart01"] }]);
    case "unit_refs_check": return r((a.paths as string[]).filter((x) => x.includes("nada")));
    case "unit_animations": return r(["/units/uul0101/uul0101_awalk.sca", "/units/uul0101/uul0101_aidle.sca", "/units/uul0101/uul0101_adeath.sca", "/units/uil0101/uil0101_awalk.sca", "/units/ucl0103/ucl0103_aactivate.sca"]);
    case "unit_details": {
      const u = mockUnits.find((x) => x.id === a.id) ?? mockUnits[0];
      const leaf = (path: string, v: number | string | boolean): T.BpLeaf => typeof v === "number" ? { path, kind: "number", number: v, text: null, flag: null } : typeof v === "boolean" ? { path, kind: "bool", number: null, text: null, flag: v } : { path, kind: "text", number: null, text: v, flag: null };
      const leaves = Object.entries({
        "Defense.MaxHealth": 520, "Defense.Health": 520, "Defense.RegenRate": 0, "Defense.ArmorType": "Normal",
        "Economy.BuildCostMass": 60, "Economy.BuildCostEnergy": 300, "Economy.BuildTime": 6,
        "Physics.MotionType": "RULEUMT_Land", "Physics.MaxSpeed": 4.2, "Physics.MaxAcceleration": 3, "Physics.MaxBrake": 4, "Physics.TurnRate": 120,
        "Intel.VisionRadius": 26, "Display.UniformScale": 0.1, "SizeX": 0.9, "SizeY": 0.6, "SizeZ": 1.2,
        "Weapon.1.Label": "MainGun", "Weapon.1.Damage": 32, "Weapon.1.DamageRadius": 0, "Weapon.1.MaxRadius": 24, "Weapon.1.MinRadius": 0, "Weapon.1.RateOfFire": 0.8,
        "Weapon.1.MuzzleVelocity": 30, "Weapon.1.ProjectileId": "/projectiles/UUnitTankShell01/UUnitTankShell01_proj.bp", "Weapon.1.TurretYawSpeed": 90, "Weapon.1.TurretPitchSpeed": 30, "Weapon.1.DamageType": "Normal",
      }).map(([k, v]) => leaf(k, v));
      return r({
        id: u.id, name: u.name, description: u.description, faction: u.faction, role: u.role,
        text: `UnitBlueprint {\n    Description = '${u.name}',\n    -- simulado no navegador\n}`,
        leaves, categories: ["UEF", "MOBILE", "LAND", "DIRECTFIRE", "BUILTBYTIER1FACTORY", "SELECTABLE", "VISIBLETORECON", "RECLAIMABLE"],
        weapons: [{ index: 1, label: "MainGun", dummy: false }],
        animations: [["Display.AnimationWalk", `/units/${u.id}/${u.id}_awalk.sca`], ["Display.AnimationDeath", `/units/${u.id}/${u.id}_adeath.sca`]],
        bones: ["Root", "Turret", "Turret_Barrel", "Turret_Muzzle"], files: [[`${u.id}_lod0.scm`, 180_000], [`${u.id}_albedo.dds`, 700_000]],
        mesh: `/units/${u.id}/${u.id}_lod0.scm`, albedo: null,
      } satisfies T.UnitDetails);
    }
    case "unit_preview": return r(mockTank());
    case "storage_report": return r({ dataDir: "C:\\Users\\voce\\AppData\\Roaming\\CommandProject", total: 1_480_000_000, items: [
      { key: "creations", label: "Projetos (mapas, tropas, modelos, texturas, ícones)", path: "creations", bytes: 84_000_000 },
      { key: "creations-trash", label: "Lixeira de projetos", path: "creations-trash", bytes: 3_200_000 },
      { key: "project-backups", label: "Cópias de segurança dos projetos", path: "project-backups", bytes: 61_000_000 },
      { key: "library", label: "Biblioteca de mods", path: "library", bytes: 912_000_000 },
      { key: "backups", label: "Arquivos originais do jogo (para restaurar)", path: "backups", bytes: 380_000_000 },
      { key: "cache", label: "Cache e temporários", path: "cache", bytes: 21_000_000 },
      { key: "other", label: "Configurações e outros", path: ".", bytes: 18_800_000 },
    ] } satisfies T.StorageReport);
    case "backups_list": return r(mockBackups);
    case "backup_create": { await sleep(400); const b = { path: (a.dest as string) ?? `project-backups/copia-${Date.now()}.zip`, name: `copia-${new Date().toISOString().slice(0, 10)}.zip`, createdAt: new Date().toISOString(), size: 30_500_000, auto: false, projects: 5 }; if (!a.dest) mockBackups.unshift(b); return r(b); }
    case "backup_inspect": return r({ path: a.path as string, name: String(a.path).split(/[\\/]/).pop() ?? "", createdAt: new Date().toISOString(), size: 30_500_000, auto: false, projects: 5 } satisfies T.BackupEntry);
    case "backup_restore": { await sleep(400); return r({ restored: ["Vale do rio", "Tanque pesado"], skipped: [] } satisfies T.RestoreReport); }
    case "backup_auto": return r(null);
    case "trash_list": return r(mockTrash);
    case "trash_restore": { const i = mockTrash.findIndex((t) => t.entry === a.entry); const [t] = mockTrash.splice(i, 1); return r({ id: t.id, kind: t.kind, name: t.name, description: "", createdAt: t.deletedAt, updatedAt: new Date().toISOString(), favorite: false, tags: [], builtMod: null, hasThumb: false } as unknown as T.CreationMeta); }
    case "export_data": { console.info("[mock] export_data", a.path, String(a.data).length, "bytes"); return r(undefined); }
    case "unit_mix_preview": {
      const sp = a.spec as T.MixSpec;
      const t = mockTank();
      const k = sp.turretScale > 0 ? sp.turretScale : 1.2;
      // torre maior para mostrar a troca
      const pos = t.mesh.positions.slice();
      t.boneIndex.forEach((b, i) => { if (b >= 1) { pos[i * 3] *= k; pos[i * 3 + 2] *= k; pos[i * 3 + 1] = 0.55 + (pos[i * 3 + 1] - 0.55) * k + sp.turretOffset[1]; } });
      t.mesh.positions = pos;
      const checks: T.MixCheck[] = [
        ...(sp.turret ? [{ level: "fix" as const, text: "Display.AnimationDeath: 1 osso(s) que não existem mais foram tirados da animação" }] : []),
        ...(k > 1.6 ? [{ level: "warn" as const, text: "a torre ficou 60% mais larga que o corpo" }] : []),
        { level: "ok", text: `4 ossos, ${t.mesh.positions.length / 3} vértices, atlas 1024×512` },
      ];
      return r({ ...t, checks, bones: ["Root", "Turret", "Turret_Barrel", "Turret_Muzzle"] } satisfies T.MixPreview);
    }
    case "anim_read": {
      const frames = Array.from({ length: 31 }, (_, i) => {
        const t = (i / 30) * 2, ang = Math.sin((i / 30) * Math.PI * 2) * 0.6;
        return { time: t, flags: 0, positions: [[0, 0, 0], [0, 0.55, 0], [0, 0.15, 0.35], [0, 0, 1.1]] as [number, number, number][], rotations: [[1, 0, 0, 0], [Math.cos(ang / 2), 0, Math.sin(ang / 2), 0], [1, 0, 0, 0], [1, 0, 0, 0]] as [number, number, number, number][] };
      });
      return r({ version: 5, duration: 2, bones: ["Root", "Turret", "Turret_Barrel", "Turret_Muzzle"], parents: [-1, 0, 1, 2], deltaPosition: [0, 0, 0], deltaRotation: [1, 0, 0, 0], frames } satisfies T.ScaAnimation);
    }
    case "unit_blueprint_preview": {
      const q = a.req as T.UnitBuildReq;
      return r(`UnitBlueprint {\n    Description = '<LOC ${q.newId}_desc>${q.name}',\n${Object.entries(q.overrides).map(([k, v]) => `    -- ${k} = ${JSON.stringify(v)}`).join("\n")}\n    -- (resto igual ao blueprint de ${q.base})\n}`);
    }
    case "unit_validate": { await sleep(250); return r(mockFindings(a.req as T.UnitBuildReq)); }
    case "unit_build": {
      const q = a.req as T.UnitBuildReq;
      await sleep(500);
      const m = manifest(`tropa-${q.newId}`, q.name, "1.0.0", "gameplay", [`_cp_${q.newId}.scd`], { source: { kind: "studio" } });
      mods.push(m);
      active().mods.push({ id: m.id, enabled: true });
      return r({ report: { files: 7, warnings: q.modelCreation ? ["o modelo próprio não tem o osso Turret_Muzzle: os tiros saem do centro"] : [], blueprint: "", checks: mockFindings(q) }, manifest: m } satisfies T.UnitBuildResult);
    }
    case "anim_create": return r(`${String(a.name)}.sca`);
    case "model_prepare": return r({ triangles: (a.baked as T.BakedModel).indices.length / 3, warnings: [] });
    case "model_baked": return r(null);
    case "model_export_game": return r([`${String(a.name)}_lod0.scm`, `${String(a.name)}_albedo.dds`, `${String(a.name)}_specteam.dds`, `${String(a.name)}_normalsts.dds`]);
    case "creation_asset_copy": return r(undefined);

    // ---------------------------------------------------------- otimizador (simulado)
    case "mod_export_files": return r(mods.find((m) => m.id === a.id)?.files.map((f) => `${String(a.dir)}\\${f.name}`) ?? []);
    case "perf_report": return r(perfDb());
    case "perf_process": return r(null);
    case "perf_prefs_set": {
      const db = perfDb();
      let changed = 0;
      for (const [k, v] of a.changes as [string, T.PrefValue][]) { const o = db.prefs!.options.find((x) => x.path === k); if (o && o.value !== v) { o.value = v; changed++; } }
      if (changed) db.backups.unshift({ name: `Game-${Date.now()}.prefs`, size: 2400, modified: new Date().toISOString() });
      return r({ backup: changed ? db.backups[0].name : null, changed, skipped: [] });
    }
    case "perf_backup_now": { const db = perfDb(); db.backups.unshift({ name: `Game-${Date.now()}.prefs`, size: 2400, modified: new Date().toISOString() }); return r(db.backups[0].name); }
    case "perf_backup_restore": return r(undefined);
    case "perf_profile_save": {
      const db = perfDb();
      const p = { id: `p${Date.now()}`, name: String(a.name), description: String(a.description), createdAt: new Date().toISOString(), values: db.prefs!.options.map((o) => [o.path, o.value] as [string, T.PrefValue]) };
      db.profiles.push(p);
      return r(p);
    }
    case "perf_profile_apply": {
      const db = perfDb();
      const p = db.profiles.find((x) => x.id === a.id);
      let changed = 0;
      for (const [k, v] of p?.values ?? []) { const o = db.prefs!.options.find((x) => x.path === k); if (o && o.value !== v) { o.value = v; changed++; } }
      return r({ backup: changed ? "Game-mock.prefs" : null, changed, skipped: [] });
    }
    case "perf_profile_delete": { const db = perfDb(); db.profiles = db.profiles.filter((x) => x.id !== a.id); return r(undefined); }
    case "perf_dumps_delete": { const db = perfDb(); const names = a.names as string[]; db.dumps = db.dumps.filter((d) => !names.includes(d.name)); return r(names.length); }
    case "perf_set_priority": { perfDb().priority = String(a.level); return r(String(a.level)); }
    case "build_first_person": {
      await progress("fp", ["Montando a primeira pessoa", "Pronto"]);
      return r(manifest("cp-primeira-pessoa", "Primeira Pessoa", "1.2.0", "gameplay", ["zz_cp_zz_primeira_pessoa.scd"]));
    }
    case "optimize_status": return r(optDb());
    case "build_optimize": {
      const o = a.opts as T.OptimizeOptions, db = optDb();
      await progress("optimize", ["Montando o mod de otimização", "Pronto"]);
      Object.assign(db, { options: o, installed: true, enabled: true, windows: { supported: true, gpu: o.gpu, fullscreenFix: o.fullscreenFix }, largeAddress: o.largeAddress || db.largeAddress, priority: o.priority, noThrottle: o.noThrottle });
      return r(db);
    }
    case "optimize_undo_windows": { const db = optDb(); db.windows = { supported: true, gpu: false, fullscreenFix: false }; db.noThrottle = false; return r(db); }
    default:
      throw new Error(`mock: comando não simulado: ${cmd}`);
  }
}

// ------------------------------------------------------------------ tropas e otimizador simulados
const mockUnits: T.UnitInfo[] = [
  { id: "uul0101", name: "Rock Head", faction: "UEF", role: "Tanque", description: "Tanque de assalto", categories: ["UEF", "MOBILE", "LAND", "DIRECTFIRE", "BUILTBYTIER1FACTORY", "BUILTBYLANDTIER1FACTORY"] },
  { id: "uil0101", name: "Sharp Shooter", faction: "Illuminate", role: "Tanque", description: "Tanque flutuante", categories: ["ILLUMINATE", "MOBILE", "LAND", "HOVER", "BUILTBYTIER1FACTORY"] },
  { id: "ucl0103", name: "Bonesmasher", faction: "Cybran", role: "Artilharia", description: "Artilharia móvel", categories: ["CYBRAN", "MOBILE", "LAND", "INDIRECTFIRE", "BUILTBYTIER2FACTORY", "BUILTBYLANDTIER2FACTORY"] },
];

function mockTank(): T.UnitPreview {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [], bi: number[] = [];
  const box = (c: [number, number, number], h: [number, number, number], bone: number) => {
    const faces: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (const n of faces) {
      const b = pos.length / 3;
      const [u, v] = n[0] ? [[0, 1, 0], [0, 0, 1]] : n[1] ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(...[0, 1, 2].map((k) => c[k] + (n[k] + u[k] * su + v[k] * sv) * h[k]));
        nor.push(...n); uv.push((su + 1) / 2, (sv + 1) / 2); bi.push(bone);
      }
      const flip = n[0] + n[1] + n[2] > 0 ? n[1] === 0 : n[1] !== 0;
      if (flip) idx.push(b, b + 1, b + 2, b, b + 2, b + 3); else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    }
  };
  box([0, 0.3, 0], [0.6, 0.25, 0.9], 0);
  box([-0.65, 0.2, 0], [0.12, 0.2, 0.95], 0);
  box([0.65, 0.2, 0], [0.12, 0.2, 0.95], 0);
  box([0, 0.7, -0.05], [0.35, 0.15, 0.4], 1);
  box([0, 0.7, 0.75], [0.06, 0.06, 0.45], 2);
  return {
    mesh: {
      positions: pos, normals: nor, uvs: uv, indices: idx,
      bones: [
        { name: "Root", parent: -1, position: [0, 0, 0], rotation: [1, 0, 0, 0] },
        { name: "Turret", parent: 0, position: [0, 0.55, 0], rotation: [1, 0, 0, 0] },
        { name: "Turret_Barrel", parent: 1, position: [0, 0.15, 0.35], rotation: [1, 0, 0, 0] },
        { name: "Turret_Muzzle", parent: 2, position: [0, 0, 1.1], rotation: [1, 0, 0, 0] },
      ],
      bboxMin: [-0.8, 0, -1], bboxMax: [0.8, 0.9, 1.2], version: 6, triangles: idx.length / 3, info: "tanque simulado",
    },
    boneIndex: bi, albedo: null, team: null,
  };
}

let perfState: T.PerfReport | null = null;
function perfDb(): T.PerfReport {
  perfState ??= {
    prefs: {
      path: "%LOCALAPPDATA%\\Gas Powered Games\\Supreme Commander 2\\Game.prefs", exists: true, error: null,
      options: [
        { path: "options.fidelity", value: 2 }, { path: "options.shadow_quality", value: 2 }, { path: "options.antialiasing", value: 4 },
        { path: "options.texture_level", value: 0 }, { path: "options.vsync", value: true }, { path: "options.bloom_render", value: true },
        { path: "options.primary_adapter", value: "1920,1080,60" }, { path: "options.sound_effects_volume", value: 80 },
      ],
    },
    backups: [{ name: "Game-20261020-201500-120.prefs", size: 2380, modified: "2026-10-20T20:15:00Z" }],
    profiles: [], dumps: [
      { name: "SupremeCommander2_2026-10-21.mdmp", size: 1_240_000, modified: "2026-10-21T22:41:00Z", error: null,
        info: { code: 0xc0000005, codeName: "acesso inválido à memória", address: 0x10012ab4, module: "fmod_event.dll", moduleOffset: 0x12ab4, modules: 84, hint: "Falhou no sistema de som (FMOD). Já aconteceu com muitos pacotes de mods montados ao mesmo tempo ou mods com sons: desligue os mods mais recentes e teste de novo." } },
    ],
    version: "1.260.0.0", latest: true, knownLatest: "1.26", exe: "C:\\Steam\\steamapps\\common\\Supreme Commander 2\\bin\\SupremeCommander2.exe",
    priority: "normal", priorities: ["normal", "above_normal", "high"], modsEnabled: 4,
  };
  return perfState;
}

function mockFindings(q: T.UnitBuildReq): T.Finding[] {
  const out: T.Finding[] = [];
  const speed = q.overrides["Physics.MaxSpeed"];
  if (typeof speed === "number" && speed <= 0) out.push({ level: "err", area: "Movimento", text: "velocidade máxima zero ou negativa" });
  out.push({ level: "ok", area: "Colisão", text: "colisão 1.2×0.8×1.9 combina com o modelo (1.1×0.9×2.0)" });
  out.push({ level: "ok", area: "Armas", text: "1 arma(s): ossos de giro, elevação e boca ligados" });
  if (q.mix?.turret) out.push({ level: "warn", area: "Animações", text: "AnimationWalk: 1 osso(s) da animação não existem no modelo e serão ignorados" });
  else out.push({ level: "ok", area: "Animações", text: "2 animação(ões) conferidas: ossos, laços e articulações em ordem" });
  out.push({ level: "ok", area: "Ossos", text: "4 ossos sem peças soltas" });
  return out;
}

const mockBackups: T.BackupEntry[] = [
  { path: "project-backups/auto-20261020-101500.zip", name: "auto-20261020-101500.zip", createdAt: "2026-10-20T10:15:00Z", size: 28_400_000, auto: true, projects: 4 },
];
const mockTrash: T.TrashItem[] = [
  { entry: "mapa-velho-261001-20261012", id: "mapa-velho-261001", name: "Mapa velho", kind: "map", deletedAt: "2026-10-12T18:00:00Z", size: 1_200_000 },
];

// ------------------------------------------------------------------ mod de otimização simulado
let optState: T.OptimizeState | null = null;
function optDb(): T.OptimizeState {
  optState ??= {
    options: { fps: 0, bigFps: 60, gpu: true, fullscreenFix: true, priority: "above_normal", noThrottle: true, largeAddress: true },
    installed: false, enabled: false, windows: { supported: true, gpu: false, fullscreenFix: false },
    largeAddress: true, priority: "normal", noThrottle: false, fpsChoices: [0, 30, 45, 60, 75, 90, 120, 144, 165, 240],
  };
  return optState;
}
