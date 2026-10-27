// Editor dos mods da Forja em desenvolvimento: arquivos do mod, editor com a API da Forja
// (autocompletar, ajuda ao passar o mouse e avisos do Lua 5.0 do jogo) e recarga ao salvar
// (monta o mod de novo e substitui o instalado, pronto para a próxima partida).
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Icon, Notice, Switch } from "../../components/ui";
import { api, pickFile } from "../../lib/api";
import { lintLua50 } from "../../lib/forjaApi";
import { t } from "../../lib/i18n";
import { errorText, useStore } from "../../lib/store";
import type { ForjaDevMod, ForjaOverview } from "../../lib/types";

const LuaEditor = lazy(() => import("../../components/LuaEditor"));

function stored(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export default function ForjaEditor({ devDir, refreshKey, onReloaded }: { devDir: string; refreshKey: number; onReloaded: (ov: ForjaOverview) => void }) {
  const toast = useStore((s) => s.toast);
  const [dir, setDir] = useState(() => stored("cp-forja-editor-dir", devDir));
  const [mods, setMods] = useState<ForjaDevMod[] | null>(null);
  const [modId, setModId] = useState(() => stored("cp-forja-editor-mod", ""));
  const [file, setFile] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [autoReload, setAutoReload] = useState(() => stored("cp-forja-autoreload", "1") === "1");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!dir && devDir) setDir(devDir); }, [devDir, dir]);
  useEffect(() => { try { localStorage.setItem("cp-forja-editor-dir", dir); localStorage.setItem("cp-forja-editor-mod", modId); localStorage.setItem("cp-forja-autoreload", autoReload ? "1" : "0"); } catch { /* ok */ } }, [dir, modId, autoReload]);

  const list = useCallback(async () => {
    if (!dir) return;
    try { setMods(await api.forjaDevMods(dir)); } catch (e) { setMods([]); toast("error", errorText(e)); }
  }, [dir, toast]);
  useEffect(() => { void list(); }, [list, refreshKey]);

  const mod = mods?.find((m) => m.id === modId) ?? mods?.[0] ?? null;
  useEffect(() => {
    if (!mod) return;
    if (!mod.files.includes(file)) setFile(mod.files.find((f) => f.endsWith(".lua")) ?? "mod.json");
  }, [mod, file]);
  useEffect(() => {
    if (!mod || !file) return;
    setText(null);
    void api.forjaReadFile(mod.path, file).then((s) => { setText(s); setDraft(s); }).catch((e) => toast("error", errorText(e)));
  }, [mod?.path, file]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = text !== null && draft !== text;
  const issues = file.endsWith(".lua") ? lintLua50(draft) : [];
  const save = useCallback(async () => {
    if (!mod || !file || saving) return;
    setSaving(true);
    try {
      const ov = await api.forjaWriteFile(mod.path, file, draft, autoReload);
      setText(draft);
      if (ov) { onReloaded(ov); toast("ok", t("Salvo e recarregado: {name} entra assim na próxima partida.", { name: mod.name })); }
      else toast("ok", t("Salvo."));
      if (file === "mod.json") void list();
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setSaving(false);
    }
  }, [mod, file, draft, autoReload, saving, onReloaded, toast, list]);

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
        <div className="forja-editor-body">
          <nav className="forja-files" aria-label={t("Arquivos do mod")}>
            <select className="select dense" value={mod.id} onChange={(e) => { setModId(e.target.value); setFile(""); }} aria-label={t("Mod")}>
              {mods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {mod.files.map((f) => (
              <button key={f} type="button" className={`forja-file ${f === file ? "on" : ""}`} onClick={() => { if (!dirty || confirm(t("Descartar as mudanças em {file}?", { file }))) setFile(f); }}>
                <Icon name={f === "mod.json" ? "data_object" : "description"} size={15} /> {f}{f === file && dirty ? " •" : ""}
              </button>
            ))}
            <button type="button" className="btn sm text" onClick={() => {
              const name = prompt(t("Novo arquivo (ex.: lib/ajuda.lua):"), "lib/");
              if (name && /\.lua$/.test(name)) setMods((l) => l?.map((m) => (m.id === mod.id && !m.files.includes(name) ? { ...m, files: [...m.files, name] } : m)) ?? l);
            }}><Icon name="add" size={15} /> {t("Arquivo")}</button>
          </nav>
          <div className="forja-code">
            <div className="row small forja-code-bar">
              <span className="mono grow">{file}{dirty ? " •" : ""}</span>
              {issues.length > 0 ? <span className="chip warn"><Icon name="warning" size={14} /> {t("{n} aviso(s) do Lua 5.0", { n: issues.length })}</span> : file.endsWith(".lua") && <span className="chip ok"><Icon name="check" size={14} /> {t("Lua 5.0 ok")}</span>}
              <button className="btn sm primary" disabled={!dirty || saving} onClick={() => void save()}><Icon name="save" size={16} /> {saving ? t("Salvando…") : t("Salvar (Ctrl+S)")}</button>
            </div>
            <div className="forja-code-host">
              {text === null ? <div className="bar indeterminate"><i /></div> : (
                <Suspense fallback={<div className="bar indeterminate"><i /></div>}>
                  <LuaEditor key={`${mod.path}/${file}`} value={text} onChange={setDraft} onSave={() => void save()} forja={file.endsWith(".lua")} />
                </Suspense>
              )}
            </div>
            <p className="faint small">{t("Ctrl+Espaço lista a API da Forja; passe o mouse num nome para ver a ajuda. O sublinhado marca o que não existe no Lua 5.0 do jogo.")}</p>
          </div>
        </div>
      )}
      {!mods && dir && <div className="bar indeterminate"><i /></div>}
      {issues.some((i) => i.severity === "error") && <Notice kind="warn">{t("O jogo usa Lua 5.0: o código marcado não roda lá. Passe o mouse no sublinhado para ver como trocar.")}</Notice>}
    </section>
  );
}
