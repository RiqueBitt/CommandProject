// Documento de um projeto aberto numa aba: carregar, editar com desfazer/refazer, salvamento
// automático (para recuperar se o launcher cair), salvar com versões e miniatura.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { errorText, useStore } from "./store";
import { useTabs } from "./tabs";
import type { CreationMeta } from "./types";

export interface ProjectApi<D> {
  status: "loading" | "ready" | "error";
  error: string | null;
  meta: CreationMeta | null;
  doc: D;
  /** passo novo no histórico (desfazível) */
  commit: (fn: (d: D) => D) => void;
  /** muda o passo atual sem criar outro (continuação de um arrasto) */
  amend: (fn: (d: D) => D) => void;
  /** troca o documento inteiro (versão restaurada, recuperação) */
  replace: (d: D) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  saving: boolean;
  savedAt: number | null;
  save: (opts?: { version?: boolean; thumb?: string | null }) => Promise<boolean>;
  recoveryAt: string | null;
  acceptRecovery: () => Promise<void>;
  discardRecovery: () => Promise<void>;
  setMeta: (m: CreationMeta) => void;
}

const AUTOSAVE_MS = 15_000;
const VERSION_EVERY_MS = 5 * 60_000;

export function useProject<D>(id: string, migrate: (raw: unknown) => D, empty: D): ProjectApi<D> {
  const [status, setStatus] = useState<ProjectApi<D>["status"]>("loading");
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<CreationMeta | null>(null);
  const [hist, setHist] = useState<{ cur: D; past: D[]; future: D[] }>({ cur: empty, past: [], future: [] });
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [recoveryAt, setRecoveryAt] = useState<string | null>(null);
  const lastVersion = useRef(0);
  const autosaved = useRef<D | null>(null);
  const docRef = useRef(hist.cur);
  docRef.current = hist.cur;
  const setDirtyTab = useTabs((s) => s.setDirty);
  const registerSaver = useTabs((s) => s.registerSaver);

  const setDirty = useCallback((v: boolean) => {
    setDirtyState(v);
    setDirtyTab(id, v);
  }, [id, setDirtyTab]);

  useEffect(() => {
    let alive = true;
    api.creationLoad<unknown>(id).then((l) => {
      if (!alive) return;
      setMeta(l.meta);
      setHist({ cur: migrate(l.doc), past: [], future: [] });
      setRecoveryAt(l.recoveryAt);
      setStatus("ready");
    }).catch((e) => {
      if (!alive) return;
      setError(errorText(e));
      setStatus("error");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const commit = useCallback((fn: (d: D) => D) => {
    setHist((h) => {
      const n = fn(h.cur);
      return n === h.cur ? h : { cur: n, past: [...h.past.slice(-120), h.cur], future: [] };
    });
    setDirty(true);
  }, [setDirty]);
  const amend = useCallback((fn: (d: D) => D) => {
    setHist((h) => ({ ...h, cur: fn(h.cur) }));
    setDirty(true);
  }, [setDirty]);
  const replace = useCallback((d: D) => {
    setHist((h) => ({ cur: d, past: [...h.past.slice(-120), h.cur], future: [] }));
    setDirty(true);
  }, [setDirty]);
  const undo = useCallback(() => {
    setHist((h) => (h.past.length ? { cur: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.cur, ...h.future] } : h));
    setDirty(true);
  }, [setDirty]);
  const redo = useCallback(() => {
    setHist((h) => (h.future.length ? { cur: h.future[0], past: [...h.past, h.cur], future: h.future.slice(1) } : h));
    setDirty(true);
  }, [setDirty]);

  const save = useCallback(async (opts?: { version?: boolean; thumb?: string | null }) => {
    if (status !== "ready") return false;
    setSaving(true);
    try {
      const version = opts?.version || Date.now() - lastVersion.current > VERSION_EVERY_MS;
      const m = await api.creationSave(id, docRef.current, version);
      if (version) lastVersion.current = Date.now();
      if (opts?.thumb) await api.creationSetThumb(id, opts.thumb).catch(() => {});
      setMeta(m);
      setSavedAt(Date.now());
      setDirty(false);
      setRecoveryAt(null);
      autosaved.current = docRef.current;
      return true;
    } catch (e) {
      useStore.getState().toast("error", `Não deu para salvar: ${errorText(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [id, status, setDirty]);

  // salvamento automático (arquivo à parte: o documento salvo só muda quando você salva)
  useEffect(() => {
    if (status !== "ready") return;
    const h = setInterval(() => {
      if (!dirty || autosaved.current === docRef.current) return;
      autosaved.current = docRef.current;
      void api.creationAutosave(id, docRef.current).catch(() => {});
    }, AUTOSAVE_MS);
    return () => clearInterval(h);
  }, [id, status, dirty]);

  // a aba pede para salvar antes de fechar
  useEffect(() => {
    registerSaver(id, () => save());
    return () => registerSaver(id, null);
  }, [id, save, registerSaver]);

  const acceptRecovery = useCallback(async () => {
    try {
      const d = await api.creationRecovery<unknown>(id);
      replace(migrate(d));
      setRecoveryAt(null);
      useStore.getState().toast("ok", "Recuperei as alterações que não tinham sido salvas.");
    } catch (e) {
      useStore.getState().toast("error", errorText(e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, replace]);
  const discardRecovery = useCallback(async () => {
    await api.creationDiscardRecovery(id).catch(() => {});
    setRecoveryAt(null);
  }, [id]);

  return {
    status, error, meta, doc: hist.cur, commit, amend, replace, undo, redo,
    canUndo: hist.past.length > 0, canRedo: hist.future.length > 0,
    dirty, saving, savedAt, save, recoveryAt, acceptRecovery, discardRecovery, setMeta,
  };
}
