import { create } from "zustand";
import { api, onProgress } from "./api";
import type * as T from "./types";

export type Page = "me" | "home" | "library" | "hub" | "multiplayer" | "studio" | "settings";

export interface AppUpdate { version: string; url: string; notes: string }

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
  go: (p: Page) => void;
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
  go: (page) => set((s) => (s.page === page ? {} : { page, history: [...s.history.slice(-30), s.page] })),
  back: () => set((s) => (s.history.length ? { page: s.history[s.history.length - 1], history: s.history.slice(0, -1) } : {})),
  setPalette: (palette) => set({ palette }),
  refresh: async () => {
    const [dashboard, profiles, settings] = await Promise.all([api.dashboard(), api.getProfiles(), api.getSettings()]);
    set({ dashboard, profiles, settings });
    await get().refreshMods();
  },
  refreshMods: async () => {
    const [mods, dashboard] = await Promise.all([api.listMods(), api.dashboard()]);
    set({ mods, dashboard });
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

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
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
  return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} ${u[i]}`;
};

export const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/** "1 alteração" / "3 alterações" */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
