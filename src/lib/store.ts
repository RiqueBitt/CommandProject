import { visibleMods } from "./features";
import { locale, t, tr } from "./i18n";
import { create } from "zustand";
import { api, onProgress } from "./api";
import type * as T from "./types";

export type Page = "me" | "home" | "library" | "hub" | "multiplayer" | "studio" | "create" | "performance" | "settings" | "files" | "icons" | "bigmatch";

export type AppUpdate = T.AppUpdate;

export interface Toast { id: number; kind: "ok" | "error" | "info"; text: string }

interface State {
  page: Page;
  dashboard: T.Dashboard | null;
  mods: T.ModView[];
  profiles: T.ProfileSet | null;
  settings: T.Settings | null;
  info: T.AppInfo | null;
  toasts: Toast[];
  /** progresso por tarefa (apply, purge, hub:<id>, skin, map...) */
  progress: Record<string, T.ProgressEvent>;
  busy: Record<string, boolean>;
  history: Page[];
  palette: boolean;
  appUpdate: AppUpdate | null;
  /** O jogo travou na última vez que foi aberto (relatório .mdmp novo na pasta bin). */
  crash: { dump: string; mods: [string, string][] } | null;
  go: (p: Page) => void;
  /** Filtro da biblioteca de projetos (Mapas, Tropas, Modelos) */
  createKind: T.CreationKind | "all";
  goCreate: (k: T.CreationKind | "all") => void;
  /** Aba a abrir no Estúdio na próxima visita (ex.: "hd"). */
  studioTab: string | null;
  setStudioTab: (t: string | null) => void;
  /** Seção das Configurações a abrir na próxima visita (ex.: "atualizacoes"). */
  settingsSection: string | null;
  openSettings: (section: string) => void;
  back: () => void;
  setPalette: (open: boolean) => void;
  refresh: () => Promise<void>;
  refreshMods: () => Promise<void>;
  toast: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
  /** Executa uma ação marcando-a como ocupada e mostrando erros como toast. */
  run: <R>(key: string, fn: () => Promise<R>, ok?: string | ((r: R) => string)) => Promise<R | undefined>;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  page: "home",
  dashboard: null,
  mods: [],
  profiles: null,
  settings: null,
  info: null,
  toasts: [],
  progress: {},
  busy: {},
  history: [],
  palette: false,
  appUpdate: null,
  crash: null,
  createKind: "all",
  goCreate: (createKind) => { set({ createKind }); get().go("create"); },
  studioTab: null,
  setStudioTab: (studioTab) => set({ studioTab }),
  settingsSection: null,
  openSettings: (section) => { set({ settingsSection: section }); get().go("settings"); },
  go: (page) => {
    // ir para uma tela do launcher sai da aba de projeto (o projeto continua aberto na aba)
    void import("./tabs").then(({ useTabs }) => { if (useTabs.getState().active) useTabs.getState().activate(null); });
    set((s) => (s.page === page ? {} : { page, history: [...s.history.slice(-30), s.page] }));
  },
  back: () => set((s) => (s.history.length ? { page: s.history[s.history.length - 1], history: s.history.slice(0, -1) } : {})),
  setPalette: (palette) => set({ palette }),
  refresh: async () => {
    // uma rodada só, em paralelo (o painel é a consulta mais cara: não pedir duas vezes)
    const [dashboard, profiles, settings, mods] = await Promise.all([api.dashboard(), api.getProfiles(), api.getSettings(), api.listMods()]);
    set({ dashboard, profiles, settings, mods: visibleMods(mods) });
  },
  refreshMods: async () => {
    const [mods, dashboard] = await Promise.all([api.listMods(), api.dashboard()]);
    set({ mods: visibleMods(mods), dashboard });
  },
  toast: (kind, text) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), kind === "error" ? 9000 : 4200);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  run: async (key, fn, ok) => {
    if (get().busy[key]) return undefined;
    set((s) => ({ busy: { ...s.busy, [key]: true } }));
    try {
      const r = await fn();
      if (ok) get().toast("ok", typeof ok === "function" ? ok(r) : ok);
      return r;
    } catch (e) {
      get().toast("error", errorText(e));
      return undefined;
    } finally {
      set((s) => {
        const busy = { ...s.busy };
        delete busy[key];
        const progress = { ...s.progress };
        delete progress[key];
        return { busy, progress };
      });
    }
  },
}));

/** Troca o perfil ativo e abre a tela inicial (ignora cliques repetidos enquanto troca). */
export async function switchProfile(id: string, name: string, alreadyActive = false) {
  const { run, refresh, go } = useStore.getState();
  if (!alreadyActive) {
    const ok = await run("profile", () => api.setActiveProfile(id), t('Perfil "{name}" ativo.', { name }));
    if (ok === undefined) return;
  }
  await refresh();
  go("home");
}

/** Carrega dados de uma tela (sem a trava de "ocupado" do `run`): cada montagem da tela busca de
 * novo, e um erro vira aviso em vez de uma lista vazia falsa. */
export async function load<R>(fn: () => Promise<R>): Promise<R | undefined> {
  try {
    return await fn();
  } catch (e) {
    useStore.getState().toast("error", errorText(e));
    return undefined;
  }
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return tr(e);
  if (e instanceof Error) return tr(e.message);
  return tr(String(e));
}

// liga os eventos de progresso do backend ao estado
void onProgress((e) => {
  useStore.setState((s) => ({ progress: { ...s.progress, [e.task]: e } }));
});

export const fmtBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(locale(), { minimumFractionDigits: v < 10 ? 1 : 0, maximumFractionDigits: v < 10 ? 1 : 0, useGrouping: false })} ${u[i]}`;
};

export const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** "1 alteração" / "3 alterações" (as palavras passam por t(): coloque-as no dicionário) */
export const plural = (n: number, one: string, many: string) => `${n.toLocaleString(locale())} ${t(n === 1 ? one : many)}`;

// ---- preferências da interface guardadas no settings.json (arquivo local) ----
let prefTimer: number | undefined;
export function getUiPref<T>(key: string): T | undefined {
  return useStore.getState().settings?.uiPrefs?.[key] as T | undefined;
}
export function setUiPref(key: string, value: unknown) {
  const s = useStore.getState().settings;
  if (!s) return;
  const next = { ...s, uiPrefs: { ...(s.uiPrefs ?? {}), [key]: value } };
  useStore.setState({ settings: next });
  window.clearTimeout(prefTimer);
  prefTimer = window.setTimeout(() => {
    const cur = useStore.getState().settings;
    if (cur) void api.saveSettings(cur).catch(() => {});
  }, 600);
}

// testes de tela no navegador (só no modo de desenvolvimento)
if (import.meta.env.DEV) (window as unknown as { __cpGo?: (p: Page) => void }).__cpGo = (p) => useStore.getState().go(p);
