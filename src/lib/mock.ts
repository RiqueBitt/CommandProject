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
  serverUrl: "http://localhost:8787", nickname: "Rique", checkAppUpdates: true, keepLargeAddress: false,
};

const game: T.GameInstall = {
  root: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2",
  gamedata: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2\\gamedata",
  exe: "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Supreme Commander 2\\bin\\SupremeCommander2.exe",
  store: "steam",
};

let deployed: string[] = ["storm", "littlepatch", "kael-maps"];

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

export async function mock<R>(cmd: string, a: Record<string, unknown>): Promise<R> {
  await sleep(120);
  const r = (v: unknown) => v as R;
  switch (cmd) {
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
    case "maptk_build": {
      const steps = ["terrain SC2_MP_002 (Open Palms), 3 layers, land layer L0", "placeable cells: 18211", "min spawn separation: 420", "total mass points: 52", "VERIFIED: all 52 positions navigable; all spawns mutually reachable", "packaged: _cp_meumapa.scd (0.1 MB)"];
      for (const [i, s] of steps.entries()) { mockEvents.emit("cp://progress", { task: "map", step: i + 1, total: 0, message: s }); await sleep(260); }
      const spec = a.spec as { name: string; scenario_id: string };
      const m = manifest("mapa-" + spec.scenario_id.toLowerCase(), spec.name, "1.0.0", "maps", ["_cp_meumapa.scd"], { source: { kind: "studio" } });
      mods.push(m);
      active().mods.push({ id: m.id, enabled: true });
      return r({ result: { mass: 52, sites: 9 }, manifest: m });
    }
    default:
      throw new Error(`mock: comando não simulado: ${cmd}`);
  }
}
