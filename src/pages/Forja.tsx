// Forja: o carregador de mods do CommandProject (como o Forge do Minecraft). Mostra os mods da Forja
// ligados no perfil, a ordem de carga, quem não vai carregar e por quê, as opções de cada mod e as
// ferramentas para quem cria mods (criar um mod de exemplo, conferir, importar e o guia).
import { useEffect, useState } from "react";
import { Empty, Icon, Modal, Notice, Switch } from "../components/ui";
import { api, openUrl, pickFile } from "../lib/api";
import { errorText, useStore } from "../lib/store";
import { t } from "../lib/i18n";
import type { ForjaCheck, ForjaMod, ForjaOption, ForjaOverview } from "../lib/types";

export const FORJA_WIKI = "https://redesun.gitbook.io/forja/";

const SIDE: Record<string, { label: string; icon: string }> = {
  sim: { label: "Simulação", icon: "memory" },
  ui: { label: "Interface", icon: "web" },
  blueprints: { label: "Blueprints", icon: "schema" },
};

export default function Forja() {
  const { toast, run, refresh, go } = useStore.getState();
  const [ov, setOv] = useState<ForjaOverview | null | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [check, setCheck] = useState<{ path: string; report: ForjaCheck } | null>(null);

  const reload = async () => {
    try { setOv(await api.forjaOverview()); } catch (e) { setOv(null); toast("error", errorText(e)); }
  };
  useEffect(() => { void reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setOption = async (mod: string, key: string, value: unknown) => {
    try { setOv(await api.forjaSetOption(mod, key, value)); } catch (e) { toast("error", errorText(e)); }
  };

  const doCheck = async (directory: boolean) => {
    const path = await pickFile(directory ? [] : [{ name: "Mod (.scd)", extensions: ["scd", "zip"] }], directory);
    if (!path) return;
    try { setCheck({ path, report: await api.forjaCheck(path) }); } catch (e) { toast("error", errorText(e)); }
  };

  const doImport = async () => {
    const path = await pickFile([], true);
    if (!path) return;
    await run("forja-import", () => api.importMod(path, true), t("Mod importado e ligado. Ele carrega na próxima vez que você jogar."));
    await refresh();
    await reload();
  };

  const applyNow = async () => {
    await run("apply", () => api.applyActive(), t("Perfil aplicado com a Forja."));
    await refresh();
    await reload();
  };

  const fatal = ov?.problems.filter((p) => p.fatal) ?? [];
  const warnings = ov?.problems.filter((p) => !p.fatal) ?? [];

  return (
    <div className="page forja-page">
      <header className="perf-hero forja-hero">
        <div>
          <span className="overline"><Icon name="construction" size={15} /> {t("Carregador de mods")} · Forja {ov?.loaderVersion ?? ""}</span>
          <h1>{t("Forja")}</h1>
          <p className="muted">{t("Mods feitos com a Forja não editam arquivos do jogo: eles registram eventos, comandos, painéis e mudanças de unidades por uma API. A Forja junta todos na ordem certa, confere dependências e isola erros, então vários mods funcionam juntos.")}</p>
          <div className="row wrap gap">
            <button className="btn primary" onClick={() => setCreating(true)}><Icon name="add" /> {t("Criar um mod")}</button>
            <button className="btn" onClick={() => void doImport()}><Icon name="upload" /> {t("Importar pasta de mod")}</button>
            <button className="btn" onClick={() => void doCheck(true)}><Icon name="fact_check" /> {t("Conferir pasta")}</button>
            <button className="btn" onClick={() => void doCheck(false)}><Icon name="inventory_2" /> {t("Conferir .scd")}</button>
            <button className="btn text" onClick={() => void openUrl(FORJA_WIKI)}><Icon name="menu_book" /> {t("Guia para criar mods")}</button>
          </div>
        </div>
        <div className="forja-key card pad col">
          <div className="card-title"><Icon name="keyboard" /><h3>{t("Painel na partida")}</h3></div>
          <p className="muted small">{t("Durante a partida, a tecla abaixo (ou o botão F na borda esquerda) mostra os mods carregados, os erros e os menus dos mods.")}</p>
          <select className="select" value={ov?.key ?? "F8"} onChange={async (e) => {
            try { setOv(await api.forjaSetKey(e.target.value)); } catch (err) { toast("error", errorText(err)); }
          }} aria-label={t("Tecla do painel da Forja")}>
            {(ov?.keys ?? ["F8"]).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </header>

      {ov === undefined && <div className="bar indeterminate"><i /></div>}
      {ov === null && <Empty icon="error" title={t("Não deu para ler os mods da Forja")}>{t("Confira a pasta do jogo nas Configurações.")}</Empty>}
      {ov && (
        <>
          {fatal.length > 0 && (
            <Notice kind="err">
              <b>{t("Estes mods não vão carregar:")}</b>
              <ul className="forja-problems">{fatal.map((p, i) => <li key={i}><code>{p.modId || "?"}</code> — {p.message}</li>)}</ul>
            </Notice>
          )}
          {warnings.length > 0 && (
            <Notice kind="warn">
              <ul className="forja-problems">{warnings.map((p, i) => <li key={i}><code>{p.modId}</code> — {p.message}</li>)}</ul>
            </Notice>
          )}
          {ov.mods.length === 0 ? (
            <Empty icon="extension" title={t("Nenhum mod da Forja ligado")}
              action={<div className="row gap"><button className="btn primary" onClick={() => setCreating(true)}>{t("Criar um mod")}</button><button className="btn" onClick={() => go("hub")}>{t("Procurar no Hub")}</button></div>}>
              {t("Mods da Forja têm uma pasta forja/<id>/ com mod.json e o código. Importe um mod ou crie um de exemplo para começar.")}
            </Empty>
          ) : (
            <section className="card pad col">
              <div className="card-title"><Icon name="format_list_numbered" /><h3>{t("Ordem de carga")}</h3>
                <span className="grow" />
                <button className="btn sm" onClick={() => void applyNow()}><Icon name="published_with_changes" /> {t("Aplicar agora")}</button>
              </div>
              <p className="muted small">{t("Dependências carregam antes de quem precisa delas. Mudanças nas opções valem na próxima vez que você jogar ou aplicar.")}</p>
              <ol className="forja-list">
                {ov.mods.map((m) => <ModCard key={m.id} mod={m} onOption={setOption} onReset={async () => setOv(await api.forjaResetOptions(m.id))} />)}
              </ol>
            </section>
          )}
          {ov.built && (
            <p className="faint small">{t("Última montagem: {date} · arquivos do jogo com a Forja: {files}", {
              date: new Date(ov.built.builtAt).toLocaleString(),
              files: ov.built.patched.map((p) => p.split("/").pop()).join(", "),
            })}</p>
          )}
        </>
      )}

      {creating && <CreateModal devDir={ov?.devDir ?? ""} onClose={() => setCreating(false)} onDone={async (path) => {
        setCreating(false);
        toast("ok", t("Mod criado em {path}. Edite os arquivos .lua e importe a pasta.", { path }));
        await api.openPath(path).catch(() => {});
      }} />}
      {check && (
        <Modal title={t("Conferência do mod")} icon="fact_check" onClose={() => setCheck(null)}>
          <p className="faint small mono">{check.path}</p>
          {check.report.problems.length === 0 && check.report.mods.length > 0 && <Notice kind="ok">{t("Tudo certo para carregar.")}</Notice>}
          {check.report.problems.map((p, i) => <Notice key={i} kind="err">{p.modId ? <code>{p.modId}</code> : null} {p.message}</Notice>)}
          {check.report.mods.map((m) => (
            <div key={m.id} className="col">
              <b>{m.name} <span className="faint">{m.id} {m.version}</span></b>
              <span className="small muted">{m.sides.map((s) => t(SIDE[s]?.label ?? s)).join(" · ")}</span>
              {m.warnings.map((w, i) => <span key={i} className="small warn-text">⚠ {w}</span>)}
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}

function ModCard({ mod, onOption, onReset }: { mod: ForjaMod; onOption: (mod: string, key: string, v: unknown) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="forja-mod">
      <div className="row gap">
        <div className="col grow">
          <b>{mod.name} <span className="faint small">{mod.version}</span></b>
          <span className="small muted">{mod.description || mod.id}{mod.authors.length > 0 ? ` · ${mod.authors.join(", ")}` : ""}</span>
        </div>
        <div className="row gap forja-sides">
          {mod.sides.map((s) => <span key={s} className="chip" title={t(SIDE[s]?.label ?? s)}><Icon name={SIDE[s]?.icon ?? "code"} size={14} /> {t(SIDE[s]?.label ?? s)}</span>)}
        </div>
        {mod.options.length > 0 && <button className="btn sm" onClick={() => setOpen(!open)}><Icon name="tune" /> {t("Opções")}</button>}
      </div>
      {mod.warnings.length > 0 && <div className="small warn-text">{mod.warnings.slice(0, 3).map((w, i) => <div key={i}>⚠ {w}</div>)}</div>}
      {open && (
        <div className="forja-options">
          {mod.options.map((o) => <OptionField key={o.key} opt={o} value={mod.values[o.key]} onChange={(v) => onOption(mod.id, o.key, v)} />)}
          <button className="btn sm text" onClick={onReset}>{t("Voltar ao padrão")}</button>
        </div>
      )}
    </li>
  );
}

function OptionField({ opt, value, onChange }: { opt: ForjaOption; value: unknown; onChange: (v: unknown) => void }) {
  const help = opt.description ? <span className="faint small">{opt.description}</span> : null;
  if (opt.type === "bool") {
    return <div className="field"><Switch checked={value === true} onChange={onChange} label={opt.label} />{help}</div>;
  }
  if (opt.type === "choice") {
    return (
      <label className="field"><span className="label">{opt.label}</span>
        <select className="select" value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {opt.choices?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>{help}
      </label>
    );
  }
  if (opt.type === "number") {
    const n = typeof value === "number" ? value : Number(opt.default);
    const ranged = opt.min !== undefined && opt.max !== undefined;
    return (
      <label className="field"><span className="label">{opt.label}: <b>{n}</b></span>
        {ranged
          ? <input type="range" min={opt.min} max={opt.max} step={opt.step ?? "any"} value={n} onChange={(e) => onChange(Number(e.target.value))} />
          : <input className="input" type="number" value={n} step={opt.step ?? "any"} onChange={(e) => onChange(Number(e.target.value))} />}
        {help}
      </label>
    );
  }
  return (
    <label className="field"><span className="label">{opt.label}</span>
      <input className="input" value={String(value ?? "")} maxLength={500} onChange={(e) => onChange(e.target.value)} />{help}
    </label>
  );
}

function CreateModal({ devDir, onClose, onDone }: { devDir: string; onClose: () => void; onDone: (path: string) => void }) {
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState("");
  const [dir, setDir] = useState(devDir);
  const id = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return (
    <Modal title={t("Criar um mod da Forja")} icon="add" onClose={onClose}>
      <form className="col" onSubmit={async (e) => {
        e.preventDefault();
        try { onDone(await api.forjaNewMod(dir, id, name.trim())); } catch (err) { toast("error", errorText(err)); }
      }}>
        <p className="muted small">{t("Cria a pasta forja/<id>/ com mod.json, sim.lua, ui.lua, blueprints.lua e um arquivo de biblioteca, todos comentados. Edite, importe a pasta e jogue.")}</p>
        <label className="field"><span className="label">{t("Nome do mod")}</span><input className="input" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t("Vida dupla")} /></label>
        <p className="faint small">{t("Id: {id}", { id: id || "—" })}</p>
        <label className="field"><span className="label">{t("Pasta")}</span>
          <div className="row gap"><input className="input grow" value={dir} onChange={(e) => setDir(e.target.value)} />
            <button type="button" className="btn sm" onClick={async () => { const p = await pickFile([], true); if (p) setDir(p); }}>{t("Escolher")}</button></div>
        </label>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" disabled={!id || !dir}>{t("Criar")}</button></footer>
      </form>
    </Modal>
  );
}
