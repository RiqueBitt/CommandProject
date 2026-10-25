// Cores dos exércitos na Partida grande. Regra: dois times nunca têm a mesma cor (e quem joga
// sozinho também tem uma cor só dele). As cores vêm na ordem do jogo (índice 0 a 23); os times
// pegam primeiro as mais diferentes entre si (azul, vermelho, verde, amarelo...).

/** As cores de exército na ordem do jogo: as 10 originais e as 14 que a partida grande acrescenta. */
export const GAME_COLORS: { hex: string; name: string }[] = [
  { hex: "#146fcd", name: "Azul" }, { hex: "#1bdd1b", name: "Verde" }, { hex: "#ff2a2a", name: "Vermelho" }, { hex: "#b061fa", name: "Roxo" },
  { hex: "#a26b25", name: "Bege" }, { hex: "#deddd1", name: "Cinza" }, { hex: "#92b220", name: "Oliva" }, { hex: "#00ffcc", name: "Ciano" },
  { hex: "#ffe600", name: "Amarelo" }, { hex: "#ff8000", name: "Laranja" }, { hex: "#ff5fb0", name: "Rosa" }, { hex: "#b0ff30", name: "Lima" },
  { hex: "#20f0e0", name: "Turquesa" }, { hex: "#7060ff", name: "Anil" }, { hex: "#d0306a", name: "Vinho" }, { hex: "#ffffff", name: "Branco" },
  { hex: "#ffd030", name: "Dourado" }, { hex: "#70d0ff", name: "Celeste" }, { hex: "#ff40ff", name: "Magenta" }, { hex: "#60ffb0", name: "Menta" },
  { hex: "#c08040", name: "Marrom" }, { hex: "#ff8060", name: "Coral" }, { hex: "#c0b0ff", name: "Lavanda" }, { hex: "#404040", name: "Preto" },
];

/** Ordem em que os times recebem as cores: das mais diferentes para as mais parecidas. */
export const DISTINCT_ORDER = [0, 2, 1, 8, 3, 9, 7, 15, 10, 23, 13, 11, 4, 18, 12, 14, 16, 17, 19, 20, 21, 22, 5, 6];

export type ColorMode = "team" | "player";

export interface ColorSlot { kind: "you" | "ai" | "empty"; team: number; color: number }

/** Grupo de cor de uma vaga: o time, ou a própria vaga para quem joga sozinho. */
export const groupOf = (s: ColorSlot, i: number) => (s.team > 0 ? `t${s.team}` : `s${i}`);

/**
 * Cor de cada vaga. Por time: cada time (ou jogador sozinho) com uma cor só dele; a cor escolhida
 * à mão numa vaga vale para o time inteiro. Por jogador: cada um com uma cor, e nenhuma cor
 * aparece em dois times. `error` quando não há cores para todos.
 */
export function assignColors(slots: ColorSlot[], mode: ColorMode): { colors: number[]; error: string | null } {
  const n = GAME_COLORS.length;
  const out: number[] = new Array(slots.length).fill(0);
  const on = slots.map((s, i) => ({ s, i })).filter((x) => x.s.kind !== "empty");
  const groups: string[] = [];
  for (const { s, i } of on) { const g = groupOf(s, i); if (!groups.includes(g)) groups.push(g); }
  const players = on.length;
  // por jogador só dá com até 24 jogadores; com mais, a cor fica por time
  const perPlayer = mode === "player" && players <= n;
  const units = perPlayer ? on.map(({ i }) => `p${i}`) : groups;
  if (units.length > n) return { colors: out, error: `Há ${units.length} times e só ${n} cores: junte alguns times.` };
  const unitOf = (i: number) => (perPlayer ? `p${i}` : groupOf(slots[i], i));

  // cores escolhidas à mão: a primeira vaga de cada grupo que escolheu manda; se outro grupo já
  // pegou aquela cor, esta vira automática
  const used = new Map<number, string>();
  const chosen = new Map<string, number>();
  for (const { s, i } of on) {
    if (s.color < 0) continue;
    const u = unitOf(i), c = s.color % n;
    if (chosen.has(u)) continue;
    if (used.has(c) && used.get(c) !== u) continue;
    chosen.set(u, c);
    used.set(c, u);
  }
  let next = 0;
  const take = (u: string) => {
    while (next < DISTINCT_ORDER.length && used.has(DISTINCT_ORDER[next])) next++;
    const c = DISTINCT_ORDER[next] ?? 0;
    used.set(c, u);
    next++;
    return c;
  };
  for (const u of units) if (!chosen.has(u)) chosen.set(u, take(u));
  for (const { i } of on) out[i] = chosen.get(unitOf(i)) ?? 0;
  return { colors: out, error: null };
}
