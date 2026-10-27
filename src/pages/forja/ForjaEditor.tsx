// Editor dos mods da Forja: abas de arquivos, editor com a API da Forja (autocompletar, ajuda,
// erros de sintaxe e avisos do Lua 5.0), trechos prontos, unidades do jogo, busca em todos os
// arquivos, formulário do mod.json, testar no jogo, erros da última partida e empacotar para o Hub.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorApi } from "../../components/LuaEditor";
import { CopyButton, Icon, Modal, Notice, Switch } from "../../components/ui";
import { api, pickFile } from "../../lib/api";
import { lintLua50, SNIPPETS } from "../../lib/forjaApi";
import { t } from "../../lib/i18n";
import { errorText, useStore } from "../../lib/store";
import type { ForjaDevMod, ForjaOption, ForjaOverview, MatchOptions, UnitInfo } from "../../lib/types";

const LuaEditor = lazy(() => import("../../components/LuaEditor"));

function stored(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
const sideOf = (file: string) => (file.startsWith("sim") ? "sim" : file.startsWith("ui") ? "ui" : file.startsWith("blueprints") ? "blueprints" : file.startsWith("menu") ? "menu" : "any");

interface Buf { saved: string; draft: string }
interface Hit { file: string; line: number; text: string }

export default function ForjaEditor({ devDir, refreshKey, onReloaded }: { devDir: string; refreshKey: number; onReloaded: (ov: ForjaOverview) => void }) {
  const toast = useStore((s) => s.toast);
  const running = useStore((s) => s.dashboard?.gameRunning);
  const [dir, setDir] = useState(() => stored("cp-forja-editor-dir", devDir));
  const [mods, setMods] = useState<ForjaDevMod[] | null>(null);
  const [modId, setModId] = useState(() => stored("cp-forja-editor-mod", ""));
  const [open, setOpen] = useState<string[]>([]);
  const [file, setFile] = useState("");
  const [bufs, setBufs] = useState<Record<string, Buf>>({});
  const [line, setLine] = useState<{ file: string; n: number; k: number } | null>(null);
  const [autoReload, setAutoReload] = useState(() => stored("cp-forja-autoreload", "1") === "1");
  const [saving, setSaving] = useState(false);
  const [side, setSide] = useState<"snippets" | "units" | "errors" | null>(() => (stored("cp-forja-side", "snippets") as "snippets") || null);
  const [search, setSearch] = useState(false);
  const [packed, setPacked] = useState<{ path: string; size: number; sha256: string; hub: unknown } | null>(null);
  const [jsonText, setJsonText] = useState(false);
  const [errors, setErrors] = useState<{ mod: string; file: string; line: number; text: string }[]>([]);
  const editor = useRef<EditorApi | null>(null);

  useEffect(() => { if (!dir && devDir) setDir(devDir); }, [devDir, dir]);
  useEffect(() => {
    try {
      localStorage.setItem("cp-forja-editor-dir", dir);
      localStorage.setItem("cp-forja-editor-mod", modId);
      localStorage.setItem("cp-forja-autoreload", autoReload ? "1" : "0");
      localStorage.setItem("cp-forja-side", side ?? "");
    } catch { /* ok */ }
  }, [dir, modId, autoReload, side]);

  const list = useCallback(async () => {
    if (!dir) return;
    try { setMods(await api.forjaDevMods(dir)); } catch (e) { setMods([]); toast("error", errorText(e)); }
  }, [dir, toast]);
  useEffect(() => { void list(); }, [list, refreshKey]);
  const loadErrors = useCallback(() => { void api.forjaGameErrors().then(setErrors).catch(() => setErrors([])); }, []);
  useEffect(() => { loadErrors(); }, [loadErrors, running]);

  const mod = mods?.find((m) => m.id === modId) ?? mods?.[0] ?? null;
  // trocar de mod fecha as abas do outro
  useEffect(() => { setOpen([]); setBufs({}); setFile(""); }, [mod?.path]);
  useEffect(() => {
    if (!mod || file) return;
    const first = mod.files.find((f) => f.endsWith(".lua")) ?? "mod.json";
    openFile(first);
  }, [mod, file]); // eslint-disable-line react-hooks/exhaustive-deps

  const readFile = async (f: string): Promise<string> => {
    if (bufs[f]) return bufs[f].draft;
    if (!mod) return "";
    const text = await api.forjaReadFile(mod.path, f);
    setBufs((b) => (b[f] ? b : { ...b, [f]: { saved: text, draft: text } }));
    return text;
  };
  const openFile = (f: string, n?: number) => {
    setOpen((o) => (o.includes(f) ? o : [...o, f]));
    setFile(f);
    if (n) setLine({ file: f, n, k: Date.now() });
    if (!bufs[f]) void readFile(f).catch((e) => toast("error", errorText(e)));
  };
  const closeFile = (f: string) => {
    const b = bufs[f];
    if (b && b.draft !== b.saved && !confirm(t("Descartar as mudanças em {file}?", { file: f }))) return;
    setOpen((o) => {
      const rest = o.filter((x) => x !== f);
      if (f === file) setFile(rest[rest.length - 1] ?? "");
      return rest;
    });
    setBufs((all) => { const n = { ...all }; delete n[f]; return n; });
  };

  const buf = bufs[file];
  const dirtyFiles = Object.entries(bufs).filter(([, b]) => b.draft !== b.saved).map(([f]) => f);
  const issues = file.endsWith(".lua") && buf ? lintLua50(buf.draft) : [];
  const setDraft = (text: string) => setBufs((b) => ({ ...b, [file]: { saved: b[file]?.saved ?? "", draft: text } }));

  /** Grava os arquivos alterados; com a recarga, monta o mod de novo (uma vez, no último). */
  const saveAll = useCallback(async (reload = autoReload) => {
    if (!mod || saving) return false;
    const dirty = Object.entries(bufs).filter(([, b]) => b.draft !== b.saved);
    setSaving(true);
    try {
      let ov: ForjaOverview | null = null;
      for (let i = 0; i < dirty.length; i++) {
        const [f, b] = dirty[i];
        const r = await api.forjaWriteFile(mod.path, f, b.draft, reload && i === dirty.length - 1);
        if (r) ov = r;
      }
      if (reload && !dirty.length) {
        // nada mudou mas pediram para recarregar (testar no jogo): grava o arquivo aberto de novo
        const f = file || "mod.json";
        const text = bufs[f]?.draft ?? (await readFile(f));
        ov = await api.forjaWriteFile(mod.path, f, text, true);
      }
      setBufs((all) => {
        const n = { ...all };
        for (const [f, b] of dirty) n[f] = { saved: b.draft, draft: n[f]?.draft ?? b.draft };
        return n;
      });
      if (ov) onReloaded(ov);
      if (dirty.length) toast("ok", ov ? t("Salvo e recarregado: {name} entra assim na próxima partida.", { name: mod.name }) : t("Salvo."));
      if (dirty.some(([f]) => f === "mod.json")) void list();
      return true;
    } catch (e) {
      toast("error", errorText(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [mod, saving, bufs, autoReload, file, onReloaded, toast, list]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+Shift+F: buscar em todos os arquivos
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setSearch(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /** Partida rápida para testar: o menor mapa do jogo, você contra uma IA fácil. */
  const testInGame = async () => {
    if (!(await saveAll(true))) return;
    try {
      const maps = await api.bigMatchMaps();
      const pick = maps.filter((m) => m.armies.length >= 2 && m.source === "Jogo").sort((a, b) => a.size[0] - b.size[0] || a.armies.length - b.armies.length)[0] ?? maps.find((m) => m.armies.length >= 2);
      if (!pick) { toast("error", t("Nenhum mapa encontrado para o teste.")); return; }
      const slots = pick.armies.map((_, i) => ({ kind: i === 0 ? "you" : i === 1 ? "ai" : "empty", team: 0, faction: 0, ai: "Easy", color: -1 })) as { kind: "you" | "ai" | "empty"; team: number; faction: number; ai: string; color: number }[];
      const options = { victory: "sandbox", unitCap: 500, fog: "none", speed: "normal", noRush: 0, prebuilt: false, civilians: "removed", restrictions: [], cheats: true, shareUnitCap: false, spawn: "fixed", weather: "", weatherAmount: 1, weatherSound: true } as unknown as MatchOptions;
      await useStore.getState().run("launch", () => api.launchBigMatch({ map: pick.path, size: pick.size[0], slots, options }), t("Abrindo o teste em {map}: você contra uma IA fácil, sem fim, trapaças do console ligadas.", { map: pick.name }));
      setSide("errors");
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const pack = async () => {
    if (!mod) return;
    if (!(await saveAll(false))) return;
    const dest = await pickFile([], true);
    if (!dest) return;
    try {
      setPacked(await api.forjaPack(mod.path, `${dest.replace(/[\\/]+$/, "")}/zz_${mod.id.replace(/-/g, "_")}.scd`));
    } catch (e) { toast("error", errorText(e)); }
  };

  const modErrors = errors.filter((e) => mods?.some((m) => m.id === e.mod));
  const isJson = file === "mod.json";

  return (
    <section className="card pad col forja-editor">
      <div className="card-title"><Icon name="code" /><h3>{t("Editor de mods")}</h3>
        <span className="grow" />
        <label className="row small" style={{ gap: 8 }} title={t("Ao salvar, o launcher monta o mod de novo e substitui o instalado: ele entra na próxima partida.")}>
          <Switch label={t("Recarregar ao salvar")} checked={autoReload} onChange={setAutoReload} /> {t("Recarregar ao salvar")}
        </label>
      </div>
      <div className="row wrap gap">
        <input className="input grow mono small" value={dir} onChange={(e) => setDir(e.target.value)} aria-label={t("Pasta dos mods em desenvolvimento")} />
        <button className="btn sm" onClick={async () => { const p = await pickFile([], true); if (p) setDir(p); }}><Icon name="folder_open" size={16} /> {t("Escolher")}</button>
        <button className="btn sm" onClick={() => void list()} title={t("Ler a pasta de novo")}><Icon name="refresh" size={16} /></button>
      </div>
      {mods && mods.length === 0 && <p className="faint small">{t("Nenhum mod nesta pasta. Crie um com \"Criar um mod\" (ele vai para esta pasta) ou escolha a pasta de um mod seu.")}</p>}
      {mod && mods && (
        <>
          <div className="forja-toolbar">
            <select className="select dense" value={mod.id} onChange={(e) => setModId(e.target.value)} aria-label={t("Mod")}>
              {mods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="btn sm primary" disabled={!dirtyFiles.length || saving} onClick={() => void saveAll()}><Icon name="save" size={16} /> {saving ? t("Salvando…") : dirtyFiles.length > 1 ? t("Salvar tudo ({n})", { n: dirtyFiles.length }) : t("Salvar (Ctrl+S)")}</button>
            <button className="btn sm" disabled={saving || !!running} onClick={() => void testInGame()} title={t("Salva, recarrega e abre uma partida rápida: você contra uma IA fácil, no menor mapa do jogo.")}><Icon name="play_arrow" size={16} /> {t("Testar no jogo")}</button>
            <button className="btn sm" onClick={() => setSearch(true)} title="Ctrl+Shift+F"><Icon name="search" size={16} /> {t("Buscar")}</button>
            <span className="grow" />
            <button className="btn sm" onClick={() => void pack()}><Icon name="inventory_2" size={16} /> {t("Empacotar")}</button>
            <div className="seg" role="tablist" aria-label={t("Painel")}>
              <button type="button" className="btn sm" aria-pressed={side === "snippets"} onClick={() => setSide(side === "snippets" ? null : "snippets")}><Icon name="playlist_add" size={16} /> {t("Inserir")}</button>
              <button type="button" className="btn sm" aria-pressed={side === "units"} onClick={() => setSide(side === "units" ? null : "units")}><Icon name="smart_toy" size={16} /> {t("Unidades")}</button>
              <button type="button" className="btn sm" aria-pressed={side === "errors"} onClick={() => { setSide(side === "errors" ? null : "errors"); loadErrors(); }}>
                <Icon name="bug_report" size={16} /> {t("Erros do jogo")} {modErrors.length > 0 && <span className="chip warn">{modErrors.length}</span>}
              </button>
            </div>
          </div>
          <div className={`forja-editor-body ${side ? "with-side" : ""}`}>
            <nav className="forja-files" aria-label={t("Arquivos do mod")}>
              <button type="button" className={`forja-file ${isJson ? "on" : ""}`} onClick={() => openFile("mod.json")}><Icon name="tune" size={15} /> {t("Mod (mod.json)")}</button>
              {mod.files.filter((f) => f !== "mod.json").map((f) => (
                <button key={f} type="button" className={`forja-file ${f === file ? "on" : ""}`} onClick={() => openFile(f)}>
                  <Icon name="description" size={15} /> {f}{dirtyFiles.includes(f) ? " •" : ""}
                </button>
              ))}
              <button type="button" className="btn sm text" onClick={() => {
                const name = prompt(t("Novo arquivo (ex.: lib/ajuda.lua):"), "lib/");
                if (name && /^[\w/.-]+\.lua$/.test(name) && !name.includes("..")) {
                  setMods((l) => l?.map((m) => (m.id === mod.id && !m.files.includes(name) ? { ...m, files: [...m.files, name] } : m)) ?? l);
                  setBufs((b) => ({ ...b, [name]: { saved: "", draft: "-- " + name + "\n" } }));
                  setOpen((o) => [...o, name]);
                  setFile(name);
                }
              }}><Icon name="add" size={15} /> {t("Arquivo")}</button>
            </nav>
            <div className="forja-code">
              <div className="forja-tabs" role="tablist">
                {open.map((f) => (
                  <span key={f} className={`forja-tab ${f === file ? "on" : ""}`} role="tab" aria-selected={f === file}>
                    <button type="button" onClick={() => setFile(f)}>{f === "mod.json" ? t("Mod") : f}{dirtyFiles.includes(f) ? " •" : ""}</button>
                    <button type="button" className="x" onClick={() => closeFile(f)} aria-label={t("Fechar")}>×</button>
                  </span>
                ))}
                <span className="grow" />
                {file.endsWith(".lua") && buf && (issues.length > 0
                  ? <button type="button" className="chip warn" onClick={() => editor.current?.goto(issues[0].line)}><Icon name="warning" size={14} /> {issues[0].syntax ? t("Erro de sintaxe na linha {n}", { n: issues[0].line }) : t("{n} aviso(s) do Lua 5.0", { n: issues.length })}</button>
                  : <span className="chip ok"><Icon name="check" size={14} /> {t("Lua 5.0 ok")}</span>)}
                {isJson && <button type="button" className="btn sm text" onClick={() => setJsonText((v) => !v)}><Icon name={jsonText ? "view_agenda" : "data_object"} size={15} /> {jsonText ? t("Formulário") : t("Texto")}</button>}
              </div>
              <div className="forja-code-host">
                {!buf ? <div className="bar indeterminate"><i /></div>
                  : isJson && !jsonText ? <ModForm text={buf.draft} onChange={setDraft} />
                  : (
                    <Suspense fallback={<div className="bar indeterminate"><i /></div>}>
                      <LuaEditor key={`${mod.path}/${file}/${line?.file === file ? line.k : 0}`} value={buf.draft} onChange={setDraft} onSave={() => void saveAll()}
                        forja={file.endsWith(".lua")} apiRef={editor} line={line?.file === file ? line.n : undefined} />
                    </Suspense>
                  )}
              </div>
              <p className="faint small">{t("Ctrl+Espaço lista a API da Forja; passe o mouse num nome para ver a ajuda. O sublinhado marca erros de sintaxe e o que não existe no Lua 5.0 do jogo. Ctrl+Shift+F busca em todos os arquivos.")}</p>
            </div>
            {side && (
              <aside className="forja-side">
                {side === "snippets" && <Snippets file={file} onInsert={(code) => editor.current?.insert(code)} disabled={!file.endsWith(".lua")} />}
                {side === "units" && <UnitsPanel onInsert={(id) => editor.current?.insert(`'${id}'`)} disabled={!file.endsWith(".lua")} />}
                {side === "errors" && (
                  <div className="col" style={{ gap: 8 }}>
                    <div className="row" style={{ gap: 6 }}><b className="grow">{t("Erros da última partida")}</b><button className="btn icon-btn sm" onClick={loadErrors} aria-label={t("Ler de novo")}><Icon name="refresh" size={16} /></button></div>
                    {modErrors.length === 0 ? <p className="faint small">{t("Nenhum erro dos seus mods no log da última partida aberta pelo launcher.")}</p> : modErrors.map((e, i) => (
                      <button key={i} type="button" className="forja-err" onClick={() => { if (e.mod !== mod.id) setModId(e.mod); openFile(e.file, e.line); }}>
                        <span className="mono small">{e.file}:{e.line}</span>
                        <span className="small">{e.text}</span>
                      </button>
                    ))}
                  </div>
                )}
              </aside>
            )}
          </div>
          {issues.some((i) => i.severity === "error") && <Notice kind="warn">{t("O jogo usa Lua 5.0: o código marcado não roda lá. Passe o mouse no sublinhado para ver como trocar.")}</Notice>}
        </>
      )}
      {!mods && dir && <div className="bar indeterminate"><i /></div>}
      {search && mod && <SearchModal files={mod.files} read={readFile} onOpen={(f, n) => { setSearch(false); openFile(f, n); }} onClose={() => setSearch(false)} />}
      {packed && (
        <Modal title={t("Mod empacotado")} icon="inventory_2" onClose={() => setPacked(null)} wide>
          <div className="col" style={{ gap: 10 }}>
            <p className="mono small selectable">{packed.path}</p>
            <p className="small">{t("{size} · sha256 {sha}", { size: `${(packed.size / 1024).toFixed(0)} KB`, sha: packed.sha256.slice(0, 16) + "…" })}</p>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sm" onClick={() => void api.openPath(packed.path.replace(/[\\/][^\\/]+$/, ""))}><Icon name="folder_open" size={16} /> {t("Abrir a pasta")}</button>
              <CopyButton text={JSON.stringify(packed.hub, null, 2)} label={t("Copiar entrada do Hub")} />
            </div>
            <p className="faint small">{t("Para publicar num índice do Hub: suba o .scd junto do index.json e cole esta entrada na lista \"mods\" (a tag forja dá o selo e o filtro de mods da Forja).")}</p>
            <pre className="forja-json">{JSON.stringify(packed.hub, null, 2)}</pre>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Snippets({ file, onInsert, disabled }: { file: string; onInsert: (code: string) => void; disabled: boolean }) {
  const s = sideOf(file);
  const list = SNIPPETS.filter((x) => x.side === "any" || x.side === s || s === "any");
  return (
    <div className="col" style={{ gap: 6 }}>
      <b>{t("Inserir trecho")}</b>
      <span className="faint small">{s === "any" ? t("Trechos para qualquer arquivo") : t("Trechos para {file}", { file })}</span>
      {list.map((sn) => (
        <button key={sn.label} type="button" className="forja-snippet" disabled={disabled} onClick={() => onInsert(sn.code)} title={sn.code}>
          <Icon name="add" size={15} /> {t(sn.label)}
        </button>
      ))}
    </div>
  );
}

let unitCache: UnitInfo[] | null = null;
function UnitsPanel({ onInsert, disabled }: { onInsert: (id: string) => void; disabled: boolean }) {
  const [units, setUnits] = useState<UnitInfo[] | null>(unitCache);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<UnitInfo | null>(null);
  useEffect(() => { if (!unitCache) void api.unitCatalog().then((u) => { unitCache = u; setUnits(u); }).catch(() => setUnits([])); }, []);
  const term = q.trim().toLowerCase();
  const shown = useMemo(() => (units ?? []).filter((u) => !term || `${u.id} ${u.name} ${u.faction} ${u.role} ${(u.categories ?? []).join(" ")}`.toLowerCase().includes(term)).slice(0, 80), [units, term]);
  return (
    <div className="col" style={{ gap: 6, minHeight: 0 }}>
      <b>{t("Unidades do jogo")}</b>
      <input className="input dense" placeholder={t("Nome, id, facção ou categoria…")} value={q} onChange={(e) => setQ(e.target.value)} />
      {!units && <div className="bar indeterminate"><i /></div>}
      <div className="forja-units">
        {shown.map((u) => (
          <button key={u.id} type="button" className={`forja-unit ${sel?.id === u.id ? "on" : ""}`} onClick={() => setSel(u)} onDoubleClick={() => !disabled && onInsert(u.id)}>
            <span className="mono small">{u.id}</span><span className="small">{u.name}</span><span className="faint small">{u.faction}</span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="forja-unit-card">
          <b>{sel.name}</b> <span className="mono small">{sel.id}</span>
          <p className="small muted">{sel.faction} · {sel.role}{sel.description ? ` · ${sel.description}` : ""}</p>
          {sel.categories && <p className="faint small">{sel.categories.join(" ")}</p>}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" disabled={disabled} onClick={() => onInsert(sel.id)}><Icon name="input" size={15} /> {t("Inserir id")}</button>
            <CopyButton text={sel.id} />
          </div>
        </div>
      )}
      <span className="faint small">{t("Clique duas vezes para inserir o id no código.")}</span>
    </div>
  );
}

function SearchModal({ files, read, onOpen, onClose }: { files: string[]; read: (f: string) => Promise<string>; onOpen: (f: string, line: number) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    let alive = true;
    const timer = window.setTimeout(async () => {
      const out: Hit[] = [];
      for (const f of files) {
        const text = await read(f).catch(() => "");
        text.split("\n").forEach((l, i) => { if (l.toLowerCase().includes(term.toLowerCase())) out.push({ file: f, line: i + 1, text: l.trim() }); });
      }
      if (alive) setHits(out.slice(0, 200));
    }, 180);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [q, files, read]);
  return (
    <Modal title={t("Buscar em todos os arquivos")} icon="search" onClose={onClose} wide>
      <div className="col" style={{ gap: 10 }}>
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Texto a procurar…")} />
        {hits && hits.length === 0 && <p className="faint small">{t("Nada encontrado.")}</p>}
        <div className="forja-hits">
          {hits?.map((h, i) => (
            <button key={i} type="button" className="forja-hit" onClick={() => onOpen(h.file, h.line)}>
              <span className="mono small faint">{h.file}:{h.line}</span><span className="mono small">{h.text}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- mod.json em formulário

interface Manifest {
  id: string; name: string; version: string; authors?: string[]; description?: string; loader?: string;
  dependencies?: { id: string; version?: string }[]; optionalDependencies?: { id: string }[]; loadAfter?: string[]; loadBefore?: string[]; conflicts?: string[];
  options?: ForjaOption[];
}

function ModForm({ text, onChange }: { text: string; onChange: (s: string) => void }) {
  let m: Manifest | null = null;
  try { m = JSON.parse(text) as Manifest; } catch { m = null; }
  if (!m) return <div className="pad"><Notice kind="warn">{t("O mod.json não é um JSON válido. Corrija na aba Texto.")}</Notice></div>;
  const man = m;
  const set = (patch: Partial<Manifest>) => onChange(JSON.stringify({ ...man, ...patch }, null, 2) + "\n");
  const list = (v?: string[]) => (v ?? []).join(", ");
  const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const opts = man.options ?? [];
  const setOpt = (i: number, patch: Partial<ForjaOption>) => set({ options: opts.map((o, k) => (k === i ? { ...o, ...patch } : o)) });
  return (
    <div className="forja-form">
      <div className="forja-form-grid">
        <label className="field"><span className="label">{t("Nome")}</span><input className="input" value={man.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="field"><span className="label">{t("Versão")}</span><input className="input" value={man.version} onChange={(e) => set({ version: e.target.value })} placeholder="1.0.0" /></label>
        <label className="field"><span className="label">{t("Id (nome da pasta)")}</span><input className="input mono" value={man.id} disabled /></label>
        <label className="field"><span className="label">{t("Autores")}</span><input className="input" value={list(man.authors)} onChange={(e) => set({ authors: parse(e.target.value) })} placeholder={t("separe por vírgula")} /></label>
      </div>
      <label className="field"><span className="label">{t("Descrição")}</span><textarea className="input" rows={2} value={man.description ?? ""} onChange={(e) => set({ description: e.target.value })} /></label>
      <div className="forja-form-grid">
        <label className="field"><span className="label">{t("Precisa destes mods")}</span><input className="input mono" value={(man.dependencies ?? []).map((d) => d.id).join(", ")} onChange={(e) => set({ dependencies: parse(e.target.value).map((id) => ({ id })) })} placeholder="outro-mod" /></label>
        <label className="field"><span className="label">{t("Carrega depois de")}</span><input className="input mono" value={list(man.loadAfter)} onChange={(e) => set({ loadAfter: parse(e.target.value) })} /></label>
        <label className="field"><span className="label">{t("Não funciona com")}</span><input className="input mono" value={list(man.conflicts)} onChange={(e) => set({ conflicts: parse(e.target.value) })} /></label>
      </div>
      <div className="row" style={{ gap: 8 }}><b className="grow">{t("Opções no launcher")}</b>
        <button type="button" className="btn sm" onClick={() => set({ options: [...opts, { key: `opcao${opts.length + 1}`, label: t("Nova opção"), description: "", type: "number", default: 1, min: 0, max: 10, step: 1 }] })}><Icon name="add" size={15} /> {t("Opção")}</button>
      </div>
      {opts.length === 0 && <p className="faint small">{t("Opções aparecem na tela da Forja para o jogador ajustar; no código, leia com mod.Option('chave').")}</p>}
      {opts.map((o, i) => (
        <div key={i} className="forja-opt">
          <div className="forja-form-grid">
            <label className="field"><span className="label">{t("Chave (no código)")}</span><input className="input mono" value={o.key} onChange={(e) => setOpt(i, { key: e.target.value.replace(/[^\w]/g, "") })} /></label>
            <label className="field"><span className="label">{t("Nome na tela")}</span><input className="input" value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} /></label>
            <label className="field"><span className="label">{t("Tipo")}</span>
              <select className="select" value={o.type} onChange={(e) => {
                const type = e.target.value as ForjaOption["type"];
                setOpt(i, { type, default: type === "bool" ? false : type === "number" ? 1 : type === "choice" ? (o.choices?.[0]?.value ?? "a") : "", choices: type === "choice" ? (o.choices?.length ? o.choices : [{ value: "a", label: "A" }, { value: "b", label: "B" }]) : undefined });
              }}>
                <option value="number">{t("Número")}</option><option value="bool">{t("Liga/desliga")}</option><option value="choice">{t("Lista")}</option><option value="text">{t("Texto")}</option>
              </select>
            </label>
            <label className="field"><span className="label">{t("Padrão")}</span>
              {o.type === "bool" ? <Switch label={t("Padrão")} checked={!!o.default} onChange={(v) => setOpt(i, { default: v })} />
                : o.type === "choice" ? <select className="select" value={String(o.default)} onChange={(e) => setOpt(i, { default: e.target.value })}>{(o.choices ?? []).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
                : <input className="input" value={String(o.default ?? "")} onChange={(e) => setOpt(i, { default: o.type === "number" ? Number(e.target.value) || 0 : e.target.value })} />}
            </label>
          </div>
          {o.type === "number" && (
            <div className="forja-form-grid">
              {(["min", "max", "step"] as const).map((k) => (
                <label key={k} className="field"><span className="label">{k === "min" ? t("Mínimo") : k === "max" ? t("Máximo") : t("Passo")}</span>
                  <input className="input" type="number" value={o[k] ?? ""} onChange={(e) => setOpt(i, { [k]: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>
              ))}
            </div>
          )}
          {o.type === "choice" && (
            <label className="field"><span className="label">{t("Itens da lista (valor=nome, separados por vírgula)")}</span>
              <input className="input mono" value={(o.choices ?? []).map((c) => `${c.value}=${c.label}`).join(", ")} onChange={(e) => setOpt(i, { choices: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const [v, l] = x.split("="); return { value: v.trim(), label: (l ?? v).trim() }; }) })} />
            </label>
          )}
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" value={o.description} placeholder={t("Explicação para o jogador")} onChange={(e) => setOpt(i, { description: e.target.value })} />
            <button type="button" className="btn icon-btn sm" onClick={() => set({ options: opts.filter((_, k) => k !== i) })} aria-label={t("Remover")}><Icon name="delete" size={16} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
