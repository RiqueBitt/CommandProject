// Gerador de ícones: escolhe tropas do jogo, ajusta o estilo (o mesmo para todas, para os ícones
// ficarem consistentes), confere lado a lado em tamanho pequeno e exporta tudo para uma pasta.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Empty, Icon } from "../components/ui";
import { api, confirmDialog, pickFile } from "../lib/api";
import { t } from "../lib/i18n";
import { errorText, load, useStore } from "../lib/store";
import { KIND_META, useTabs } from "../lib/tabs";
import type { CreationMeta, UnitInfo } from "../lib/types";
import { ICON_SIZES, renderIcon } from "./create/iconRender";
import { joinPath, savedIconSpec, symbolFor } from "./create/IconStudio";
import { viewFromPreview, type ViewModel } from "./create/UnitViewport";

const IconStudio = lazy(() => import("./create/IconStudio"));

export default function Icons() {
  const { toast } = useStore.getState();
  const [units, setUnits] = useState<UnitInfo[] | null>(null);
  const [mine, setMine] = useState<CreationMeta[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState<{ unit: UnitInfo; model: ViewModel | null } | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [sizes, setSizes] = useState<number[]>([64, 128, 256]);
  const [autoSymbol, setAutoSymbol] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [styleRev, setStyleRev] = useState(0);
  const models = useMemo(() => new Map<string, ViewModel | null>(), []);

  useEffect(() => {
    void load(() => api.unitCatalog()).then((u) => setUnits(u ?? []));
    void api.creations().then((l) => setMine(l.filter((m) => m.kind === "unit"))).catch(() => {});
  }, []);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (units ?? []).filter((u) => !t || u.id.includes(t) || u.name.toLowerCase().includes(t) || u.faction.toLowerCase().includes(t) || u.role.toLowerCase().includes(t)).slice(0, 400);
  }, [units, q]);
  const byId = useMemo(() => new Map((units ?? []).map((u) => [u.id, u])), [units]);

  const modelOf = async (id: string) => {
    if (models.has(id)) return models.get(id) ?? null;
    const m = await api.unitPreview(id).then(viewFromPreview).catch(() => null);
    models.set(id, m);
    return m;
  };
  const specFor = (u: UnitInfo) => { const s = savedIconSpec(); return autoSymbol ? { ...s, symbol: symbolFor(u.categories ?? []) } : s; };

  // prévia lado a lado (64 px) das tropas escolhidas, com o estilo salvo
  useEffect(() => {
    let alive = true;
    void (async () => {
      for (const id of picked.slice(0, 12)) {
        const u = byId.get(id);
        const m = await modelOf(id);
        if (!alive || !u || !m) continue;
        try {
          const r = await renderIcon(m, specFor(u), 64);
          if (alive) setThumbs((t) => ({ ...t, [id]: r.url }));
        } catch { /* sem prévia */ }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, styleRev, autoSymbol, byId]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-60)));
  const exportAll = async () => {
    if (!picked.length || !sizes.length) return;
    const dir = await pickFile([], true);
    if (!dir) return;
    let overwrite: boolean | null = null, n = 0, skipped = 0;
    try {
      for (const [k, id] of picked.entries()) {
        const u = byId.get(id);
        if (!u) continue;
        setProgress(`${k + 1}/${picked.length}: ${u.name}`);
        const m = await modelOf(id);
        if (!m) { skipped++; continue; }
        for (const s of sizes) {
          const r = await renderIcon(m, specFor(u), s);
          const path = joinPath(dir, `${id}_icone_${s}.png`);
          try { await api.exportData(path, r.url, overwrite === true); n++; } catch (e) {
            if (!String(e).includes("EXISTE")) throw e;
            if (overwrite === null) overwrite = await confirmDialog(t("Alguns ícones já existem nessa pasta. Substituir os que já existem?"), t("Substituir"), t("Manter os antigos"));
            if (overwrite) { await api.exportData(path, r.url, true); n++; } else skipped++;
          }
        }
      }
      toast("ok", skipped ? t("{n} ícone(s) salvos em {dir} ({skipped} mantidos/pulados).", { n, dir, skipped }) : t("{n} ícone(s) salvos em {dir}.", { n, dir }));
    } catch (e) { toast("error", errorText(e)); } finally { setProgress(null); }
  };

  return (
    <div className="page icons-page">
      <header className="page-head">
        <div>
          <span className="overline"><Icon name="photo_camera" size={15} /> {t("Ícones")}</span>
          <h1 className="page-title">{t("Gerador de ícones de tropas")}</h1>
          <p className="muted">{t("Ícones feitos a partir dos modelos 3D: enquadramento automático, luz, fundo, contorno e símbolo da função. O mesmo estilo vale para todas as tropas, para ficarem consistentes nos menus, listas e no minimapa.")}</p>
        </div>
      </header>

      <div className="icons-grid">
        <section className="card pad">
          <div className="card-title"><Icon name="smart_toy" /><h3>{t("Tropas do jogo")}</h3><small className="faint">{t("{n} escolhida(s)", { n: picked.length })}</small></div>
          <div className="search-bar" style={{ marginBottom: 8 }}><Icon name="search" /><input className="input dense" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar: tanque, uel0101, Cybran…")} /></div>
          {units === null ? <div className="bar indeterminate"><i /></div> : !units.length ? <Empty icon="smart_toy" title={t("Nenhuma tropa encontrada")}>{t("Confira a pasta do jogo em Configurações.")}</Empty> : (
            <div className="icon-unit-list">{list.map((u) => (
              <div key={u.id} className={`file-row ${picked.includes(u.id) ? "on" : ""}`}>
                <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} aria-label={t("Escolher {name}", { name: u.name })} />
                <span className={`fac fac-${u.faction.toLowerCase()}`}>{u.faction.slice(0, 1)}</span>
                <span className="grow"><b>{u.name}</b> <small className="faint">{u.id} · {u.role}</small></span>
                <button className="btn sm" onClick={async () => { setOpen({ unit: u, model: null }); const m = await modelOf(u.id); setOpen((o) => (o && o.unit.id === u.id ? { ...o, model: m } : o)); }}><Icon name="tune" size={15} /> {t("Editar ícone")}</button>
              </div>
            ))}</div>
          )}
        </section>

        <section className="col" style={{ gap: 16 }}>
          <div className="card pad">
            <div className="card-title"><Icon name="grid_view" /><h3>{t("Lado a lado (64 px)")}</h3>
              <button className="btn sm text" onClick={() => setStyleRev((v) => v + 1)} title={t("Atualizar com o estilo salvo")}><Icon name="refresh" size={16} /></button></div>
            {picked.length === 0 ? <p className="faint small">{t("Marque tropas na lista para ver os ícones juntos e exportar de uma vez.")}</p> : (
              <div className="icon-sheet">{picked.slice(0, 12).map((id) => (
                <figure key={id}>{thumbs[id] ? <img src={thumbs[id]} alt={byId.get(id)?.name} /> : <span className="bar indeterminate"><i /></span>}<figcaption>{byId.get(id)?.name}</figcaption></figure>
              ))}</div>
            )}
            <label className="row small" style={{ gap: 8, marginTop: 10 }}><input type="checkbox" checked={autoSymbol} onChange={(e) => setAutoSymbol(e.target.checked)} /> {t("Símbolo pela função de cada tropa")}</label>
          </div>
          <div className="card pad">
            <div className="card-title"><Icon name="download" /><h3>{t("Exportar")}</h3></div>
            <div className="chips" style={{ padding: 0, marginBottom: 10 }}>{ICON_SIZES.map((s) => (
              <button key={s} className="chip" aria-pressed={sizes.includes(s)} onClick={() => setSizes((v) => (v.includes(s) ? v.filter((x) => x !== s) : [...v, s].sort((a, b) => a - b)))}>{s} px</button>
            ))}</div>
            <button className="btn primary" disabled={!picked.length || !sizes.length || !!progress} onClick={() => void exportAll()}><Icon name="folder" size={18} /> {progress ? t("Gerando {progress}", { progress }) : t("Exportar {n} ícone(s) para uma pasta", { n: picked.length * sizes.length })}</button>
            <p className="faint small" style={{ marginTop: 8 }}>{t("Arquivos PNG com fundo conforme o estilo (dá para usar transparente). Nada é sobrescrito sem perguntar.")}</p>
          </div>
          {mine.length > 0 && <div className="card pad">
            <div className="card-title"><Icon name="draw" /><h3>{t("Minhas tropas")}</h3></div>
            <p className="faint small" style={{ marginBottom: 8 }}>{t("O ícone de uma tropa criada aqui é feito dentro do projeto (Aparência → Gerador de ícones) e vai junto no mod.")}</p>
            <div className="file-list">{mine.map((m) => (
              <div key={m.id} className="file-row"><Icon name={KIND_META.unit.icon} size={18} /><span className="grow">{m.name}</span>
                <button className="btn sm" onClick={() => useTabs.getState().open(m)}><Icon name="open_in_new" size={15} /> {t("Abrir")}</button></div>
            ))}</div>
          </div>}
        </section>
      </div>

      {open && (
        <Suspense fallback={null}>
          <IconStudio title={open.unit.name} unitId={open.unit.id} model={open.model} categories={open.unit.categories ?? []} onClose={() => { setOpen(null); setStyleRev((v) => v + 1); }} />
        </Suspense>
      )}
    </div>
  );
}
