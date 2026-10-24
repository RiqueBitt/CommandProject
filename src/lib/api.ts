// Ponte com o núcleo em Rust. Fora do Tauri (navegador em desenvolvimento) usa um
// backend simulado, para dar para trabalhar na interface sem o jogo instalado.

import type * as T from "./types";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<R>(cmd: string, args: Record<string, unknown> = {}): Promise<R> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<R>(cmd, args);
  }
  const { mock } = await import("./mock");
  return mock<R>(cmd, args);
}

export async function onProgress(cb: (e: T.ProgressEvent) => void): Promise<() => void> {
  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<T.ProgressEvent>("cp://progress", (e) => cb(e.payload));
  }
  const { mockEvents } = await import("./mock");
  return mockEvents.on("cp://progress", cb as (p: unknown) => void);
}

export async function onEvent<P>(name: string, cb: (p: P) => void): Promise<() => void> {
  if (isTauri) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<P>(name, (e) => cb(e.payload));
  }
  const { mockEvents } = await import("./mock");
  return mockEvents.on(name, cb as (p: unknown) => void);
}

// ---- seleção de arquivos (diálogos nativos) ----
export async function pickFile(filters: { name: string; extensions: string[] }[], directory = false): Promise<string | null> {
  if (!isTauri) return window.prompt("Caminho (modo navegador):") || null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: false, directory, filters: directory ? undefined : filters });
  return typeof r === "string" ? r : null;
}

export async function pickSave(defaultPath: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isTauri) return window.prompt("Salvar em (modo navegador):", defaultPath) || null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  return (await save({ defaultPath, filters })) ?? null;
}

export async function confirmDialog(message: string, okLabel = "Confirmar", cancelLabel = "Cancelar"): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title: "CommandProject", kind: "warning", okLabel, cancelLabel });
}

/** Abre um link no navegador do sistema. */
/** Abre um link no navegador. Erros viram aviso na tela (antes o clique "não fazia nada"). */
export async function openUrl(url: string) {
  try {
    if (!/^(https?:|mailto:)/i.test(url)) throw new Error(`endereço inválido: ${url || "(vazio)"}`);
    if (!isTauri) {
      window.open(url, "_blank", "noopener");
      return;
    }
    const { openUrl: open } = await import("@tauri-apps/plugin-opener");
    await open(url);
  } catch (e) {
    const { useStore, errorText } = await import("./store");
    useStore.getState().toast("error", `Não deu para abrir o link: ${errorText(e)}`);
  }
}

export async function windowAction(action: "minimize" | "maximize" | "close") {
  if (!isTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (action === "minimize") await w.minimize();
  else if (action === "maximize") await w.toggleMaximize();
  else await w.close();
}

export const api = {
  appInfo: () => call<T.AppInfo>("app_info"),
  recover: () => call<string | null>("recover"),
  dashboard: () => call<T.Dashboard>("dashboard"),
  setGamePath: (path: string | null) => call<T.GameInstall | null>("set_game_path", { path }),
  getSettings: () => call<T.Settings>("get_settings"),
  saveSettings: (settings: T.Settings) => call<T.Settings>("save_settings", { settings }),

  listMods: () => call<T.ModView[]>("list_mods"),
  importMod: (path: string, enable = true, opts?: Partial<{ id: string; name: string; category: T.Category; replace: boolean }>) =>
    call<T.Manifest>("import_mod", { path, enable, opts: opts ?? null }),
  removeMod: (id: string) => call<void>("remove_mod", { id }),
  updateModMeta: (id: string, patch: Partial<{ name: string; description: string; category: T.Category; version: string; multiplayer: T.MpPolicy }>, tags?: string[]) =>
    call<T.Manifest>("update_mod_meta", { id, patch, tags: tags ?? null }),
  verifyMod: (id: string) => call<string[]>("verify_mod", { id }),

  getProfiles: () => call<T.ProfileSet>("get_profiles"),
  createProfile: (name: string, copyFrom?: string) => call<T.ProfileSet>("create_profile", { name, copyFrom: copyFrom ?? null }),
  renameProfile: (id: string, name: string) => call<T.ProfileSet>("rename_profile", { id, name }),
  deleteProfile: (id: string) => call<T.ProfileSet>("delete_profile", { id }),
  setActiveProfile: (id: string) => call<T.ProfileSet>("set_active_profile", { id }),
  setModEnabled: (modId: string, enabled: boolean) => call<void>("set_mod_enabled", { modId, enabled, profile: null }),
  reorderMods: (order: string[]) => call<void>("reorder_mods", { order, profile: null }),

  planActive: () => call<T.Plan>("plan_active"),
  applyActive: () => call<T.Plan>("apply_active"),
  purge: () => call<T.Plan>("purge"),
  fileStatus: () => call<T.FileStatus[]>("file_status"),
  setBaselineKind: (name: string, kind: "stock" | "unmanaged") => call<void>("set_baseline_kind", { name, kind }),
  adoptUnmanaged: (name: string) => call<T.Manifest>("adopt_unmanaged", { name }),
  conflicts: () => call<T.ConflictReport>("conflicts"),
  launchGame: () => call<{ plan: unknown; applied?: T.Plan | null; watching: boolean }>("launch_game"),

  fingerprint: () => call<T.Fingerprint>("fingerprint"),
  exportSyncCode: (profile?: string) => call<string>("export_sync_code", { profile: profile ?? null }),
  inspectSyncCode: (code: string) => call<{ payload: T.SyncPayload; items: T.SyncItem[] }>("inspect_sync_code", { code }),
  applySyncCode: (code: string) => call<{ profileId: string; items: T.SyncItem[] }>("apply_sync_code", { code }),

  hubFetch: (urls?: string[]) => call<{ indexes: T.HubIndex[]; errors: { url: string; message: string }[] }>("hub_fetch", { urls: urls ?? null }),
  hubInstall: (indexUrl: string, modId: string, version?: string, enable = true) =>
    call<T.Manifest>("hub_install", { indexUrl, modId, version: version ?? null, enable }),
  hubUpdates: () => call<T.UpdateInfo[]>("hub_updates"),

  archives: () => call<T.ArchiveInfo[]>("archives"),
  archiveEntries: (name: string, original = true) => call<T.ScdEntry[]>("archive_entries", { name, original }),
  readEntry: (archive: string, entry: string, original = true) => call<T.EntryView>("read_entry", { archive, entry, original }),
  previewTexture: (archive: string, entry: string, adjust?: T.ColorAdjust, original = true) =>
    call<T.TextureView>("preview_texture", { archive, entry, original, adjust: adjust ?? null }),
  previewModel: (archive: string, entry: string, original = true) => call<T.MeshView>("preview_model", { archive, entry, original }),
  exportEntry: (archive: string, entry: string, dest: string, format: "raw" | "png" | "obj" | "glb", original = true) =>
    call<void>("export_entry", { archive, entry, original, dest, format }),

  listProjects: () => call<T.Project[]>("list_projects"),
  createProject: (name: string, category: T.Category) => call<T.Project>("create_project", { name, category }),
  saveProject: (project: T.Project) => call<void>("save_project", { project }),
  deleteProject: (id: string) => call<void>("delete_project", { id }),
  projectFiles: (id: string) => call<T.ProjectFile[]>("project_files", { id }),
  projectReadText: (id: string, path: string) => call<T.EntryView>("project_read_text", { id, path }),
  projectWriteText: (id: string, path: string, text: string) => call<string[]>("project_write_text", { id, path, text }),
  projectOverride: (id: string, archive: string, entry: string) => call<string>("project_override", { id, archive, entry }),
  projectTexture: (id: string, path: string, adjust?: T.ColorAdjust) => call<T.TextureView>("project_texture", { id, path, adjust: adjust ?? null }),
  projectImportPng: (id: string, path: string, pngPath: string, resize: boolean) =>
    call<T.DdsInfo>("project_import_png", { req: { id, path, pngPath, resize } }),
  projectModel: (id: string, path: string) => call<T.MeshView>("project_model", { id, path }),
  projectSavePainted: (id: string, path: string, pngBase64: string) => call<T.DdsInfo>("project_save_painted", { id, path, pngBase64 }),
  installFromUrl: (url: string, enable = true) => call<T.Manifest>("install_from_url", { url, enable }),
  /** bone = null: cada vértice herda o osso do ponto mais próximo do modelo original */
  projectImportObj: (id: string, path: string, objPath: string, bone: number | null) => call<T.MeshView>("project_import_obj", { id, path, objPath, bone }),
  projectExport: (id: string, path: string, dest: string, format: "raw" | "png" | "obj" | "glb") => call<void>("project_export", { id, path, dest, format }),
  projectAdjustTexture: (id: string, path: string, adjust: T.ColorAdjust) => call<T.TextureView>("project_adjust_texture", { id, path, adjust }),
  projectDeleteFile: (id: string, path: string) => call<void>("project_delete_file", { id, path }),
  buildProject: (id: string, enable = true) => call<T.Manifest>("build_project", { id, enable }),
  exportProjectPackage: (id: string, dest: string) => call<string>("export_project_package", { id, dest }),

  uiSkinTargets: (opts: T.UiSkinOptions) => call<{ count: number; sample: string[] }>("ui_skin_targets", { opts }),
  uiSkinPreview: (entry: string, adjust: T.ColorAdjust) => call<T.TextureView>("ui_skin_preview", { entry, adjust }),
  buildUiSkin: (opts: T.UiSkinOptions, enable = true) => call<T.Manifest>("build_ui_skin", { opts, enable }),

  enhanceGroups: () => call<T.EnhanceGroup[]>("enhance_groups"),
  enhancePreview: (entry: string, mode: T.EnhanceMode, opts: T.EnhanceOptions) => call<T.EnhancePreview>("enhance_preview", { entry, mode, opts }),
  buildEnhance: (opts: T.EnhanceOptions, enable = true) => call<T.Manifest>("build_enhance", { opts, enable }),
  memoryStatus: () => call<T.MemoryStatus>("memory_status"),
  perfReport: () => call<T.PerfReport>("perf_report"),
  perfProcess: () => call<T.ProcessStats | null>("perf_process"),
  perfPrefsSet: (changes: [string, T.PrefValue][]) => call<T.PrefsWriteReport>("perf_prefs_set", { changes }),
  perfBackupRestore: (name: string) => call<void>("perf_backup_restore", { name }),
  perfBackupNow: () => call<string>("perf_backup_now"),
  perfProfileSave: (name: string, description: string) => call<T.PrefProfile>("perf_profile_save", { name, description }),
  perfProfileApply: (id: string) => call<T.PrefsWriteReport>("perf_profile_apply", { id }),
  perfProfileDelete: (id: string) => call<void>("perf_profile_delete", { id }),
  perfDumpsDelete: (names: string[]) => call<number>("perf_dumps_delete", { names }),
  perfSetPriority: (level: string) => call<string>("perf_set_priority", { level }),
  memorySet: (limitMb: number) => call<T.MemoryStatus>("memory_set", { limitMb }),
  appUpdateCheck: () => call<T.AppUpdate | null>("app_update_check"),
  appUpdateInstall: (update: T.AppUpdate) => call<void>("app_update_install", { update }),
  menuThemePreview: (opts: T.ThemeOptions) => call<T.ThemePreview[]>("menu_theme_preview", { opts }),
  buildMenuTheme: (opts: T.ThemeOptions, enable = true) => call<T.Manifest>("build_menu_theme", { opts, enable }),
  showcase: (unit?: string | null) => call<T.Showcase | null>("showcase", { unit: unit ?? null }),
  laaStatus: () => call<T.LaaStatus | null>("laa_status"),
  laaSet: (enabled: boolean) => call<T.LaaStatus>("laa_set", { enabled }),
  shadersStatus: () => call<T.ShaderStatus | null>("shaders_status"),
  shadersApply: (preset: string | null) => call<T.ShaderStatus>("shaders_apply", { preset }),
  shadersReset: () => call<T.ShaderStatus>("shaders_reset"),
  shadersRemove: (reshade: boolean) => call<T.ShaderStatus>("shaders_remove", { reshade }),
  shadersInstallReshade: (preset: string | null) => call<T.ShaderStatus>("shaders_install_reshade", { preset }),
  maptkStatus: () => call<T.MaptkStatus>("maptk_status"),
  maptkCatalog: () => call<{ terrains: T.Terrain[] }>("maptk_run", { command: "catalog", input: {} }),
  maptkPreview: (terrain: string, size = 512) => call<T.TerrainPreview>("maptk_run", { command: "preview", input: { terrain, size } }),
  maptkExamples: () => call<{ examples: { key: string; spec: Record<string, unknown> }[] }>("maptk_run", { command: "examples", input: {} }),
  mapAssets: () => call<T.MapAssets>("map_assets"),
  // projetos de criação (abas de mapa, tropa e modelo)
  creations: () => call<T.CreationMeta[]>("creations_list"),
  creationCreate: (kind: T.CreationKind, name: string, doc: unknown) => call<T.CreationMeta>("creation_create", { kind, name, doc }),
  creationLoad: <D>(id: string) => call<T.CreationLoaded<D>>("creation_load", { id }),
  creationSave: (id: string, doc: unknown, snapshot: boolean) => call<T.CreationMeta>("creation_save", { id, doc, snapshot }),
  creationAutosave: (id: string, doc: unknown) => call<void>("creation_autosave", { id, doc }),
  creationRecovery: <D>(id: string) => call<D>("creation_recovery", { id }),
  creationDiscardRecovery: (id: string) => call<void>("creation_discard_recovery", { id }),
  creationVersions: (id: string) => call<T.CreationVersion[]>("creation_versions", { id }),
  creationRestore: <D>(id: string, file: string) => call<D>("creation_restore", { id, file }),
  creationUpdate: (id: string, patch: { name?: string; description?: string; favorite?: boolean; tags?: string[] }) => call<T.CreationMeta>("creation_update", { id, ...patch }),
  creationSetThumb: (id: string, png: string) => call<void>("creation_set_thumb", { id, png }),
  creationThumb: (id: string) => call<string | null>("creation_thumb", { id }),
  creationDuplicate: (id: string) => call<T.CreationMeta>("creation_duplicate", { id }),
  creationDelete: (id: string) => call<void>("creation_delete", { id }),
  creationAssetPut: (id: string, name: string, data: string) => call<string>("creation_asset_put", { id, name, data }),
  creationAsset: (id: string, name: string) => call<string>("creation_asset", { id, name }),
  creationAssetCopy: (id: string, name: string, dest: string) => call<void>("creation_asset_copy", { id, name, dest }),
  creationAssets: (id: string) => call<T.CreationAsset[]>("creation_assets", { id }),
  creationExport: (id: string, dest: string) => call<void>("creation_export", { id, dest }),
  creationImport: (path: string) => call<T.CreationMeta>("creation_import", { path }),
  unitCatalog: () => call<T.UnitInfo[]>("unit_catalog"),
  unitDetails: (id: string) => call<T.UnitDetails>("unit_details", { id }),
  unitAnimations: () => call<string[]>("unit_animations"),
  unitPreview: (id: string) => call<T.UnitPreview>("unit_preview", { id }),
  animRead: (path: string) => call<T.ScaAnimation>("anim_read", { path }),
  unitBuild: (creation: string, req: T.UnitBuildReq) => call<T.UnitBuildResult>("unit_build", { creation, req }),
  unitBlueprintPreview: (req: T.UnitBuildReq) => call<string>("unit_blueprint_preview", { req }),
  animCreate: (creation: string, name: string, source: { unit?: string; model?: string }, keys: T.AnimKey[], duration: number, fps = 30) =>
    call<string>("anim_create", { creation, name, source, keys, duration, fps }),
  modelPrepare: (id: string, baked: T.BakedModel) => call<{ triangles: number; warnings: string[] }>("model_prepare", { id, baked }),
  modelBaked: (id: string) => call<T.BakedModel | null>("model_baked", { id }),
  modelExportGame: (baked: T.BakedModel, dir: string, name: string) => call<string[]>("model_export_game", { baked, dir, name }),
  gameTexture: (path: string, max = 128) => call<string>("game_texture", { path, max }),
  propPreview: (bp: string, lod = 0) => call<T.PropPreview>("prop_preview", { bp, lod }),
  maptkTerrain3d: (terrain: string, size = 256) => call<T.Terrain3D>("maptk_terrain3d", { terrain, size }),
  maptkBuild: (spec: Record<string, unknown>) => call<{ result: T.MapBuildResult; manifest: T.Manifest }>("maptk_build", { spec }),

  openPath: (path: string, reveal = false) => call<void>("open_path", { path, reveal }),
};
