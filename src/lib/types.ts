// Espelho dos tipos serializados pelo núcleo em Rust (serde camelCase).

export type Category =
  | "gameplay" | "balance" | "maps" | "textures" | "ui" | "models" | "audio" | "fixes" | "library" | "other";
export type MpPolicy = "sync" | "local";

export interface ModFile { name: string; sha256: string; size: number }
export interface Dependency { id: string; version?: string }
export interface Source { kind: string; url?: string; hubId?: string }

export interface Manifest {
  schema: number;
  id: string;
  name: string;
  version: string;
  authors: string[];
  description: string;
  category: Category;
  tags: string[];
  requiresDlc: boolean;
  files: ModFile[];
  dependencies: Dependency[];
  conflicts: string[];
  multiplayer: MpPolicy;
  homepage?: string;
  license?: string;
  icon?: string;
  source: Source;
  installedAt?: string;
}

export interface ModView { manifest: Manifest; dir: string; icon?: string | null; enabled: boolean; order?: number | null }

export interface ProfileMod { id: string; enabled: boolean }
export interface Profile { id: string; name: string; mods: ProfileMod[]; notes: string }
export interface ProfileSet { active: string; profiles: Profile[] }

export type Store = "steam" | "gog" | "manual";
export interface GameInstall { root: string; gamedata: string; exe?: string | null; store: Store }

export interface Plan {
  add: string[]; replace: string[]; remove: string[]; restore: string[]; unchanged: string[]; warnings: string[];
}

export interface Dashboard {
  game: GameInstall | null;
  gameRunning: boolean;
  activeProfile: string;
  activeProfileName: string;
  enabledMods: number;
  installedMods: number;
  deployedProfile?: string | null;
  deployedAt?: string | null;
  inSync: boolean;
  pending: Plan;
  hasBaseline: boolean;
  unmanagedFiles: string[];
}

export type LaunchMode = "steam" | "direct";
export interface Settings {
  gamePath?: string | null;
  launchMode: LaunchMode;
  launchArgs: string[];
  applyBeforeLaunch: boolean;
  restoreOnExit: boolean;
  hubUrls: string[];
  pythonPath?: string | null;
  checkModUpdates: boolean;
  onboarded: boolean;
  serverUrl?: string | null;
  nickname: string;
  checkAppUpdates: boolean;
  keepLargeAddress: boolean;
  memoryLimitMb?: number | null;
  showcaseTeamColor?: string | null;
  gamePriority?: string;
  showcaseUnit?: string | null;
  showcase: boolean;
  /** modo local: desliga tudo que usa rede */
  offline?: boolean;
  autoBackupDays?: number;
  uiPrefs?: Record<string, unknown>;
}

export interface ServerInfo { name: string; motd: string; version: string; rooms: number; online: number; hub: boolean }
export interface Room {
  id: string; name: string; host: string; players: string[]; maxPlayers: number; private: boolean;
  status: "aguardando" | "em partida"; mods: string[]; fingerprint?: string | null; createdAt: string; syncCode?: string;
}
export interface ChatMsg { nick: string; text: string; at: string }

export interface FileStatus {
  name: string; size: number;
  origin: "stock" | "unmanaged" | "managed" | "new";
  modId?: string | null;
  state: "ok" | "modified" | "missing";
}

export interface PairConflict {
  loser: string; loserMod?: string | null; winner: string; winnerMod?: string | null; count: number; samples: string[];
}
export interface ConflictReport { betweenMods: PairConflict[]; overridesStock: PairConflict[]; mountOrder: string[] }

export interface Fingerprint { code: string; full: string; files: [string, string][] }
export interface SyncMod { id: string; name: string; version: string; hubId?: string; url?: string; files: [string, string][] }
export interface SyncPayload { v: number; profile: string; mods: SyncMod[]; fingerprint?: string }
export interface SyncItem {
  id: string; name: string; version: string; state: "ok" | "different" | "missing";
  installedVersion?: string | null; hubId?: string | null; url?: string | null;
}

export interface HubPackage { url: string; sha256: string; size: number; kind: "zip" | "scd"; fileName?: string }
export interface HubVersion {
  version: string; releasedAt?: string; changelog: string; requiresDlc: boolean; multiplayer: MpPolicy;
  dependencies: Dependency[]; conflicts: string[]; package: HubPackage;
}
export interface HubMod {
  id: string; name: string; summary: string; description: string; authors: string[]; category: Category; tags: string[];
  homepage?: string; icon?: string; screenshots: string[]; downloads: number; rating?: number; license?: string;
  versions: HubVersion[];
}
export interface HubIndex { schema: number; name: string; updatedAt?: string; mods: HubMod[]; sourceUrl: string }
export interface UpdateInfo { id: string; name: string; installed: string; latest: string; changelog: string; indexUrl: string }

export interface ArchiveInfo { name: string; size: number; origin: FileStatus["origin"]; modId?: string | null }
export interface ScdEntry { name: string; key: string; size: number; compressed: number; isDir: boolean }
export interface EntryView { kind: string; size: number; text?: string | null; compiled: boolean; warnings: string[]; textFrom?: string | null }

export type DdsFormat = "dxt1" | "dxt3" | "dxt5" | "ati1" | "ati2" | "bgra8" | "bgrx8" | "bgr8" | "rgb565" | "l8";
export interface DdsInfo { width: number; height: number; mipCount: number; format: DdsFormat; isCubemap: boolean; isVolume?: boolean }
export interface TextureView { info: DdsInfo; png: string }
export interface ColorAdjust {
  hue: number; saturation: number; brightness: number; contrast: number; tint?: [number, number, number] | null; tintStrength: number;
}

export interface MeshView {
  positions: number[]; normals: number[]; uvs: number[]; indices: number[];
  bones: { name: string; parent: number; position: [number, number, number]; rotation?: [number, number, number, number]; world?: [number, number, number] }[];
  bboxMin: [number, number, number]; bboxMax: [number, number, number];
  version: number; triangles: number; info: string;
}

export interface Project {
  id: string; name: string; version: string; description: string; category: Category; multiplayer: MpPolicy;
  archiveName: string; createdAt: string;
}
export interface ProjectFile { path: string; size: number; kind: "lua" | "texture" | "model" | "blueprint" | "audio" | "other" }

/** Mod de trapaças para jogar sozinho (montado com os arquivos do jogo). */
export interface CheatOptions { mass: boolean; energy: boolean; research: boolean; unlockAll: boolean; god: boolean; buildSpeed: number; aiToo: boolean; menu: boolean; key: string; tab: boolean }
export interface UiSkinOptions { name: string; adjust: ColorAdjust; prefixes: string[]; exclude: string[]; quality: "fast" | "normal" | "best" }

export interface PythonInfo { program: string; prefixArgs: string[]; version: string }
export interface MaptkStatus { python?: PythonInfo | null; ready: boolean; message?: string | null }
export interface Terrain {
  id: string; archive: string; kind: "skirmish" | "campaign" | "other"; name?: string | null; biome?: string | null;
  waterY?: number | null; openness?: number | null; navmesh?: string | null; players?: number | null; notes?: string | null;
}
/** Relevo amostrado para o editor 3D (alturas em base64, u16 little-endian). */
export interface Terrain3D {
  terrain: string; grid: number; size: number; heights: string; heightScale: number;
  yMin: number; yMax: number; waterLevel: number; texture: string | null;
  /** decorações do terreno: [x, z, y, yaw, escala, índice em propKinds] */
  props?: [number, number, number, number, number, number][]; propKinds?: string[];
}
export interface MapBuildResult {
  mass?: number; sites?: number; warnings?: string[]; extraMass?: number; propsAdded?: number; propsRemoved?: number; reskinned?: number; [k: string]: unknown;
}
export interface TerrainPreview {
  path: string; dataUrl: string; terrain: string; grid: number; size: number; nLayers: number; landLayer: number;
  waterLevel: number; navigablePct: number;
}

export interface AppInfo { version: string; dataDir: string; resourcesDir?: string | null; os: string }
export interface ProgressEvent { task: string; step: number; total: number; message: string }

export const CATEGORY_LABEL: Record<Category, string> = {
  gameplay: "Jogabilidade",
  balance: "Balanceamento",
  maps: "Mapas",
  textures: "Texturas",
  ui: "Interface",
  models: "Modelos 3D",
  audio: "Áudio",
  fixes: "Correções",
  library: "Biblioteca",
  other: "Outros",
};

export interface ShaderPreset { id: string; name: string; description: string; customized: boolean }
export interface ShaderStatus {
  binDir: string; reshade: boolean; reshadeVersion?: string | null; foreignDll: boolean;
  packInstalled: boolean; packVersion?: string | null; updateAvailable: boolean;
  preset?: string | null; presets: ShaderPreset[]; toggleKey: string; menuKey: string;
}

export type EnhanceMode = "upscale" | "sharpen" | "skip";
export interface SizeBucket { width: number; height: number; format: string; mipmaps: boolean; skip: boolean; keepSize: boolean; count: number }
export interface EnhanceGroup { group: string; textures: number; bytes: number; suggested: EnhanceMode; sample: string[]; buckets: SizeBucket[] }
export interface EnhanceOptions { name: string; groups: { group: string; mode: EnhanceMode }[]; scale: number; maxSize: number; sharpness: number; deblock: number; quality: "fast" | "normal" | "best" }
export interface EnhancePreview { before: string; after: string; info: DdsInfo; width: number; height: number; class: "color" | "normal" | "data" | "skip" }

export interface LaaStatus { exe: string; is64bit: boolean; enabled: boolean; patchedByUs: boolean; revertedByUpdate: boolean; steamStub: boolean }

export interface Showcase { unit: string; mesh: MeshView; albedo?: string | null; team?: string | null; mask?: string | null; units: string[] }

/** Tema "Menu moderno" para os menus do jogo. */
export interface ThemeOptions {
  name: string; recolor: boolean; fonts: boolean; accent: string; hover: string;
  bgDarkness: number; bgTint: number; panelOpacity: number; glow: number; sharpness: number; deblock: number;
}
export interface ThemePreview { key: string; before: string; after: string; width: number; height: number }

export interface SystemMemory { totalMb: number; availableMb: number }
export interface MemoryStatus { system: SystemMemory; limitMb: number; recommendedMb: number; choices: number[]; laa: LaaStatus | null }
export interface AppUpdate { version: string; notes: string; url: string; assetName?: string | null; assetUrl?: string | null; size: number; sha256?: string | null }

export interface PropInfo { bp: string; name: string; category: string; size?: [number, number, number] | null }
export interface LayerSet { map: string; name: string; d: string; n?: string | null; s?: string | null; slotD: number; slotN: number; slotS: number; /** repetições por unidade no mapa de origem */ tile?: number | null }
/** Céu de um mapa do jogo (caixa do céu, reflexo e correção de cor) */
export interface SkyInfo { map: string; env: string; sky: string; sight: string; fog: string; color: [number, number, number] }
export interface MapAssets { props: PropInfo[]; layers: LayerSet[]; skies?: SkyInfo[] }
export interface PropPreview { mesh: MeshView; texture?: string | null; /** posições, normais, uvs e índices em base64 (o app manda assim; a api.ts desfaz) */ bin?: [string, string, string, string] }

// ---------------------------------------------------------------- projetos de criação
export type CreationKind = "map" | "unit" | "model";
export interface CreationMeta {
  id: string; kind: CreationKind; name: string; description: string;
  createdAt: string; updatedAt: string; favorite: boolean; tags: string[];
  builtMod?: string | null; hasThumb: boolean;
}
export interface CreationLoaded<D = unknown> { meta: CreationMeta; doc: D; recoveryAt: string | null; repaired?: string | null }
export interface StorageItem { key: string; label: string; path: string; bytes: number }
export interface StorageReport { dataDir: string; items: StorageItem[]; total: number }
export interface BackupEntry { path: string; name: string; createdAt: string; size: number; auto: boolean; projects: number }
export interface RestoreReport { restored: string[]; skipped: string[] }
export interface TrashItem { entry: string; id: string; name: string; kind: CreationKind; deletedAt: string; size: number }
export interface CreationVersion { file: string; savedAt: string; size: number }
export interface CreationAsset { name: string; size: number }

// ---------------------------------------------------------------- tropas e modelos
export interface UnitInfo { id: string; name: string; faction: string; role: string; description: string; categories?: string[] }
export interface BpLeaf { path: string; kind: "number" | "text" | "bool"; number: number | null; text: string | null; flag: boolean | null }
export interface UnitDetails {
  id: string; name: string; description: string; faction: string; role: string; text: string;
  leaves: BpLeaf[]; categories: string[]; weapons: { index: number; label: string; dummy: boolean }[];
  animations: [string, string][]; bones: string[]; files: [string, number][]; mesh: string | null; albedo: string | null;
}
export interface UnitPreview { mesh: MeshView; boneIndex: number[]; albedo: string | null; team: string | null }
export interface ScaAnimation {
  version: number; duration: number; bones: string[]; parents: number[];
  deltaPosition: [number, number, number]; deltaRotation: [number, number, number, number];
  frames: { time: number; flags: number; positions: [number, number, number][]; rotations: [number, number, number, number][] }[];
}
export interface UnitBuildReq {
  base: string; newId: string; name: string; description: string;
  overrides: Record<string, number | string | boolean>; categories: string[] | null; scale: number | null;
  animations: [string, string, number | null][]; modelCreation: string | null; albedoAsset: string | null; tint: [number, number, number];
  weaponCopies?: [number, string, number][]; iconAsset?: string | null; boneMap?: Record<string, string>; pack?: string | null;
  mix?: MixSpec | null;
}
export interface MixSpec { chassis: string; turret: string | null; weapon: string | null; turretScale: number; weaponScale: number; turretOffset: [number, number, number]; turretYaw: number }
export interface MixCheck { level: "ok" | "warn" | "err" | "fix"; text: string }
export interface MixPreview extends UnitPreview { checks: MixCheck[]; bones: string[] }
export interface UnitPack { slug: string; name: string; units: string[] }
export interface Finding { level: "err" | "warn" | "ok"; area: string; text: string }
export interface UnitBuildResult { report: { files: number; warnings: string[]; blueprint: string; checks?: Finding[] }; manifest: Manifest }
export interface BakedModel {
  positions: number[]; normals: number[]; uvs: number[]; indices: number[]; boneIndex: number[];
  bones: { name: string; parent: number; pos: [number, number, number]; rot: [number, number, number, number] }[];
  albedoPng: string; teamPng: string | null; glowPng: string | null;
}
export interface AnimKey { bone: string; time: number; pos: [number, number, number]; rot: [number, number, number] }

// ------------------------------------------------------------------ Otimizador (Desempenho)
export type PrefValue = boolean | number | string;
export interface PrefOption { path: string; value: PrefValue }
export interface PrefsInfo { path: string; exists: boolean; options: PrefOption[]; error: string | null }
export interface PrefsBackup { name: string; size: number; modified: string | null }
export interface PrefProfile { id: string; name: string; description: string; createdAt: string; values: [string, PrefValue][] }
export interface DumpInfo { code: number; codeName: string; address: number; module: string | null; moduleOffset: number | null; modules: number; hint: string }
export interface CrashDump { name: string; size: number; modified: string | null; info: DumpInfo | null; error: string | null }
export interface PerfReport {
  prefs: PrefsInfo | null; backups: PrefsBackup[]; profiles: PrefProfile[]; dumps: CrashDump[];
  version: string | null; latest: boolean | null; knownLatest: string; exe: string | null;
  priority: string; priorities: string[]; modsEnabled: number;
}
export interface ProcessStats { pid: number; memoryMb: number; virtualMb: number; cpuPercent: number; runSeconds: number }
export interface PrefsWriteReport { backup: string | null; changed: number; skipped: string[] }
