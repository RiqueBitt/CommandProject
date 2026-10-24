// Abas de projeto (mapas, tropas e modelos), como as abas de lugar do Roblox Studio: cada projeto
// aberto tem a sua, continua montado ao trocar de aba (sem perder a edição) e a lista de abas
// abertas volta quando o launcher abre de novo.
import { create } from "zustand";
import type { CreationKind, CreationMeta } from "./types";

export interface ProjectTab { id: string; kind: CreationKind; title: string; dirty: boolean }

interface TabsState {
  tabs: ProjectTab[];
  /** `null` = o launcher (perfis, mods, hub…) */
  active: string | null;
  open: (meta: Pick<CreationMeta, "id" | "kind" | "name">) => void;
  close: (id: string) => void;
  activate: (id: string | null) => void;
  setDirty: (id: string, dirty: boolean) => void;
  rename: (id: string, title: string) => void;
  /** Quem cuida de salvar antes de fechar (o editor registra). */
  savers: Record<string, () => Promise<boolean>>;
  registerSaver: (id: string, fn: (() => Promise<boolean>) | null) => void;
}

const KEY = "cp.tabs";

function restore(): { tabs: ProjectTab[]; active: string | null } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && Array.isArray(v.tabs)) {
      const tabs = (v.tabs as ProjectTab[]).filter((t) => t && typeof t.id === "string").map((t) => ({ ...t, dirty: false }));
      return { tabs, active: tabs.some((t) => t.id === v.active) ? v.active : null };
    }
  } catch { /* sem localStorage: começa sem abas */ }
  return { tabs: [], active: null };
}

function persist(s: { tabs: ProjectTab[]; active: string | null }) {
  try { localStorage.setItem(KEY, JSON.stringify({ tabs: s.tabs, active: s.active })); } catch { /* ignora */ }
}

export const useTabs = create<TabsState>((set, get) => ({
  ...restore(),
  savers: {},
  open: (meta) => {
    set((s) => {
      const tabs = s.tabs.some((t) => t.id === meta.id) ? s.tabs : [...s.tabs, { id: meta.id, kind: meta.kind, title: meta.name, dirty: false }];
      return { tabs, active: meta.id };
    });
    persist(get());
  },
  close: (id) => {
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      const active = s.active === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active;
      const savers = { ...s.savers };
      delete savers[id];
      return { tabs, active, savers };
    });
    persist(get());
  },
  activate: (active) => { set({ active }); persist(get()); },
  setDirty: (id, dirty) => set((s) => (s.tabs.find((t) => t.id === id)?.dirty === dirty ? {} : { tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)) })),
  rename: (id, title) => { set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)) })); persist(get()); },
  registerSaver: (id, fn) => set((s) => {
    const savers = { ...s.savers };
    if (fn) savers[id] = fn; else delete savers[id];
    return { savers };
  }),
}));

export const KIND_META: Record<CreationKind, { label: string; icon: string; color: string; noun: string }> = {
  map: { label: "Mapa", icon: "map", color: "#7bd88f", noun: "mapa" },
  unit: { label: "Tropa", icon: "smart_toy", color: "#f2b33d", noun: "tropa" },
  model: { label: "Modelo 3D", icon: "view_in_ar", color: "#5aa9e6", noun: "modelo" },
};
