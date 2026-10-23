import { Download, Globe2, RefreshCw, Search, Star } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Drawer, Empty, Field, ModThumb, Notice, TaskProgress } from "../components/ui";
import { api } from "../lib/api";
import { errorText, fmtBytes, useStore } from "../lib/store";
import { CATEGORY_LABEL, type Category, type HubIndex, type HubMod } from "../lib/types";

type Item = { mod: HubMod; index: HubIndex };

export default function Hub() {
  const settings = useStore((s) => s.settings);
  const mods = useStore((s) => s.mods);
  const busy = useStore((s) => s.busy);
  const { run, refreshMods, refresh } = useStore.getState();
  const [indexes, setIndexes] = useState<HubIndex[]>([]);
  const [errors, setErrors] = useState<{ url: string; message: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [open, setOpen] = useState<Item | null>(null);
  const [newUrl, setNewUrl] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.hubFetch();
      setIndexes(r.indexes);
      setErrors(r.errors);
    } catch (e) {
      setErrors([{ url: "", message: errorText(e) }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settings?.hubUrls.length) void load();
  }, [settings?.hubUrls.length, load]);

  const installed = new Map(mods.map((m) => [m.manifest.source.hubId ?? m.manifest.id, m]));
  const items: Item[] = indexes.flatMap((index) => index.mods.map((mod) => ({ mod, index })));
  const visible = items
    .filter((i) => cat === "all" || i.mod.category === cat)
    .filter((i) => {
      const q = query.trim().toLowerCase();
      return !q || [i.mod.name, i.mod.summary, ...i.mod.tags, ...i.mod.authors].some((s) => s.toLowerCase().includes(q));
    })
    .sort((a, b) => b.mod.downloads - a.mod.downloads);

  const install = async (i: Item, version?: string) => {
    const key = "hub:" + i.mod.id;
    await run(key, () => api.hubInstall(i.index.sourceUrl, i.mod.id, version), (m) => `${m.name} ${m.version} instalado e ativado.`);
    await refreshMods();
  };

  if (!settings) return null;

  if (!settings.hubUrls.length) {
    return (
      <div className="page">
        <div className="page-head"><div className="grow"><h1>Hub de mods</h1><p>Baixe mods verificados e mantenha tudo atualizado com um clique.</p></div></div>
        <div className="panel">
          <Empty icon={<Globe2 size={36} color="var(--faint)" />} title="Nenhum hub configurado">
            Cole o endereço do índice de mods (o hub do Project Club ou qualquer outro que siga o mesmo formato).
          </Empty>
          <form className="row" style={{ padding: "0 24px 28px", maxWidth: 720, margin: "0 auto" }} onSubmit={async (e) => {
            e.preventDefault();
            const s = await run("settings", () => api.saveSettings({ ...settings, hubUrls: [newUrl.trim()] }), "Hub adicionado.");
            if (s) await refresh();
          }}>
            <input className="input" style={{ flex: 1 }} placeholder="https://…/index.json" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} aria-label="Endereço do hub" />
            <button className="btn primary" disabled={!newUrl.trim().startsWith("https://")}>Adicionar</button>
          </form>
        </div>
      </div>
    );
  }

  const cats = Array.from(new Set(items.map((i) => i.mod.category)));
  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Hub de mods</h1>
          <p>Todo download é conferido pelo SHA-256 publicado no hub antes de entrar na biblioteca.</p>
        </div>
        <button className="btn" onClick={load} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} /> {loading ? "Atualizando…" : "Atualizar"}</button>
      </div>
      {errors.map((e) => <Notice key={e.url + e.message} kind="err">{e.url && <b>{e.url}: </b>}{e.message}</Notice>)}
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="chips" style={{ flex: 1 }}>
          <button className="chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>Todos</button>
          {cats.map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{CATEGORY_LABEL[c]}</button>)}
        </div>
        <div className="search"><Search size={16} /><input className="input" placeholder="Buscar no hub" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar no hub" /></div>
      </div>

      {loading && !items.length ? <div className="panel pad"><div className="bar indeterminate"><i /></div></div> : visible.length === 0 ? (
        <div className="panel"><Empty title={items.length ? "Nada encontrado" : "O hub ainda não tem mods"}>{items.length ? "Tente outro termo." : "Volte mais tarde."}</Empty></div>
      ) : (
        <div className="list panel" style={{ overflow: "hidden" }}>
          {visible.map((i) => {
            const latest = [...i.mod.versions].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
            const have = installed.get(i.mod.id);
            const upToDate = have && have.manifest.version === latest.version;
            const key = "hub:" + i.mod.id;
            return (
              <div key={i.index.sourceUrl + i.mod.id} className="list-row clickable" onClick={() => setOpen(i)}>
                <ModThumb name={i.mod.name} icon={i.mod.icon} />
                <div className="grow">
                  <div className="title">{i.mod.name} <span className="faint" style={{ fontWeight: 400 }}>{latest.version}</span></div>
                  <div className="sub">{i.mod.summary || i.mod.description}</div>
                  {busy[key] && <div style={{ marginTop: 8 }}><TaskProgress task={key} /></div>}
                </div>
                <span className="tag">{CATEGORY_LABEL[i.mod.category]}</span>
                <span className="faint small" title="downloads" style={{ width: 70, textAlign: "right" }}><Download size={13} /> {i.mod.downloads.toLocaleString("pt-BR")}</span>
                {i.mod.rating != null && <span className="faint small" style={{ width: 44 }}><Star size={13} /> {i.mod.rating.toFixed(1).replace(".", ",")}</span>}
                <div onClick={(e) => e.stopPropagation()} style={{ width: 118, display: "flex", justifyContent: "flex-end" }}>
                  {upToDate ? <span className="tag ok">instalado</span> : (
                    <button className={`btn sm ${have ? "primary" : ""}`} disabled={busy[key]} onClick={() => install(i)}>
                      {have ? `Atualizar` : "Instalar"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && <HubDrawer item={open} installedVersion={installed.get(open.mod.id)?.manifest.version} onInstall={(v) => install(open, v)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function HubDrawer({ item, installedVersion, onInstall, onClose }: { item: Item; installedVersion?: string; onInstall: (v: string) => void; onClose: () => void }) {
  const versions = [...item.mod.versions].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const [ver, setVer] = useState(versions[0].version);
  const v = versions.find((x) => x.version === ver)!;
  const busy = useStore((s) => s.busy["hub:" + item.mod.id]);
  return (
    <Drawer onClose={onClose} label={item.mod.name}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="tag">{CATEGORY_LABEL[item.mod.category]}</span>
        {item.mod.authors.length > 0 && <span className="tag">por {item.mod.authors.join(", ")}</span>}
        {item.mod.license && <span className="tag">{item.mod.license}</span>}
        {installedVersion && <span className="tag ok">você tem a {installedVersion}</span>}
      </div>
      <p className="selectable">{item.mod.description || item.mod.summary}</p>
      {item.mod.screenshots.length > 0 && (
        <div className="row" style={{ overflowX: "auto", gap: 8 }}>
          {item.mod.screenshots.map((s) => <img key={s} src={s} alt="" style={{ height: 120, borderRadius: 6 }} />)}
        </div>
      )}
      <Field label="Versão">
        <select className="select" value={ver} onChange={(e) => setVer(e.target.value)}>
          {versions.map((x) => <option key={x.version} value={x.version}>{x.version}{x.releasedAt ? ` — ${new Date(x.releasedAt).toLocaleDateString("pt-BR")}` : ""}</option>)}
        </select>
      </Field>
      {v.changelog && <div><h3 style={{ marginBottom: 6 }}>Novidades</h3><p className="muted selectable" style={{ whiteSpace: "pre-wrap" }}>{v.changelog}</p></div>}
      <div className="small col" style={{ gap: 4 }}>
        <span>Download: {fmtBytes(v.package.size)}</span>
        <span>{v.multiplayer === "sync" ? "No multiplayer, todos precisam ter este mod." : "Só visual: não interfere na partida dos outros."}</span>
        {v.requiresDlc && <span>Requer o DLC Infinite War Battle Pack.</span>}
        {v.dependencies.length > 0 && <span>Precisa de: {v.dependencies.map((d) => d.id).join(", ")}</span>}
        {v.conflicts.length > 0 && <span>Não combina com: {v.conflicts.join(", ")}</span>}
        <span className="mono faint selectable">sha256 {v.package.sha256}</span>
      </div>
      {busy && <TaskProgress task={"hub:" + item.mod.id} />}
      <div style={{ flex: 1 }} />
      <footer>
        {item.mod.homepage && <a className="btn ghost" href={item.mod.homepage} target="_blank" rel="noreferrer">Página do mod</a>}
        <button className="btn primary" disabled={busy || installedVersion === ver} onClick={() => onInstall(ver)}>
          {installedVersion === ver ? "Instalado" : installedVersion ? `Instalar ${ver}` : "Instalar e ativar"}
        </button>
      </footer>
    </Drawer>
  );
}
