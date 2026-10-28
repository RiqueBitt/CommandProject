// Minigames da Partida grande (CPMinigames.lua, no mod cp-partida-grande): textos, ícones, mutadores,
// conquistas, desafio da semana e a prévia dos pontos de controle. As chaves são as de `CPMode`
// (`cp_core::bigmatch::MODES`) e `CPMut` (`cp_core::bigmatch::MUTATORS`).

export type MinigameMode = "" | "total" | "arena" | "defense" | "domination" | "supreme" | "survival" | "koth" | "vip" | "race" | "treasure";

export interface MinigameInfo { key: MinigameMode; name: string; icon: string; hint: string; win: string }

export const MINIGAMES: MinigameInfo[] = [
  { key: "", name: "Partida normal", icon: "sports_esports", hint: "A escaramuça de sempre, com o tipo de vitória das regras.", win: "Conforme as regras" },
  { key: "domination", name: "Dominação Estratégica", icon: "flag", hint: "Pontos de controle marcados por setas dão 1 ponto por segundo ao time que os segura (e um pouco de recursos). A IA também disputa os pontos.", win: "O primeiro time a chegar à pontuação-alvo" },
  { key: "koth", name: "Rei da Colina", icon: "landscape", hint: "Uma única colina. Segure sem interrupção pelo tempo escolhido; de tempos em tempos ela muda de lugar.", win: "Segurar a colina pelo tempo todo" },
  { key: "arena", name: "Arena dos Experimentais", icon: "smart_toy", hint: "Cada jogador começa com experimentais da sua facção no lugar do comandante. Depois de 3 minutos, a zona segura fecha no centro.", win: "O último que sobrar" },
  { key: "defense", name: "Última Linha de Defesa", icon: "shield", hint: "Tempo para montar a base e depois ondas de inimigos cada vez maiores, com experimentais a cada 5. Entre as ondas chegam suprimentos.", win: "Segurar todas as ondas com o comandante vivo" },
  { key: "survival", name: "Sobrevivência Infinita", icon: "all_inclusive", hint: "A Defesa sem fim: ondas até a base cair, com um chefe a cada 5. A dificuldade acompanha o seu desempenho.", win: "Bater o seu recorde de ondas" },
  { key: "vip", name: "Escolta", icon: "person_pin", hint: "Cada time protege um VIP (um engenheiro 5 vezes mais resistente, marcado por uma seta). Perdeu o VIP, perdeu a partida.", win: "O último time com o VIP vivo" },
  { key: "race", name: "Corrida de Recursos", icon: "trending_up", hint: "Vence quem produzir primeiro a massa da meta. Rápido, bom para partidas curtas com amigos.", win: "Chegar primeiro à meta de massa" },
  { key: "treasure", name: "Caça ao Tesouro", icon: "redeem", hint: "Caixas aparecem pelo mapa e dão recursos, pesquisa ou até uma experimental a quem chega primeiro.", win: "Juntar as caixas da meta" },
  { key: "total", name: "Guerra Total", icon: "public", hint: "Mais recursos no começo e 5 pontos estratégicos que dão massa, energia e pesquisa a quem os segura. Guerra em várias frentes.", win: "Destruir os comandantes inimigos" },
  { key: "supreme", name: "Projeto Supremo", icon: "science", hint: "A pesquisa vem das eliminações e dos pontos de controle. Cada nível dá um bônus: o caminho na árvore de pesquisa é escolha sua.", win: "Destruir os comandantes inimigos" },
];

export function minigame(key: string | undefined): MinigameInfo {
  return MINIGAMES.find((m) => m.key === (key ?? "")) ?? MINIGAMES[0];
}

export type Mutator = "air" | "hp" | "res" | "cdr";
export const MUTATORS: { key: Mutator; name: string; icon: string; hint: string }[] = [
  { key: "air", name: "Só aéreo", icon: "flight", hint: "Só dá para construir unidades aéreas (e engenheiros); unidades terrestres e navais ficam bloqueadas." },
  { key: "hp", name: "Vida em dobro", icon: "favorite", hint: "Todas as unidades com o dobro de vida: batalhas mais longas." },
  { key: "res", name: "Renda em dobro", icon: "paid", hint: "Toda massa e energia produzidas valem em dobro." },
  { key: "cdr", name: "Comandantes resistentes", icon: "military_tech", hint: "Comandantes com 3 vezes mais vida." },
];

/** Recorde de um minigame (gravado pelo jogo no perfil dele). */
export interface MinigameRecord { mode: MinigameMode; played: number; wins: number; fastest: number | null; best: number }
/** Uma partida do histórico (o jogo guarda as últimas 40). */
export interface MinigameMatch {
  seq: number; mode: MinigameMode; won: boolean; seconds: number; waves: number; score: number; map: string;
  mutators: string; week: number; events: boolean; players: number; date: number | null;
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- conquistas

export interface Achievement { id: string; name: string; hint: string; icon: string; done: boolean; progress?: [number, number] }

export function achievements(records: MinigameRecord[], history: MinigameMatch[]): Achievement[] {
  const r = (m: MinigameMode) => records.find((x) => x.mode === m);
  const wins = (m: MinigameMode) => r(m)?.wins ?? 0;
  const played = records.reduce((a, x) => a + x.played, 0);
  const allWins = records.reduce((a, x) => a + x.wins, 0);
  const modes = MINIGAMES.filter((m) => m.key).map((m) => m.key);
  const modesWon = modes.filter((m) => wins(m) > 0).length;
  const survival = r("survival")?.best ?? 0;
  const arenaFast = r("arena")?.fastest ?? null;
  const has = (m: MinigameMatch, k: string) => m.mutators.split(",").includes(k);
  const a = (id: string, name: string, hint: string, icon: string, done: boolean, progress?: [number, number]): Achievement => ({ id, name, hint, icon, done, progress });
  return [
    a("first", "Primeira vitória", "Vença qualquer minigame.", "emoji_events", allWins > 0),
    a("all", "Mestre dos modos", "Vença os 10 minigames.", "workspace_premium", modesWon >= modes.length, [modesWon, modes.length]),
    a("defense", "Linha firme", "Vença a Última Linha de Defesa.", "shield", wins("defense") > 0),
    a("wall", "Muralha", "Segure 10 ondas na Sobrevivência Infinita.", "fort", survival >= 10, [Math.min(survival, 10), 10]),
    a("immortal", "Imortal", "Segure 30 ondas na Sobrevivência Infinita.", "all_inclusive", survival >= 30, [Math.min(survival, 30), 30]),
    a("arena", "Relâmpago", "Vença a Arena em menos de 5 minutos.", "bolt", arenaFast !== null && arenaFast < 300),
    a("koth", "Rei da colina", "Vença o Rei da Colina.", "landscape", wins("koth") > 0),
    a("vip", "Guarda-costas", "Vença a Escolta.", "person_pin", wins("vip") > 0),
    a("race", "Magnata", "Vença a Corrida de Recursos.", "trending_up", wins("race") > 0),
    a("treasure", "Caçador de tesouros", "Vença a Caça ao Tesouro.", "redeem", wins("treasure") > 0),
    a("domination", "Dominador", "Vença a Dominação Estratégica.", "flag", wins("domination") > 0),
    a("chaos", "Senhor do caos", "Vença com eventos e os mutadores do CAOS (vida, renda e comandantes).", "cyclone",
      history.some((m) => m.won && m.events && has(m, "hp") && has(m, "res") && has(m, "cdr"))),
    a("air", "Só nos céus", "Vença com o mutador Só aéreo.", "flight", history.some((m) => m.won && has(m, "air"))),
    a("weekly", "Desafiante", "Vença um desafio da semana.", "event_available", history.some((m) => m.won && m.week > 0)),
    a("veteran", "Veterano", "Jogue 25 minigames.", "military_tech", played >= 25, [Math.min(played, 25), 25]),
    a("legend", "Lendário", "Jogue 100 minigames.", "star", played >= 100, [Math.min(played, 100), 100]),
  ];
}

// ---------------------------------------------------------------- desafio da semana

export interface WeeklyChallenge { week: number; mode: MinigameMode; mutators: Mutator[]; events: boolean; seed: number; ends: Date }

/** Semana atual (segunda a domingo, contada desde 1º de janeiro de 2024). */
export function currentWeek(now = new Date()): number {
  const start = Date.UTC(2024, 0, 1);
  return Math.floor((now.getTime() - start) / (7 * 86400000)) + 1;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    s = Math.imul(s ^ (s >>> 13), 3266489909) >>> 0;
    return (s >>> 0) / 4294967296;
  };
}

/** O desafio da semana: o mesmo para todo mundo naquela semana. */
export function weeklyChallenge(week = currentWeek()): WeeklyChallenge {
  const r = rng(week * 7919 + 17);
  const modes = MINIGAMES.filter((m) => m.key).map((m) => m.key);
  const mode = modes[Math.floor(r() * modes.length)];
  const mutators: Mutator[] = [];
  const n = Math.floor(r() * 3);
  const pool: Mutator[] = mode === "arena" ? ["hp", "cdr"] : ["air", "hp", "res", "cdr"];
  for (let i = 0; i < n; i++) {
    const m = pool[Math.floor(r() * pool.length)];
    if (!mutators.includes(m)) mutators.push(m);
  }
  const start = Date.UTC(2024, 0, 1) + week * 7 * 86400000;
  return { week, mode, mutators, events: r() < 0.5, seed: Math.floor(r() * 1e9), ends: new Date(start) };
}

// ---------------------------------------------------------------- prévia dos pontos de controle

/** Onde o jogo vai pôr os pontos de controle (a mesma conta do CPMinigames.lua, sem saber da água). */
export function previewPoints(size: [number, number], starts: [number, number][], teamOf: number[], count: number): [number, number][] {
  const [w, h] = size;
  const m = Math.min(w, h);
  const cx = w / 2, cz = h / 2;
  const spots: [number, number][] = [[cx, cz]];
  for (let ring = 1; ring <= 3; ring++) {
    const r = m * 0.12 * ring;
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + (ring % 2) * (Math.PI / 8);
      spots.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  const teams = new Map<number, [number, number][]>();
  starts.forEach((s, i) => {
    const t = teamOf[i];
    if (t === undefined || t < 0) return;
    teams.set(t, [...(teams.get(t) ?? []), s]);
  });
  const scored: { pos: [number, number]; unfair: number }[] = [];
  for (const c of spots) {
    if (c[0] <= 20 || c[1] <= 20 || c[0] >= w - 20 || c[1] >= h - 20) continue;
    let lo: number | null = null, hi: number | null = null;
    for (const bases of teams.values()) {
      const best = Math.min(...bases.map((b) => Math.hypot(b[0] - c[0], b[1] - c[1])));
      if (lo === null || best < lo) lo = best;
      if (hi === null || best > hi) hi = best;
    }
    if (lo !== null && hi !== null && lo > m * 0.1) scored.push({ pos: c, unfair: hi - lo + Math.hypot(c[0] - cx, c[1] - cz) * 0.05 });
  }
  scored.sort((a, b) => a.unfair - b.unfair);
  const out: [number, number][] = [];
  for (const s of scored) {
    if (out.every((p) => Math.hypot(p[0] - s.pos[0], p[1] - s.pos[1]) >= m * 0.16)) out.push(s.pos);
    if (out.length >= count) break;
  }
  if (!out.length) out.push([cx, cz]);
  return out;
}

/** Pontos de controle de cada modo (0 = sem pontos). */
export function modePoints(mode: string | undefined, chosen?: number): number {
  if (mode === "domination" || mode === "supreme") return chosen || 3;
  if (mode === "total") return chosen || 5;
  if (mode === "koth") return 1;
  return 0;
}
