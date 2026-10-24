import { useCallback, useEffect, useMemo, useState } from "react";
import { Drawer, Empty, Field, hueOf, Icon, ModThumb, Notice, TaskProgress } from "../components/ui";
import { api, openUrl } from "../lib/api";
import { errorText, fmtBytes, useStore } from "../lib/store";
import { CATEGORY_LABEL, type Category, type HubIndex, type HubMod } from "../lib/types";
import { CATEGORY_ICON } from "./Library";

type Item = { mod: HubMod; index: HubIndex };
type Sort = "downloads" | "rating" | "recent" | "name";

const latestOf = (m: HubMod) => [...m.versions].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
const resolveUrl = (u: string | undefined, base: string) => {
  if (!u) return undefined;
  try { return new URL(u, base).toString(); } catch { return undefined; }
};

export default function Hub() {
  const settings = useStore((s) => s.settings);
  const mods = useStore((s) => s.mods);
  const busy = useStore((s) => s.busy);
  const { run, refreshMods } = useStore.getState();
  const [indexes, setIndexes] = useState<HubIndex[]>([]);
  const [errors, setErrors] = useState<{ url: string; message: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<string>("all");
  const [cats, setCats] = useState<Category[]>([]);
  const [sort, setSort] = useState<Sort>("downloads");
  const [onlyNew, setOnlyNew] = useState(false);
  const [open, setOpen] = useState<Item | null>(null);
  const [slide, setSlide] = useState(0);

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
  const configured = !!settings && (settings.hubUrls.length > 0 || !!settings.serverUrl);
  const offline = !!settings?.offline;
  useEffect(() => { if (configured && !offline) void load(); }, [configured, load, offline]);

  const installed = new Map(mods.map((m) => [m.manifest.source.hubId ?? m.manifest.id, m]));
  const all: Item[] = indexes.flatMap((index) => index.mods.map((mod) => ({ mod, index })));
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all
      .filter((i) => source === "all" || i.index.sourceUrl === source)
      .filter((i) => !cats.length || cats.includes(i.mod.category))
      .filter((i) => !onlyNew || !installed.has(i.mod.id))
      .filter((i) => !q || [i.mod.name, i.mod.summary, ...i.mod.tags, ...i.mod.authors].some((s) => s.toLowerCase().includes(q)));
    const by: Record<Sort, (a: Item, b: Item) => number> = {
      downloads: (a, b) => b.mod.downloads - a.mod.downloads,
      rating: (a, b) => (b.mod.rating ?? 0) - (a.mod.rating ?? 0),
      recent: (a, b) => (latestOf(b.mod).releasedAt ?? "").localeCompare(latestOf(a.mod).releasedAt ?? ""),
      name: (a, b) => a.mod.name.localeCompare(b.mod.name),
    };
    return list.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexes, query, source, cats, sort, onlyNew, mods]);
  const trending = [...all].sort((a, b) => b.mod.downloads - a.mod.downloads).slice(0, 5);
  const catList = Array.from(new Set(all.map((i) => i.mod.category)));

  const install = async (i: Item, version?: string) => {
    await run("hub:" + i.mod.id, () => api.hubInstall(i.index.sourceUrl, i.mod.id, version), (m) => `${m.name} ${m.version} instalado e ativado.`);
    await refreshMods();
  };

  if (!settings) return null;
  if (!configured) {
    return (
      <div className="scroll"><div className="page">
        <h1 className="page-title">Hub de mods</h1>
        {offline && <Notice kind="info">O modo local está ligado: o hub não é consultado. Mods que você já tem continuam na biblioteca; para baixar novos, desligue em Sistema → Modo local.</Notice>}
        <div className="card"><Empty icon="store" title="Nenhum hub configurado" action={<button className="btn primary" onClick={() => useStore.getState().openSettings("hub")}>Abrir configurações</button>}>
          Conecte a um servidor da comunidade (cp-server) ou adicione o endereço de um índice de mods em Configurações.
        </Empty></div>
      </div></div>
    );
  }

  const hero = trending[slide % Math.max(1, trending.length)];
  return (
    <>
      <aside className="side-panel">
        <div className="group">
          <div className="overline">Fonte</div>
          <div className="source-tiles">
            <button className="source-tile" aria-pressed={source === "all"} onClick={() => setSource("all")}><Icon name="all_inclusive" /><span>Todas</span></button>
            {indexes.map((i) => (
              <button key={i.sourceUrl} className="source-tile" aria-pressed={source === i.sourceUrl} onClick={() => setSource(i.sourceUrl)} title={i.sourceUrl}>
                <Icon name="dns" /><span>{i.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="group">
          <div className="overline">Ordenar por</div>
          <select className="select dense" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar por">
            <option value="downloads">Mais baixados</option>
            <option value="rating">Mais bem avaliados</option>
            <option value="recent">Atualizados recentemente</option>
            <option value="name">Nome</option>
          </select>
        </div>
        <div className="card pad group">
          <div className="overline">Categorias</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 2 }}>
            {catList.map((c) => (
              <button key={c} className="filter-chip" aria-pressed={cats.includes(c)} onClick={() => setCats((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))}>
                <Icon name={CATEGORY_ICON[c]} /> {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="card pad">
          <label className="row small" style={{ justifyContent: "space-between" }}>Só o que eu não tenho <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /></label>
        </div>
        <button className="btn text" onClick={load} disabled={loading}><Icon name="refresh" /> {loading ? "Atualizando…" : "Atualizar lista"}</button>
      </aside>

      <div className="scroll">
        <div style={{ padding: "18px 32px 0", borderBottom: "1px solid var(--border)", paddingBottom: 18 }}>
          <div className="search-bar" style={{ maxWidth: 620 }}>
            <Icon name="search" />
            <input className="input dense" placeholder="Buscar mods, autores ou tags" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar no hub" />
          </div>
        </div>
        <div className="page">
          {errors.map((e) => <Notice key={e.url + e.message} kind="err">{e.url && <b>{e.url}: </b>}{e.message}</Notice>)}
          {!query && !cats.length && hero && (
            <section>
              <div className="section-head"><Icon name="local_fire_department" style={{ color: "#ff9a3c" }} /><h2>Em alta</h2></div>
              <div className="hero-carousel" style={{ cursor: "pointer" }} onClick={() => setOpen(hero)}>
                <div className="art" style={{ background: banner(hero.mod.name) }}>
                  {resolveUrl(hero.mod.icon, hero.index.sourceUrl) ? <img src={resolveUrl(hero.mod.icon, hero.index.sourceUrl)} alt="" style={{ width: 128, height: 128, borderRadius: 24 }} /> : <Icon name={CATEGORY_ICON[hero.mod.category]} />}
                </div>
                <div className="info">
                  <div className="row small"><b className="overline" style={{ color: "var(--text)" }}>{CATEGORY_LABEL[hero.mod.category]}</b><span className="faint">{hero.mod.downloads.toLocaleString("pt-BR")} downloads</span></div>
                  <h2>{hero.mod.name}</h2>
                  <p className="muted">{hero.mod.summary}</p>
                  <div className="row" onClick={(e) => e.stopPropagation()}>
                    <InstallButton item={hero} installedVersion={installed.get(hero.mod.id)?.manifest.version} onInstall={() => install(hero)} />
                  </div>
                </div>
                <button className="btn icon-btn nav l" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); setSlide((s) => (s + trending.length - 1) % trending.length); }}><Icon name="chevron_left" /></button>
                <button className="btn icon-btn nav r" aria-label="Próximo" onClick={(e) => { e.stopPropagation(); setSlide((s) => (s + 1) % trending.length); }}><Icon name="chevron_right" /></button>
                <div className="dots" onClick={(e) => e.stopPropagation()}>{trending.map((t, i) => <button key={t.mod.id} aria-label={t.mod.name} aria-current={i === slide % trending.length} onClick={() => setSlide(i)} />)}</div>
              </div>
            </section>
          )}
          <section>
            <div className="section-head"><Icon name="extension" /><h2>{query || cats.length ? "Resultados" : "Todos os mods"}</h2><span className="muted small">{visible.length} mod(s)</span></div>
            {loading && !all.length ? <div className="bar indeterminate"><i /></div> : visible.length === 0 ? (
              <div className="card"><Empty icon="search_off" title={all.length ? "Nada encontrado" : "Este hub ainda não tem mods"}>{all.length ? "Tente outro termo ou tire filtros." : "Volte mais tarde."}</Empty></div>
            ) : (
              <div className="store-grid">
                {visible.map((i) => {
                  const latest = latestOf(i.mod);
                  const have = installed.get(i.mod.id);
                  const icon = resolveUrl(i.mod.icon, i.index.sourceUrl);
                  return (
                    <article key={i.index.sourceUrl + i.mod.id} className="store-card" onClick={() => setOpen(i)}>
                      <div className="banner" style={{ background: banner(i.mod.name) }}>
                        <Icon name={CATEGORY_ICON[i.mod.category]} className="big" />
                        <div className="chips">
                          <span className="chip dark"><Icon name="dns" /> {i.index.name}</span>
                          <span className="chip dark"><Icon name="sell" /> {latest.version}</span>
                        </div>
                      </div>
                      <div className="body">
                        <div className="who">
                          <ModThumb name={i.mod.name} icon={icon} />
                          <div style={{ minWidth: 0 }}>
                            <div className="name">{i.mod.name}</div>
                            <div className="small faint row" style={{ gap: 4 }}><Icon name="person" size={14} /> {i.mod.authors.join(", ") || "Comunidade"}</div>
                          </div>
                        </div>
                        <p className="desc">{i.mod.summary || i.mod.description}</p>
                        {busy["hub:" + i.mod.id] && <TaskProgress task={"hub:" + i.mod.id} />}
                        <div className="foot">
                          <span className="row" style={{ gap: 4 }}><Icon name="download" /> {i.mod.downloads.toLocaleString("pt-BR")}</span>
                          {i.mod.rating != null && <span className="row" style={{ gap: 4 }}><Icon name="star" /> {i.mod.rating.toFixed(1).replace(".", ",")}</span>}
                          <span className="spacer" />
                          {have && (have.manifest.version === latest.version ? <span className="chip ok">instalado</span> : <span className="chip warn">atualizar</span>)}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
      {open && <HubDrawer item={open} installedVersion={installed.get(open.mod.id)?.manifest.version} onInstall={(v) => install(open, v)} onClose={() => setOpen(null)} />}
    </>
  );
}

function banner(name: string) {
  const h = hueOf(name);
  return `radial-gradient(120% 140% at 20% 10%, hsl(${h} 50% 38%), hsl(${(h + 50) % 360} 45% 14%))`;
}

function InstallButton({ item, installedVersion, onInstall }: { item: Item; installedVersion?: string; onInstall: () => void }) {
  const busy = useStore((s) => s.busy["hub:" + item.mod.id]);
  const latest = latestOf(item.mod).version;
  if (installedVersion === latest) return <span className="chip ok"><Icon name="check" /> instalado</span>;
  return <button className="btn primary sm" disabled={busy} onClick={onInstall}><Icon name="download" /> {installedVersion ? "Atualizar" : "Instalar"}</button>;
}

function HubDrawer({ item, installedVersion, onInstall, onClose }: { item: Item; installedVersion?: string; onInstall: (v: string) => void; onClose: () => void }) {
  const versions = [...item.mod.versions].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const [ver, setVer] = useState(versions[0].version);
  const v = versions.find((x) => x.version === ver)!;
  const busy = useStore((s) => s.busy["hub:" + item.mod.id]);
  return (
    <Drawer onClose={onClose} label={item.mod.name}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="chip"><Icon name={CATEGORY_ICON[item.mod.category]} /> {CATEGORY_LABEL[item.mod.category]}</span>
        {item.mod.authors.length > 0 && <span className="chip">por {item.mod.authors.join(", ")}</span>}
        {item.mod.license && <span className="chip">{item.mod.license}</span>}
        {installedVersion && <span className="chip ok">você tem a {installedVersion}</span>}
      </div>
      <p className="selectable">{item.mod.description || item.mod.summary}</p>
      {item.mod.screenshots.length > 0 && (
        <div className="row" style={{ overflowX: "auto", gap: 8 }}>
          {item.mod.screenshots.map((s) => <img key={s} src={resolveUrl(s, item.index.sourceUrl)} alt="" style={{ height: 120, borderRadius: 8 }} />)}
        </div>
      )}
      <Field label="Versão">
        <select className="select" value={ver} onChange={(e) => setVer(e.target.value)}>
          {versions.map((x) => <option key={x.version} value={x.version}>{x.version}{x.releasedAt ? ` — ${new Date(x.releasedAt).toLocaleDateString("pt-BR")}` : ""}</option>)}
        </select>
      </Field>
      {v.changelog && <div><div className="overline" style={{ marginBottom: 6 }}>Novidades</div><p className="muted selectable" style={{ whiteSpace: "pre-wrap" }}>{v.changelog}</p></div>}
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
        {item.mod.homepage && <button className="btn text" onClick={() => openUrl(item.mod.homepage!)}><Icon name="open_in_new" /> Página do mod</button>}
        <span className="spacer" />
        <button className="btn primary" disabled={busy || installedVersion === ver} onClick={() => onInstall(ver)}>
          {installedVersion === ver ? "Instalado" : installedVersion ? `Instalar ${ver}` : "Instalar e ativar"}
        </button>
      </footer>
    </Drawer>
  );
}
