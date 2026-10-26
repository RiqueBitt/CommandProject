// Partida grande: escaramuça com todas as bases do mapa (12 contra 12, vários times, todos contra
// todos...). O lobby do jogo só tem 8 vagas; aqui cada base vira você, uma IA ou fica vazia, e o
// launcher abre o jogo direto na partida.
import { useEffect, useMemo, useRef, useState } from "react";
import CrashNotice from "../components/CrashNotice";
import { Empty, Field, Icon, Notice, Switch, TaskProgress } from "../components/ui";
import { api } from "../lib/api";
import { t, tr } from "../lib/i18n";
import { load, useStore } from "../lib/store";
import { shuffleSpawns } from "../lib/matchSpawn";
import { assignColors, GAME_COLORS, groupOf, type ColorMode } from "../lib/teamColors";
import type { MatchMap, MatchOptions, MatchSlot, SlotKind } from "../lib/types";

let mapCache: MatchMap[] | null = null;

/** Minimapas já pedidos (cenário#lado → data URL ou null), guardados enquanto o launcher está aberto. */
const images = new Map<string, Promise<string | null>>();
function mapImage(path: string, size: number): Promise<string | null> {
  const key = `${path}#${size}`;
  let p = images.get(key);
  if (!p) {
    p = api.bigMatchPreview(path, size).catch(() => null);
    images.set(key, p);
  }
  return p;
}
/** Minimapa do cenário; com `lazy`, só quando o elemento aparece na tela (lista com dezenas de mapas). */
function useMapImage(path: string | null, size: number, lazy?: React.RefObject<Element | null>): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let alive = true;
    const load = () => void mapImage(path, size).then((u) => { if (alive) setUrl(u); });
    const el = lazy?.current;
    if (!el || typeof IntersectionObserver === "undefined") { load(); return () => { alive = false; }; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: "120px" });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  }, [path, size, lazy]);
  return url;
}

/** Um mapa da lista: miniatura do terreno com o número de bases por cima. */
function MapItem({ m, on, onPick }: { m: MatchMap; on: boolean; onPick: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const img = useMapImage(m.path, 128, ref);
  return (
    <button role="option" aria-selected={on} className={`bm-map ${on ? "on" : ""}`} onClick={onPick}>
      <span ref={ref} className={`bm-thumb ${img ? "has" : ""}`} style={img ? { backgroundImage: `url(${img})` } : undefined}>
        <span className={`bm-count ${m.armies.length > 8 ? "big" : ""}`}>{m.armies.length}</span>
      </span>
      <span className="grow"><span className="title">{m.name}</span><span className="sub">{tr(m.source)} · {m.size[0]}×{m.size[1]}</span></span>
    </button>
  );
}

const FACTIONS = ["Aleatória", "UEF", "Cybran", "Illuminate"];
const AI_LEVELS = [{ key: "Easy", label: "Fácil" }, { key: "Normal", label: "Normal" }, { key: "Hard", label: "Difícil" }, { key: "Cheat", label: "Trapaceira" }];
const DEFAULT_OPTIONS: MatchOptions = {
  victory: "demoralization", unitCap: 500, fog: "explored", speed: "normal", noRush: 0, prebuilt: false, civilians: "enemy",
  restrictions: [], cheats: false, shareUnitCap: false, spawn: "fixed",
};
/** Restrições de unidades do lobby do jogo (mesmas chaves e efeito). */
const RESTRICTIONS: { key: string; label: string; hint: string }[] = [
  { key: "EXPERIMENTALS", label: "Sem experimentais", hint: "Nenhuma unidade nem fábrica experimental." },
  { key: "AIR", label: "Sem unidades aéreas", hint: "Sem aviões, fábricas aéreas e cápsulas de fuga." },
  { key: "LAND", label: "Sem unidades terrestres", hint: "Sem tanques, robôs e fábricas terrestres." },
  { key: "NAVAL", label: "Sem unidades navais", hint: "Sem navios e estaleiros." },
  { key: "NUKE", label: "Sem bombas nucleares", hint: "Sem silos de mísseis nucleares." },
  { key: "ARTILLERY", label: "Sem artilharia fixa", hint: "Sem estruturas de artilharia de longo alcance." },
  { key: "SHIELDS", label: "Sem escudos fixos", hint: "Sem estruturas de escudo." },
  { key: "INTEL", label: "Sem radar fixo", hint: "Sem estruturas de inteligência (radar, sonar)." },
  { key: "ADDONS", label: "Sem acessórios de estruturas", hint: "Sem os módulos que se encaixam nas estruturas." },
  { key: "MASSCONVERT", label: "Sem conversores de massa", hint: "Massa só das jazidas e da recuperação." },
  { key: "NO_DLC", label: "Sem unidades da expansão", hint: "Só as unidades do jogo original." },
  { key: "SLOW_RESEARCH", label: "Pesquisa lenta", hint: "Sem estações de pesquisa." },
  { key: "ALL_RESEARCH_UNITS", label: "Sem pesquisa: unidades liberadas", hint: "Todas as unidades liberadas desde o começo; as melhorias continuam a pesquisar." },
  { key: "ALL_RESEARCH", label: "Sem pesquisa: tudo liberado", hint: "Todas as unidades e melhorias liberadas desde o começo." },
];

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch { return fallback; }
}
function readSlots(path: string): MatchSlot[] | null {
  try {
    const v = localStorage.getItem("cp-bigmatch:" + path);
    return v ? (JSON.parse(v) as MatchSlot[]) : null;
  } catch { return null; }
}
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ok */ } };

/** Divide as bases em `n` times: pelo lado do mapa (ângulo em volta do centro) ou pela ordem das bases. */
function splitTeams(m: MatchMap, n: number, by: "side" | "order"): number[] {
  const count = m.armies.length;
  const order = Array.from({ length: count }, (_, i) => i);
  if (by === "side" && m.starts.length === count) {
    const cx = m.starts.reduce((a, p) => a + p[0], 0) / count, cz = m.starts.reduce((a, p) => a + p[1], 0) / count;
    const ang = m.starts.map((p) => Math.atan2(p[1] - cz, p[0] - cx));
    // começa no maior vão entre bases vizinhas: cada time fica num lado contínuo do mapa
    order.sort((a, b) => ang[a] - ang[b]);
    let gap = -1, at = 0;
    order.forEach((idx, k) => {
      const next = ang[order[(k + 1) % count]] + (k + 1 === count ? Math.PI * 2 : 0);
      if (next - ang[idx] > gap) { gap = next - ang[idx]; at = (k + 1) % count; }
    });
    order.push(...order.splice(0, at));
  }
  const team = new Array<number>(count).fill(1);
  order.forEach((idx, k) => { team[idx] = Math.floor((k * n) / count) + 1; });
  return team;
}

/** Exércitos que o motor do jogo aguenta numa partida (contando os civis do mapa, que ficam de fora
 *  quando não cabem). Igual a `MAX_ARMIES` no cp-core. */
const MAX_PLAYERS = 32;

function defaultSlots(m: MatchMap): MatchSlot[] {
  const teams = m.armies.length >= 4 && m.armies.length % 2 === 0 ? splitTeams(m, 2, "side") : m.armies.map(() => 0);
  // mapas com mais bases que o jogo aguenta: as do fim começam vazias
  return m.armies.map((_, i) => ({ kind: i === 0 ? "you" : i < MAX_PLAYERS ? "ai" : "empty", team: teams[i], faction: 0, ai: "Normal", color: -1 }));
}

/** "12 contra 12", "6 x 6 x 6", "todos contra todos (8)"... e o erro, se houver. */
function summary(slots: MatchSlot[]): { text: string; error: string | null; players: number } {
  const on = slots.filter((s) => s.kind !== "empty");
  const you = slots.filter((s) => s.kind === "you").length;
  const groups = new Map<string, number>();
  on.forEach((s, i) => { const k = s.team === 0 ? "solo" + i : "t" + s.team; groups.set(k, (groups.get(k) ?? 0) + 1); });
  const sizes = [...groups.values()].sort((a, b) => b - a);
  let error: string | null = null;
  if (you !== 1) error = you === 0 ? t("Escolha uma base para você.") : t("Só uma base pode ser sua.");
  else if (on.length < 2) error = t("A partida precisa de pelo menos 2 jogadores.");
  else if (on.length > MAX_PLAYERS) error = t("O jogo aguenta até {max} jogadores numa partida: deixe {n} base(s) vazia(s).", { max: MAX_PLAYERS, n: on.length - MAX_PLAYERS });
  else if (groups.size < 2) error = t("Todos estão no mesmo time: separe em pelo menos dois.");
  const same = sizes.length > 2 && sizes.every((n) => n === sizes[0]);
  const text = on.every((s) => s.team === 0) ? t("todos contra todos ({n})", { n: on.length })
    : sizes.length === 2 ? t("{a} contra {b}", { a: sizes[0], b: sizes[1] })
    : same ? (sizes[0] === 1 ? t("{n} times de 1 (todos contra todos)", { n: sizes.length }) : t("{n} times de {size}", { n: sizes.length, size: sizes[0] }))
    : sizes.length > 6 ? t("{n} times", { n: sizes.length }) : sizes.join(" x ");
  return { text, error, players: on.length };
}

export default function BigMatch() {
  const busy = useStore((s) => s.busy.launch || s.busy.apply);
  const running = useStore((s) => s.dashboard?.gameRunning);
  const { run, refresh, goCreate } = useStore.getState();
  const [maps, setMaps] = useState<MatchMap[] | null>(null);
  const [query, setQuery] = useState("");
  const [onlyBig, setOnlyBig] = useState(false);
  const [path, setPath] = useState<string>(() => { try { return localStorage.getItem("cp-bigmatch-map") ?? ""; } catch { return ""; } });
  const [slots, setSlots] = useState<MatchSlot[]>([]);
  const [options, setOptions] = useState<MatchOptions>(() => ({ ...DEFAULT_OPTIONS, ...read<Partial<MatchOptions>>("cp-bigmatch-options", {}) }));
  const [teamCount, setTeamCount] = useState(2);
  const [splitBy, setSplitBy] = useState<"side" | "order">("side");
  const [colorMode, setColorMode] = useState<ColorMode>(() => { try { return (localStorage.getItem("cp-bigmatch-colors2") as ColorMode) || "player"; } catch { return "player"; } });

  useEffect(() => {
    // a lista demora (lê os mapas de todos os .scd): a última fica guardada enquanto o launcher está aberto
    if (mapCache) setMaps(mapCache);
    void load(() => api.bigMatchMaps()).then((m) => { if (m) { mapCache = m; setMaps(m); } else if (!mapCache) setMaps([]); });
  }, []);
  // com o jogo aberto, confere de tempos em tempos se ele fechou (para liberar o botão)
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [running, refresh]);
  const map = useMemo(() => maps?.find((m) => m.path === path) ?? null, [maps, path]);
  const terrain = useMapImage(map?.path ?? null, 512);
  useEffect(() => {
    if (!maps?.length) return;
    if (!map) { setPath(maps[0].path); return; }
    const saved = readSlots(map.path);
    // vagas guardadas de versões antigas não têm cor: automática
    setSlots(saved && saved.length === map.armies.length ? saved.map((x) => ({ ...x, color: typeof x.color === "number" ? x.color : -1 })) : defaultSlots(map));
    try { localStorage.setItem("cp-bigmatch-map", map.path); } catch { /* ok */ }
  }, [maps, map]);
  useEffect(() => { if (map && slots.length === map.armies.length) save("cp-bigmatch:" + map.path, slots); }, [map, slots]);
  useEffect(() => { save("cp-bigmatch-options", options); }, [options]);
  useEffect(() => { try { localStorage.setItem("cp-bigmatch-colors2", colorMode); } catch { /* ok */ } }, [colorMode]);

  const list = useMemo(() => (maps ?? []).filter((m) => (!onlyBig || m.armies.length > 8) && (!query.trim() || `${m.name} ${m.id} ${m.source}`.toLowerCase().includes(query.trim().toLowerCase()))), [maps, query, onlyBig]);
  const sum = summary(slots);
  // tantos times quantas bases (24 bases: até 24 times)
  const maxTeam = Math.max(2, slots.length);
  const colorPlan = useMemo(() => assignColors(slots, colorMode), [slots, colorMode]);
  const colors = colorPlan.colors;
  const error = sum.error ?? colorPlan.error;
  // cor escolhida à mão: vale para o time inteiro (por time) ou só para a vaga (por jogador)
  const setColor = (i: number, color: number) => setSlots((list) => list.map((x, j) => {
    const sameTeam = colorMode === "team" && list[i].team > 0 && x.team === list[i].team;
    return j === i || sameTeam ? { ...x, color } : x;
  }));
  /** quem já usa cada cor (por jogador: qualquer outra vaga; por time: outro time) */
  const colorOwner = (k: number, i: number) => {
    const me = colorMode === "team" ? groupOf(slots[i], i) : `p${i}`;
    for (let j = 0; j < slots.length; j++) {
      if (slots[j].kind === "empty" || colors[j] !== k) continue;
      const other = colorMode === "team" ? groupOf(slots[j], j) : `p${j}`;
      if (other === me) continue;
      if (colorMode === "team") return slots[j].team > 0 ? t("time {n}", { n: slots[j].team }) : t("base {n}", { n: j + 1 });
      return slots[j].team > 0 ? t("base {base}, time {team}", { base: j + 1, team: slots[j].team }) : t("base {n}", { n: j + 1 });
    }
    return null;
  };
  const teamPresets = [2, 3, 4, 6, 8, 12, 24].filter((n) => n <= slots.length);
  const setSlot = (i: number, patch: Partial<MatchSlot>) => setSlots((list) => list.map((s, j) => {
    if (j === i) return { ...s, ...patch };
    // só uma base é sua: a antiga vira IA
    if (patch.kind === "you" && s.kind === "you") return { ...s, kind: "ai" as SlotKind };
    return s;
  }));
  const setAll = (patch: Partial<MatchSlot>, onlyAi = true) => setSlots((list) => list.map((s) => (onlyAi && s.kind !== "ai" ? s : { ...s, ...patch })));
  const applyTeams = (n: number) => {
    if (!map) return;
    const t = splitTeams(map, n, splitBy);
    setSlots((list) => list.map((s, i) => ({ ...s, team: t[i] })));
  };
  const setOpt = (patch: Partial<MatchOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const colorOf = (i: number) => GAME_COLORS[colors[i] ?? 0].hex;

  const play = async () => {
    if (!map || error) return;
    // posições sorteadas: cada vaga leva junto a cor dela
    const placed = shuffleSpawns(slots.map((x, i) => ({ ...x, color: colors[i] })), options.spawn);
    const r = await run("launch", () => api.launchBigMatch({ map: map.path, slots: placed, options }), (options.spawn !== "fixed" ? t("Abrindo o jogo: {what} em {map} (posições sorteadas).", { what: sum.text, map: map.name }) : t("Abrindo o jogo: {what} em {map}.", { what: sum.text, map: map.name })));
    if (r) await refresh();
  };

  // prévia das bases: o terreno do mapa (minimapa do jogo), posição de cada base, cor e você marcado
  const preview = map && map.starts.length === map.armies.length ? (() => {
    const [w, h] = [map.size[0] || 1024, map.size[1] || 1024];
    const r = Math.max(9, Math.min(16, 220 / Math.sqrt(map.armies.length)));
    const rx = w * 0.02;
    return (
      <svg className={`bm-preview ${terrain ? "has-image" : ""}`} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("Bases de {map}", { map: map.name })}>
        <defs><clipPath id="bm-clip"><rect x={0} y={0} width={w} height={h} rx={rx} /></clipPath></defs>
        <rect x={0} y={0} width={w} height={h} rx={rx} className="bm-ground" />
        {terrain && (
          <g clipPath="url(#bm-clip)">
            <image href={terrain} x={0} y={0} width={w} height={h} preserveAspectRatio="none" className="bm-terrain" />
            {/* escurece um pouco o terreno para as bases se destacarem */}
            <rect x={0} y={0} width={w} height={h} className="bm-shade" />
          </g>
        )}
        <rect x={0} y={0} width={w} height={h} rx={rx} className="bm-frame" />
        {map.starts.map((p, i) => {
          const s = slots[i];
          if (!s) return null;
          const R = (r * w) / 300;
          return (
            <g key={i} className={`bm-base ${s.kind}`} onClick={() => setSlot(i, { kind: "you" })} style={{ cursor: "pointer" }}>
              <title>{t("Base {n}: {who}{team} (clique para jogar aqui)", { n: i + 1, who: s.kind === "you" ? t("você") : s.kind === "ai" ? t("IA") : t("vazia"), team: s.team ? t(", time {n}", { n: s.team }) : "" })}</title>
              <circle cx={p[0]} cy={p[1]} r={R * 1.12} className="bm-halo" />
              <circle cx={p[0]} cy={p[1]} r={R} fill={s.kind === "empty" ? "rgba(11,15,20,.55)" : colorOf(i)} stroke={s.kind === "you" ? "#fff" : s.kind === "empty" ? "#6b707c" : colorOf(i)} strokeWidth={s.kind === "you" ? R * 0.35 : R * 0.15} />
              <text x={p[0]} y={p[1] + R * 0.38} textAnchor="middle" fontSize={R * 1.05} className="bm-label">{s.kind === "you" ? "★" : i + 1}</text>
            </g>
          );
        })}
      </svg>
    );
  })() : null;

  return (
    <div className="page bigmatch-page">
      <header className="page-head">
        <div>
          <span className="overline"><Icon name="groups" size={15} /> {t("Partida grande")}</span>
          <h1 className="page-title">{t("Quantos jogadores o mapa tiver")}</h1>
          <p className="muted">{t("12 contra 12, três times de 5, todos contra todos… Cada base do mapa vira você, uma IA ou fica vazia. O lobby do jogo só tem 8 vagas, então a partida começa direto, sem passar por ele.")}</p>
        </div>
      </header>

      {maps === null ? <div className="bar indeterminate"><i /></div> : maps.length === 0 ? (
        <Empty icon="map" title={t("Nenhum mapa encontrado")} action={<button className="btn primary" onClick={() => goCreate("map")}>{t("Criar um mapa")}</button>}>
          {t("Confira em Configurações se a pasta do jogo está certa, ou crie um mapa com quantas bases quiser.")}
        </Empty>
      ) : (
        <div className="bm-grid">
          <section className="card pad bm-maps">
            <div className="card-title"><Icon name="map" /><h3>{t("Mapa")}</h3></div>
            <input className="input" placeholder={t("Procurar mapa…")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Procurar mapa")} />
            <label className="row small" style={{ gap: 8, margin: "10px 0" }}><Switch label={t("Só mapas com mais de 8 bases")} checked={onlyBig} onChange={setOnlyBig} /> {t("Só mapas com mais de 8 bases")}</label>
            <div className="bm-map-list" role="listbox" aria-label={t("Mapas")}>
              {list.map((m) => <MapItem key={m.path} m={m} on={m.path === path} onPick={() => setPath(m.path)} />)}
              {!list.length && <p className="faint small">{t("Nenhum mapa com esse filtro.")}</p>}
            </div>
            <button className="btn sm text" style={{ marginTop: 10 }} onClick={() => goCreate("map")}><Icon name="add" size={16} /> {t("Criar mapa com mais bases")}</button>
          </section>

          {map && (
            <div className="col bm-main" style={{ gap: 16 }}>
              {/* o jogo fechou no meio da última partida: o que o log disse, no alto da tela */}
              <CrashNotice />
              <section className="card pad">
                <div className="card-title"><Icon name="flag" /><h3>{map.name}</h3><span className={`chip ${error ? "warn" : "ok"}`}>{sum.text}</span></div>
                <div className="bm-setup">
                  {preview}
                  <div className="col" style={{ gap: 12, flex: 1, minWidth: 240 }}>
                    <Field label={t("Times")} hint={splitBy === "side" ? t("Cada time fica num lado do mapa.") : t("Bases em sequência no mesmo time (1, 2, 3… depois as próximas).")}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <div className="seg wrap" role="group" aria-label={t("Número de times")}>
                          {teamPresets.map((n) => (
                            <button key={n} type="button" className="btn" aria-pressed={teamCount === n && slots.some((s) => s.team > 0)} onClick={() => { setTeamCount(n); applyTeams(n); }}>{n}</button>
                          ))}
                          <button type="button" className="btn" aria-pressed={slots.every((s) => s.team === 0)} onClick={() => setSlots((l) => l.map((s) => ({ ...s, team: 0 })))}>{t("Todos contra todos")}</button>
                        </div>
                        <label className="row small" style={{ gap: 6 }}>{t("ou")}
                          <input className="input dense bm-num" type="number" min={2} max={slots.length} value={teamCount}
                            onChange={(e) => { const n = Math.max(2, Math.min(slots.length, Math.round(Number(e.target.value) || 2))); setTeamCount(n); applyTeams(n); }} aria-label={t("Número de times")} /> {t("times")}
                        </label>
                        <select className="select dense" value={splitBy} onChange={(e) => { const v = e.target.value as "side" | "order"; setSplitBy(v); if (map) { const t = splitTeams(map, teamCount, v); setSlots((l) => l.map((s, i) => ({ ...s, team: s.team === 0 && l.every((x) => x.team === 0) ? 0 : t[i] }))); } }} aria-label={t("Dividir por")}>
                          <option value="side">{t("dividir pelo lado do mapa")}</option><option value="order">{t("dividir pela ordem das bases")}</option>
                        </select>
                      </div>
                    </Field>
                    <Field label={t("Cores")} hint={colorMode === "team" ? t("Cada time com uma cor só dele (até {n} times). A cor escolhida numa vaga vale para o time todo.", { n: GAME_COLORS.length }) : t("Cada jogador com uma cor diferente, mesmo no mesmo time ({n} cores). Cores já usadas por outra base ficam bloqueadas.", { n: GAME_COLORS.length })}>
                      <div className="seg" role="group" aria-label={t("Cores")}>
                        <button type="button" className="btn" aria-pressed={colorMode === "player"} onClick={() => setColorMode("player")}>{t("Por jogador")}</button>
                        <button type="button" className="btn" aria-pressed={colorMode === "team"} onClick={() => setColorMode("team")}>{t("Por time")}</button>
                        <button type="button" className="btn" onClick={() => setSlots((l) => l.map((x) => ({ ...x, color: -1 })))} title={t("Volta todas as cores escolhidas à mão para automáticas")}>{t("Automáticas")}</button>
                      </div>
                    </Field>
                    <Field label={t("Todas as IAs")}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <select className="select dense" value="" onChange={(e) => e.target.value && setAll({ ai: e.target.value })} aria-label={t("Dificuldade de todas as IAs")}>
                          <option value="">{t("dificuldade…")}</option>{AI_LEVELS.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
                        </select>
                        <select className="select dense" value="" onChange={(e) => e.target.value !== "" && setAll({ faction: Number(e.target.value) })} aria-label={t("Facção de todas as IAs")}>
                          <option value="">{t("facção…")}</option>{FACTIONS.map((f, i) => <option key={f} value={i}>{t(f)}</option>)}
                        </select>
                        <button type="button" className="btn sm" disabled={sum.players >= MAX_PLAYERS} title={sum.players >= MAX_PLAYERS ? t("O jogo aguenta até {max} jogadores numa partida.", { max: MAX_PLAYERS }) : undefined} onClick={() => setSlots((l) => {
                          // até o limite do jogo: as vazias do fim continuam vazias
                          let free = MAX_PLAYERS - l.filter((s) => s.kind !== "empty").length;
                          return l.map((s) => (s.kind === "empty" && free-- > 0 ? { ...s, kind: "ai" } : s));
                        })}>{t("Encher as vazias")}</button>
                      </div>
                    </Field>
                    <p className="faint small">{t("Clique numa base da prévia para jogar nela.")}</p>
                    {colorPlan.note && <Notice kind="info">{tr(colorPlan.note)}</Notice>}
                    {map.lobbyRisk && <Notice kind="warn">{t("Este mapa foi feito numa versão antiga e também aparece no lobby do jogo, que fecha o jogo com mais de 8 bases. Aqui ele funciona; para o lobby não mostrar, gere o mapa de novo no editor.")}</Notice>}
                  </div>
                </div>
                <div className="bm-slots-wrap">
                <div className="bm-slots" role="table" aria-label={t("Vagas")}>
                  <div className="bm-slot head" role="row"><span>{t("Base")}</span><span>{t("Quem")}</span><span>{t("Time")}</span><span>{t("Facção")}</span><span>{t("IA")}</span><span>{t("Cor")}</span></div>
                  {slots.length > 1 && <div className="bm-slot head second" aria-hidden><span>{t("Base")}</span><span>{t("Quem")}</span><span>{t("Time")}</span><span>{t("Facção")}</span><span>{t("IA")}</span><span>{t("Cor")}</span></div>}
                  {slots.map((s, i) => (
                    <div key={i} className={`bm-slot ${s.kind}`} role="row">
                      <span className="row" style={{ gap: 8 }}><i className="bm-dot" style={{ background: s.kind === "empty" ? "transparent" : colorOf(i), borderColor: colorOf(i) }} />{i + 1}</span>
                      <select className="select dense" value={s.kind} onChange={(e) => setSlot(i, { kind: e.target.value as SlotKind })} aria-label={t("Quem joga na base {n}", { n: i + 1 })}>
                        <option value="you">{t("Você")}</option><option value="ai">{t("IA")}</option><option value="empty">{t("Vazia")}</option>
                      </select>
                      <select className="select dense" value={s.team} disabled={s.kind === "empty"} onChange={(e) => setSlot(i, { team: Number(e.target.value) })} aria-label={t("Time da base {n}", { n: i + 1 })}>
                        <option value={0}>{t("Sozinho")}</option>
                        {Array.from({ length: maxTeam }, (_, k) => <option key={k} value={k + 1}>{t("Time {n}", { n: k + 1 })}</option>)}
                      </select>
                      <select className="select dense" value={s.faction} disabled={s.kind === "empty"} onChange={(e) => setSlot(i, { faction: Number(e.target.value) })} aria-label={t("Facção da base {n}", { n: i + 1 })}>
                        {FACTIONS.map((f, k) => <option key={f} value={k}>{t(f)}</option>)}
                      </select>
                      <select className="select dense" value={s.ai} disabled={s.kind !== "ai"} onChange={(e) => setSlot(i, { ai: e.target.value })} aria-label={t("Dificuldade da IA da base {n}", { n: i + 1 })}>
                        {AI_LEVELS.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
                      </select>
                      <select className="select dense bm-color" value={s.color} disabled={s.kind === "empty"} onChange={(e) => setColor(i, Number(e.target.value))}
                        aria-label={t("Cor da base {n}", { n: i + 1 })} style={{ borderLeft: `6px solid ${colorOf(i)}` }}>
                        <option value={-1}>{t("Auto: {color}", { color: t(GAME_COLORS[colors[i] ?? 0].name) })}</option>
                        {GAME_COLORS.map((c, k) => {
                          const owner = colorOwner(k, i);
                          return <option key={k} value={k} disabled={!!owner}>{t(c.name)}{owner ? ` (${owner})` : ""}</option>;
                        })}
                      </select>
                    </div>
                  ))}
                </div>
                </div>
              </section>

              <section className="card pad">
                <div className="card-title"><Icon name="tune" /><h3>{t("Regras")}</h3></div>
                <div className="bm-options">
                  <Field label={t("Vitória")}>
                    <select className="select" value={options.victory} onChange={(e) => setOpt({ victory: e.target.value })}>
                      <option value="demoralization">{t("Destruir o comandante")}</option><option value="domination">{t("Destruir tudo")}</option><option value="sandbox">{t("Sem fim (sandbox)")}</option>
                    </select>
                  </Field>
                  <Field label={t("Limite de unidades por jogador")} hint={sum.players > 12 && options.unitCap > 500 ? t("Com muitos jogadores, um limite alto pesa no computador.") : undefined}>
                    <select className="select" value={options.unitCap} onChange={(e) => setOpt({ unitCap: Number(e.target.value) })}>
                      {[100, 150, 250, 350, 500, 750, 1000, 1500, 2000].map((n) => <option key={n} value={n}>{n === 500 ? t("{n} (padrão)", { n }) : n}</option>)}
                    </select>
                  </Field>
                  <Field label={t("Visão do mapa (névoa de guerra)")} hint={options.fog === "none" ? t("Todos veem o mapa e todas as unidades o tempo todo.") : options.fog === "explored" ? t("O terreno aparece; as unidades inimigas só com visão ou radar.") : t("Terreno e unidades só aparecem depois de explorar.")}>
                    <select className="select" value={options.fog} onChange={(e) => setOpt({ fog: e.target.value })}>
                      <option value="explored">{t("Terreno visível (padrão)")}</option>
                      <option value="unexplored">{t("Escondido até explorar")}</option>
                      <option value="none">{t("Visão total (sem névoa)")}</option>
                    </select>
                  </Field>
                  <Field label={t("Posições iniciais")}>
                    <select className="select" value={options.spawn} onChange={(e) => setOpt({ spawn: e.target.value as MatchOptions["spawn"] })}>
                      <option value="fixed">{t("Fixas, como na prévia")}</option>
                      <option value="team">{t("Sorteadas dentro de cada time")}</option>
                      <option value="all">{t("Sorteadas entre todas as bases")}</option>
                    </select>
                  </Field>
                  <Field label={t("Velocidade")}>
                    <select className="select" value={options.speed} onChange={(e) => setOpt({ speed: e.target.value })}>
                      <option value="normal">{t("Normal")}</option><option value="fast">{t("Rápida")}</option><option value="adjustable">{t("Ajustável")}</option>
                    </select>
                  </Field>
                  <Field label={t("Sem ataques no começo")}>
                    <select className="select" value={options.noRush} onChange={(e) => setOpt({ noRush: Number(e.target.value) })}>
                      {[0, 5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n ? t("{n} minutos", { n }) : t("Desligado")}</option>)}
                    </select>
                  </Field>
                  <Field label={t("Civis do mapa")}>
                    <select className="select" value={options.civilians} onChange={(e) => setOpt({ civilians: e.target.value })}>
                      <option value="enemy">{t("Inimigos")}</option><option value="neutral">{t("Neutros")}</option><option value="removed">{t("Removidos")}</option>
                    </select>
                  </Field>
                  <label className="row" style={{ gap: 10 }}><Switch label={t("Começar com a base montada")} checked={options.prebuilt} onChange={(v) => setOpt({ prebuilt: v })} /> {t("Começar com a base montada")}</label>
                  <label className="row" style={{ gap: 10 }} title={t("Quando um jogador é derrotado, o limite de unidades dele passa para os aliados.")}><Switch label={t("Dividir o limite de unidades com o time")} checked={options.shareUnitCap} onChange={(v) => setOpt({ shareUnitCap: v })} /> {t("Limite de quem morre passa para o time")}</label>
                  <label className="row" style={{ gap: 10 }} title={t("Libera os comandos de trapaça do console do próprio jogo. O mod de Trapaças do launcher funciona com ou sem isto.")}><Switch label={t("Trapaças do console do jogo")} checked={options.cheats} onChange={(v) => setOpt({ cheats: v })} /> {t("Trapaças do console do jogo")}</label>
                </div>
                <div className="bm-restrict">
                  <div className="row" style={{ gap: 8 }}>
                    <span className="label grow">{t("Restrições de unidades")} {options.restrictions.length > 0 && <span className="chip">{options.restrictions.length}</span>}</span>
                    {options.restrictions.length > 0 && <button type="button" className="btn sm text" onClick={() => setOpt({ restrictions: [] })}>{t("Limpar")}</button>}
                  </div>
                  <div className="bm-restrict-grid">
                    {RESTRICTIONS.map((r) => {
                      const on = options.restrictions.includes(r.key);
                      return (
                        <label key={r.key} className={`check ${on ? "on" : ""}`} title={t(r.hint)}>
                          <input type="checkbox" checked={on} onChange={(e) => {
                            let next = options.restrictions.filter((k) => k !== r.key);
                            if (e.target.checked) {
                              next.push(r.key);
                              // as duas "sem pesquisa" não vão juntas
                              if (r.key === "ALL_RESEARCH") next = next.filter((k) => k !== "ALL_RESEARCH_UNITS");
                              if (r.key === "ALL_RESEARCH_UNITS") next = next.filter((k) => k !== "ALL_RESEARCH");
                            }
                            setOpt({ restrictions: next });
                          }} /> {t(r.label)}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>

              {(map.size[0] > 2048 || sum.players > 24) ? (
                <Notice kind="warn">
                  {map.size[0] > 2048 && t("Mapa de {size}: acima de 2048 é experimental (os mapas do jogo vão até 2048) e pesa bem mais para carregar.", { size: map.size[0] })}
                  {map.size[0] > 2048 && sum.players > 24 && " "}
                  {sum.players > 24 && t("Mais de 24 jogadores ainda não foi testado; o jogo aguenta até {max} exércitos e os civis do mapa ficam de fora quando não cabem.", { max: MAX_PLAYERS })}
                  {" "}{t("Se o jogo fechar, o launcher mostra aqui o que o log do jogo disse.")}
                </Notice>
              ) : sum.players > 8 && <Notice kind="info">{t("O jogo foi feito para até 8 jogadores. Com mais, a partida fica mais pesada (cada IA pensa sozinha): se o jogo fechar ao carregar, o launcher mostra aqui o que o log do jogo disse.")}</Notice>}
              {busy && <TaskProgress task="apply" label={t("Preparando a partida…")} />}
              <div className="row bm-launch">
                <span className="grow">{error ? <span className="chip warn"><Icon name="error_outline" size={14} /> {tr(error)}</span> : <span className="muted">{sum.text} · {map.name}</span>}</span>
                {running && (
                  <button className="btn" onClick={async () => {
                    const n = await run("kill", () => api.killGame(), (k) => (k ? t("Jogo fechado.") : t("O jogo já tinha fechado.")));
                    if (n !== undefined) await refresh();
                  }} title={t("Fecha o jogo quando ele some da tela mas continua aberto")}>
                    <Icon name="close" /> {t("Fechar o jogo travado")}
                  </button>
                )}
                <button className="btn primary" disabled={!!error || busy || !!running} onClick={() => void play()}>
                  <Icon name="play_arrow" /> {busy ? t("Abrindo…") : running ? t("Jogo aberto") : t("Jogar partida grande")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
