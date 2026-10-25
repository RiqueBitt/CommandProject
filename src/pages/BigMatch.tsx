// Partida grande: escaramuça com todas as bases do mapa (12 contra 12, vários times, todos contra
// todos...). O lobby do jogo só tem 8 vagas; aqui cada base vira você, uma IA ou fica vazia, e o
// launcher abre o jogo direto na partida.
import { useEffect, useMemo, useState } from "react";
import { Empty, Field, Icon, Notice, Switch, TaskProgress } from "../components/ui";
import { api } from "../lib/api";
import { load, useStore } from "../lib/store";
import type { MatchMap, MatchOptions, MatchSlot, SlotKind } from "../lib/types";

/** As cores de exército na ordem do jogo: as 10 originais e as 14 que a partida grande acrescenta. */
export const GAME_COLORS: { hex: string; name: string }[] = [
  { hex: "#146fcd", name: "Azul" }, { hex: "#1bdd1b", name: "Verde" }, { hex: "#ff2a2a", name: "Vermelho" }, { hex: "#b061fa", name: "Roxo" },
  { hex: "#a26b25", name: "Bege" }, { hex: "#deddd1", name: "Cinza" }, { hex: "#92b220", name: "Oliva" }, { hex: "#00ffcc", name: "Ciano" },
  { hex: "#ffe600", name: "Amarelo" }, { hex: "#ff8000", name: "Laranja" }, { hex: "#ff5fb0", name: "Rosa" }, { hex: "#9dff1f", name: "Lima" },
  { hex: "#1fe0d0", name: "Turquesa" }, { hex: "#4060ff", name: "Marinho" }, { hex: "#c0304a", name: "Carmim" }, { hex: "#ffffff", name: "Branco" },
  { hex: "#ffc840", name: "Dourado" }, { hex: "#6fd0ff", name: "Celeste" }, { hex: "#ff40ff", name: "Magenta" }, { hex: "#60ffb0", name: "Menta" },
  { hex: "#b07040", name: "Marrom" }, { hex: "#ff7f60", name: "Coral" }, { hex: "#b8a0ff", name: "Lavanda" }, { hex: "#505050", name: "Preto" },
];
type ColorMode = "team" | "player";

/** Cor de cada vaga: a escolhida à mão; senão a do time (times diferentes, cores diferentes) ou uma por jogador. */
function slotColors(slots: MatchSlot[], mode: ColorMode): number[] {
  const n = GAME_COLORS.length;
  const manual = new Set(slots.filter((s) => s.kind !== "empty" && s.color >= 0).map((s) => s.color));
  const out: number[] = new Array(slots.length).fill(0);
  if (mode === "player") {
    let next = 0;
    slots.forEach((s, i) => {
      if (s.color >= 0) { out[i] = s.color % n; return; }
      while (manual.has(next % n) && next < n * 2) next++;
      out[i] = next % n;
      next++;
    });
    return out;
  }
  // times em ordem: time 1 → primeira cor livre, time 2 → a seguinte...; sozinhos ganham cores depois
  const teams = [...new Set(slots.filter((s) => s.kind !== "empty" && s.team > 0).map((s) => s.team))].sort((a, b) => a - b);
  const teamColor = new Map<number, number>();
  let next = 0;
  const take = () => { while (manual.has(next % n) && next < n * 2) next++; return next++ % n; };
  teams.forEach((t) => teamColor.set(t, take()));
  slots.forEach((s, i) => {
    if (s.color >= 0) out[i] = s.color % n;
    else if (s.team > 0 && teamColor.has(s.team)) out[i] = teamColor.get(s.team)!;
    else out[i] = s.kind === "empty" ? 0 : take();
  });
  return out;
}
const FACTIONS = ["Aleatória", "UEF", "Cybran", "Illuminate"];
const AI_LEVELS = [{ key: "Easy", label: "Fácil" }, { key: "Normal", label: "Normal" }, { key: "Hard", label: "Difícil" }, { key: "Cheat", label: "Trapaceira" }];
const DEFAULT_OPTIONS: MatchOptions = { victory: "demoralization", unitCap: 500, fog: "explored", speed: "normal", noRush: 0, prebuilt: false, civilians: "enemy" };

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

function defaultSlots(m: MatchMap): MatchSlot[] {
  const teams = m.armies.length >= 4 && m.armies.length % 2 === 0 ? splitTeams(m, 2, "side") : m.armies.map(() => 0);
  return m.armies.map((_, i) => ({ kind: i === 0 ? "you" : "ai", team: teams[i], faction: 0, ai: "Normal", color: -1 }));
}

/** "12 contra 12", "6 x 6 x 6", "todos contra todos (8)"... e o erro, se houver. */
function summary(slots: MatchSlot[]): { text: string; error: string | null; players: number } {
  const on = slots.filter((s) => s.kind !== "empty");
  const you = slots.filter((s) => s.kind === "you").length;
  const groups = new Map<string, number>();
  on.forEach((s, i) => { const k = s.team === 0 ? "solo" + i : "t" + s.team; groups.set(k, (groups.get(k) ?? 0) + 1); });
  const sizes = [...groups.values()].sort((a, b) => b - a);
  let error: string | null = null;
  if (you !== 1) error = you === 0 ? "Escolha uma base para você." : "Só uma base pode ser sua.";
  else if (on.length < 2) error = "A partida precisa de pelo menos 2 jogadores.";
  else if (groups.size < 2) error = "Todos estão no mesmo time: separe em pelo menos dois.";
  const same = sizes.length > 2 && sizes.every((n) => n === sizes[0]);
  const text = on.every((s) => s.team === 0) ? `todos contra todos (${on.length})`
    : sizes.length === 2 ? `${sizes[0]} contra ${sizes[1]}`
    : same ? (sizes[0] === 1 ? `${sizes.length} times de 1 (todos contra todos)` : `${sizes.length} times de ${sizes[0]}`)
    : sizes.length > 6 ? `${sizes.length} times` : sizes.join(" x ");
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
  const [options, setOptions] = useState<MatchOptions>(() => read("cp-bigmatch-options", DEFAULT_OPTIONS));
  const [teamCount, setTeamCount] = useState(2);
  const [splitBy, setSplitBy] = useState<"side" | "order">("side");
  const [colorMode, setColorMode] = useState<ColorMode>(() => { try { return (localStorage.getItem("cp-bigmatch-colors") as ColorMode) || "team"; } catch { return "team"; } });

  useEffect(() => { void load(() => api.bigMatchMaps()).then((m) => setMaps(m ?? [])); }, []);
  const map = useMemo(() => maps?.find((m) => m.path === path) ?? null, [maps, path]);
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
  useEffect(() => { try { localStorage.setItem("cp-bigmatch-colors", colorMode); } catch { /* ok */ } }, [colorMode]);

  const list = useMemo(() => (maps ?? []).filter((m) => (!onlyBig || m.armies.length > 8) && (!query.trim() || `${m.name} ${m.id} ${m.source}`.toLowerCase().includes(query.trim().toLowerCase()))), [maps, query, onlyBig]);
  const sum = summary(slots);
  // tantos times quantas bases (24 bases: até 24 times)
  const maxTeam = Math.max(2, slots.length);
  const colors = useMemo(() => slotColors(slots, colorMode), [slots, colorMode]);
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
    if (!map || sum.error) return;
    const r = await run("launch", () => api.launchBigMatch({ map: map.path, slots: slots.map((x, i) => ({ ...x, color: colors[i] })), options }), `Abrindo o jogo: ${sum.text} em ${map.name}.`);
    if (r) await refresh();
  };

  // prévia das bases: posição no mapa, cor do time, você marcado
  const preview = map && map.starts.length === map.armies.length ? (() => {
    const [w, h] = [map.size[0] || 1024, map.size[1] || 1024];
    const r = Math.max(9, Math.min(16, 220 / Math.sqrt(map.armies.length)));
    return (
      <svg className="bm-preview" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Bases de ${map.name}`}>
        <rect x={0} y={0} width={w} height={h} rx={w * 0.02} className="bm-ground" />
        {map.starts.map((p, i) => {
          const s = slots[i];
          if (!s) return null;
          const R = (r * w) / 300;
          return (
            <g key={i} className={`bm-base ${s.kind}`} onClick={() => setSlot(i, { kind: "you" })} style={{ cursor: "pointer" }}>
              <title>{`Base ${i + 1}: ${s.kind === "you" ? "você" : s.kind === "ai" ? "IA" : "vazia"}${s.team ? `, time ${s.team}` : ""} (clique para jogar aqui)`}</title>
              <circle cx={p[0]} cy={p[1]} r={R} fill={s.kind === "empty" ? "transparent" : colorOf(i)} stroke={s.kind === "you" ? "#fff" : s.kind === "empty" ? "#6b707c" : colorOf(i)} strokeWidth={s.kind === "you" ? R * 0.35 : R * 0.15} />
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
          <span className="overline"><Icon name="groups" size={15} /> Partida grande</span>
          <h1 className="page-title">Quantos jogadores o mapa tiver</h1>
          <p className="muted">12 contra 12, três times de 5, todos contra todos… Cada base do mapa vira você, uma IA ou fica vazia. O lobby do jogo só tem 8 vagas, então a partida começa direto, sem passar por ele.</p>
        </div>
      </header>

      {maps === null ? <div className="bar indeterminate"><i /></div> : maps.length === 0 ? (
        <Empty icon="map" title="Nenhum mapa encontrado" action={<button className="btn primary" onClick={() => goCreate("map")}>Criar um mapa</button>}>
          Confira em Configurações se a pasta do jogo está certa, ou crie um mapa com quantas bases quiser.
        </Empty>
      ) : (
        <div className="bm-grid">
          <section className="card pad bm-maps">
            <div className="card-title"><Icon name="map" /><h3>Mapa</h3></div>
            <input className="input" placeholder="Procurar mapa…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Procurar mapa" />
            <label className="row small" style={{ gap: 8, margin: "10px 0" }}><Switch label="Só mapas com mais de 8 bases" checked={onlyBig} onChange={setOnlyBig} /> Só mapas com mais de 8 bases</label>
            <div className="bm-map-list" role="listbox" aria-label="Mapas">
              {list.map((m) => (
                <button key={m.path} role="option" aria-selected={m.path === path} className={`bm-map ${m.path === path ? "on" : ""}`} onClick={() => setPath(m.path)}>
                  <span className={`bm-count ${m.armies.length > 8 ? "big" : ""}`}>{m.armies.length}</span>
                  <span className="grow"><span className="title">{m.name}</span><span className="sub">{m.source} · {m.size[0]}×{m.size[1]}</span></span>
                </button>
              ))}
              {!list.length && <p className="faint small">Nenhum mapa com esse filtro.</p>}
            </div>
            <button className="btn sm text" style={{ marginTop: 10 }} onClick={() => goCreate("map")}><Icon name="add" size={16} /> Criar mapa com mais bases</button>
          </section>

          {map && (
            <div className="col bm-main" style={{ gap: 16 }}>
              <section className="card pad">
                <div className="card-title"><Icon name="flag" /><h3>{map.name}</h3><span className={`chip ${sum.error ? "warn" : "ok"}`}>{sum.text}</span></div>
                <div className="bm-setup">
                  {preview}
                  <div className="col" style={{ gap: 12, flex: 1, minWidth: 240 }}>
                    <Field label="Times" hint={splitBy === "side" ? "Cada time fica num lado do mapa." : "Bases em sequência no mesmo time (1, 2, 3… depois as próximas)."}>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <div className="seg wrap" role="group" aria-label="Número de times">
                          {teamPresets.map((n) => (
                            <button key={n} type="button" className="btn" aria-pressed={teamCount === n && slots.some((s) => s.team > 0)} onClick={() => { setTeamCount(n); applyTeams(n); }}>{n}</button>
                          ))}
                          <button type="button" className="btn" aria-pressed={slots.every((s) => s.team === 0)} onClick={() => setSlots((l) => l.map((s) => ({ ...s, team: 0 })))}>Todos contra todos</button>
                        </div>
                        <label className="row small" style={{ gap: 6 }}>ou
                          <input className="input dense bm-num" type="number" min={2} max={slots.length} value={teamCount}
                            onChange={(e) => { const n = Math.max(2, Math.min(slots.length, Math.round(Number(e.target.value) || 2))); setTeamCount(n); applyTeams(n); }} aria-label="Número de times" /> times
                        </label>
                        <select className="select dense" value={splitBy} onChange={(e) => { const v = e.target.value as "side" | "order"; setSplitBy(v); if (map) { const t = splitTeams(map, teamCount, v); setSlots((l) => l.map((s, i) => ({ ...s, team: s.team === 0 && l.every((x) => x.team === 0) ? 0 : t[i] }))); } }} aria-label="Dividir por">
                          <option value="side">dividir pelo lado do mapa</option><option value="order">dividir pela ordem das bases</option>
                        </select>
                      </div>
                    </Field>
                    <Field label="Cores" hint={colorMode === "team" ? "Cada time com uma cor (até 24 cores diferentes)." : "Cada jogador com uma cor (24 cores; depois repetem)."}>
                      <div className="seg" role="group" aria-label="Cores">
                        <button type="button" className="btn" aria-pressed={colorMode === "team"} onClick={() => setColorMode("team")}>Por time</button>
                        <button type="button" className="btn" aria-pressed={colorMode === "player"} onClick={() => setColorMode("player")}>Por jogador</button>
                        <button type="button" className="btn" onClick={() => setSlots((l) => l.map((x) => ({ ...x, color: -1 })))} title="Volta todas as cores escolhidas à mão para automáticas">Automáticas</button>
                      </div>
                    </Field>
                    <Field label="Todas as IAs">
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <select className="select dense" value="" onChange={(e) => e.target.value && setAll({ ai: e.target.value })} aria-label="Dificuldade de todas as IAs">
                          <option value="">dificuldade…</option>{AI_LEVELS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                        </select>
                        <select className="select dense" value="" onChange={(e) => e.target.value !== "" && setAll({ faction: Number(e.target.value) })} aria-label="Facção de todas as IAs">
                          <option value="">facção…</option>{FACTIONS.map((f, i) => <option key={f} value={i}>{f}</option>)}
                        </select>
                        <button type="button" className="btn sm" onClick={() => setSlots((l) => l.map((s) => (s.kind === "empty" ? { ...s, kind: "ai" } : s)))}>Encher as vazias</button>
                      </div>
                    </Field>
                    <p className="faint small">Clique numa base da prévia para jogar nela.</p>
                    {map.lobbyRisk && <Notice kind="warn">Este mapa foi feito numa versão antiga e também aparece no lobby do jogo, que fecha o jogo com mais de 8 bases. Aqui ele funciona; para o lobby não mostrar, gere o mapa de novo no editor.</Notice>}
                  </div>
                </div>
                <div className="bm-slots-wrap">
                <div className="bm-slots" role="table" aria-label="Vagas">
                  <div className="bm-slot head" role="row"><span>Base</span><span>Quem</span><span>Time</span><span>Facção</span><span>IA</span><span>Cor</span></div>
                  {slots.length > 1 && <div className="bm-slot head second" aria-hidden><span>Base</span><span>Quem</span><span>Time</span><span>Facção</span><span>IA</span><span>Cor</span></div>}
                  {slots.map((s, i) => (
                    <div key={i} className={`bm-slot ${s.kind}`} role="row">
                      <span className="row" style={{ gap: 8 }}><i className="bm-dot" style={{ background: s.kind === "empty" ? "transparent" : colorOf(i), borderColor: colorOf(i) }} />{i + 1}</span>
                      <select className="select dense" value={s.kind} onChange={(e) => setSlot(i, { kind: e.target.value as SlotKind })} aria-label={`Quem joga na base ${i + 1}`}>
                        <option value="you">Você</option><option value="ai">IA</option><option value="empty">Vazia</option>
                      </select>
                      <select className="select dense" value={s.team} disabled={s.kind === "empty"} onChange={(e) => setSlot(i, { team: Number(e.target.value) })} aria-label={`Time da base ${i + 1}`}>
                        <option value={0}>Sozinho</option>
                        {Array.from({ length: maxTeam }, (_, k) => <option key={k} value={k + 1}>Time {k + 1}</option>)}
                      </select>
                      <select className="select dense" value={s.faction} disabled={s.kind === "empty"} onChange={(e) => setSlot(i, { faction: Number(e.target.value) })} aria-label={`Facção da base ${i + 1}`}>
                        {FACTIONS.map((f, k) => <option key={f} value={k}>{f}</option>)}
                      </select>
                      <select className="select dense" value={s.ai} disabled={s.kind !== "ai"} onChange={(e) => setSlot(i, { ai: e.target.value })} aria-label={`Dificuldade da IA da base ${i + 1}`}>
                        {AI_LEVELS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                      </select>
                      <select className="select dense bm-color" value={s.color} disabled={s.kind === "empty"} onChange={(e) => setSlot(i, { color: Number(e.target.value) })}
                        aria-label={`Cor da base ${i + 1}`} style={{ borderLeft: `6px solid ${colorOf(i)}` }}>
                        <option value={-1}>Auto: {GAME_COLORS[colors[i] ?? 0].name}</option>
                        {GAME_COLORS.map((c, k) => <option key={k} value={k}>{c.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                </div>
              </section>

              <section className="card pad">
                <div className="card-title"><Icon name="tune" /><h3>Regras</h3></div>
                <div className="bm-options">
                  <Field label="Vitória">
                    <select className="select" value={options.victory} onChange={(e) => setOpt({ victory: e.target.value })}>
                      <option value="demoralization">Destruir o comandante</option><option value="domination">Destruir tudo</option><option value="sandbox">Sem fim (sandbox)</option>
                    </select>
                  </Field>
                  <Field label="Limite de unidades por jogador" hint={sum.players > 12 && options.unitCap > 500 ? "Com muitos jogadores, um limite alto pesa no computador." : undefined}>
                    <select className="select" value={options.unitCap} onChange={(e) => setOpt({ unitCap: Number(e.target.value) })}>
                      {[100, 150, 250, 350, 500, 750, 1000].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </Field>
                  <Field label="Névoa de guerra">
                    <select className="select" value={options.fog} onChange={(e) => setOpt({ fog: e.target.value })}>
                      <option value="explored">Explorada</option><option value="unexplored">Inexplorada</option><option value="none">Sem névoa</option>
                    </select>
                  </Field>
                  <Field label="Velocidade">
                    <select className="select" value={options.speed} onChange={(e) => setOpt({ speed: e.target.value })}>
                      <option value="normal">Normal</option><option value="fast">Rápida</option><option value="adjustable">Ajustável</option>
                    </select>
                  </Field>
                  <Field label="Sem ataques no começo">
                    <select className="select" value={options.noRush} onChange={(e) => setOpt({ noRush: Number(e.target.value) })}>
                      {[0, 5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n ? `${n} minutos` : "Desligado"}</option>)}
                    </select>
                  </Field>
                  <Field label="Civis do mapa">
                    <select className="select" value={options.civilians} onChange={(e) => setOpt({ civilians: e.target.value })}>
                      <option value="enemy">Inimigos</option><option value="neutral">Neutros</option><option value="removed">Removidos</option>
                    </select>
                  </Field>
                  <label className="row" style={{ gap: 10 }}><Switch label="Começar com a base montada" checked={options.prebuilt} onChange={(v) => setOpt({ prebuilt: v })} /> Começar com a base montada</label>
                </div>
              </section>

              {sum.players > 8 && <Notice kind="info">O jogo foi feito para até 8 jogadores. Com mais, a partida fica mais pesada (cada IA pensa sozinha) e ainda não foi testada com tantos: se o jogo não abrir ou fechar ao carregar, tente com menos bases ou um limite de unidades menor e me conte quantos jogadores deram certo.</Notice>}
              {busy && <TaskProgress task="apply" label="Preparando a partida…" />}
              <div className="row bm-launch">
                <span className="grow">{sum.error ? <span className="chip warn"><Icon name="error_outline" size={14} /> {sum.error}</span> : <span className="muted">{sum.text} · {map.name}</span>}</span>
                <button className="btn primary" disabled={!!sum.error || busy || !!running} onClick={() => void play()}>
                  <Icon name="play_arrow" /> {busy ? "Abrindo…" : running ? "Jogo aberto" : "Jogar partida grande"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
