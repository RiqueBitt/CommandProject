// Cores dos exércitos na Partida grande. Regra padrão: cada jogador com uma cor só dele, mesmo
// dentro do mesmo time (por jogador). Também dá para pintar por time (cada time com uma cor).
// As cores vêm na ordem do jogo (índice 0 a 31); quem recebe primeiro pega as mais diferentes
// entre si (azul, vermelho, verde, amarelo...).

/** As cores de exército na ordem do jogo: as 10 originais e as 22 que a partida grande acrescenta.
 * `name` fica em português (chave): traduza onde mostrar, com t(c.name). Os avisos também ficam em
 * português (este arquivo roda fora do app nos testes): mostre com tr(). */
export const GAME_COLORS: { hex: string; name: string }[] = [
  { hex: "#146fcd", name: "Azul" }, { hex: "#1bdd1b", name: "Verde" }, { hex: "#ff2a2a", name: "Vermelho" }, { hex: "#b061fa", name: "Roxo" },
  { hex: "#a26b25", name: "Bege" }, { hex: "#deddd1", name: "Cinza" }, { hex: "#92b220", name: "Oliva" }, { hex: "#00ffcc", name: "Ciano" },
  { hex: "#ffe600", name: "Amarelo" }, { hex: "#ff8000", name: "Laranja" }, { hex: "#ff5fb0", name: "Rosa" }, { hex: "#b0ff30", name: "Lima" },
  { hex: "#20f0e0", name: "Turquesa" }, { hex: "#7060ff", name: "Anil" }, { hex: "#d0306a", name: "Vinho" }, { hex: "#ffffff", name: "Branco" },
  { hex: "#ffd030", name: "Dourado" }, { hex: "#70d0ff", name: "Celeste" }, { hex: "#ff40ff", name: "Magenta" }, { hex: "#60ffb0", name: "Menta" },
  { hex: "#c08040", name: "Marrom" }, { hex: "#ff8060", name: "Coral" }, { hex: "#c0b0ff", name: "Lavanda" }, { hex: "#404040", name: "Preto" },
  { hex: "#3a5ad8", name: "Marinho" }, { hex: "#2e9e46", name: "Floresta" }, { hex: "#ffc8a0", name: "Pêssego" }, { hex: "#c0581c", name: "Ferrugem" },
  { hex: "#9a4ab0", name: "Ameixa" }, { hex: "#c8b040", name: "Mostarda" }, { hex: "#2a8a9a", name: "Petróleo" }, { hex: "#ffb0d0", name: "Rosa-claro" },
];

/** Ordem em que os times recebem as cores: das mais diferentes para as mais parecidas. */
export const DISTINCT_ORDER = [0, 2, 1, 8, 3, 9, 7, 15, 10, 23, 13, 11, 4, 18, 12, 14, 16, 17, 19, 20, 21, 22, 5, 6, 24, 25, 27, 26, 28, 29, 30, 31];

export type ColorMode = "team" | "player";

export interface ColorSlot { kind: "you" | "ai" | "empty"; team: number; color: number }

/** Grupo de cor de uma vaga: o time, ou a própria vaga para quem joga sozinho. */
export const groupOf = (s: ColorSlot, i: number) => (s.team > 0 ? `t${s.team}` : `s${i}`);

/**
 * Cor de cada vaga. Por jogador (padrão): cada jogador com uma cor diferente, inclusive os do
 * mesmo time; a cor escolhida à mão vale só para aquela vaga e, se outra vaga já tem a mesma, esta
 * vira automática. Com mais jogadores que cores, as que sobram repetem cores (nunca a de um colega
 * de time, se der) e `note` avisa. Por time: cada time (ou jogador sozinho) com uma cor só dele; a
 * cor escolhida numa vaga vale para o time inteiro. `error` quando não há cores para todos os times.
 */
export function assignColors(slots: ColorSlot[], mode: ColorMode): { colors: number[]; error: string | null; note: string | null } {
  const n = GAME_COLORS.length;
  const out: number[] = new Array(slots.length).fill(0);
  const on = slots.map((s, i) => ({ s, i })).filter((x) => x.s.kind !== "empty");
  const perPlayer = mode === "player";
  const groups: string[] = [];
  for (const { s, i } of on) { const g = groupOf(s, i); if (!groups.includes(g)) groups.push(g); }
  if (!perPlayer && groups.length > n) return { colors: out, error: `Há ${groups.length} times e só ${n} cores: junte alguns times.`, note: null };
  const unitOf = (i: number) => (perPlayer ? `p${i}` : groupOf(slots[i], i));
  const units = perPlayer ? on.map(({ i }) => `p${i}`) : groups;

  // cores escolhidas à mão: a primeira vaga de cada unidade que escolheu manda; se outra unidade
  // já pegou aquela cor, esta vira automática
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
  for (const u of units) {
    if (chosen.has(u)) continue;
    while (next < DISTINCT_ORDER.length && used.has(DISTINCT_ORDER[next])) next++;
    if (next >= DISTINCT_ORDER.length) break;
    const c = DISTINCT_ORDER[next++];
    used.set(c, u);
    chosen.set(u, c);
  }
  // mais jogadores que cores: repete a cor menos usada que nenhum colega de time tem
  let note: string | null = null;
  const left = units.filter((u) => !chosen.has(u));
  if (left.length) {
    const count = new Array(n).fill(0);
    for (const c of chosen.values()) count[c]++;
    const teamOfUnit = (u: string) => { const i = Number(u.slice(1)); return slots[i].team; };
    for (const u of left) {
      const team = teamOfUnit(u);
      const mates = new Set(on.filter(({ i }) => team > 0 && slots[i].team === team && chosen.has(`p${i}`)).map(({ i }) => chosen.get(`p${i}`)!));
      let best = DISTINCT_ORDER[0], bestScore = Infinity;
      for (const c of DISTINCT_ORDER) {
        const score = count[c] + (mates.has(c) ? 1000 : 0);
        if (score < bestScore) { bestScore = score; best = c; }
      }
      chosen.set(u, best);
      count[best]++;
    }
    note = `Há ${units.length} jogadores e ${n} cores: ${left.length} jogador(es) repetem a cor de alguém de outro time.`;
  }
  for (const { i } of on) out[i] = chosen.get(unitOf(i)) ?? 0;
  return { colors: out, error: null, note };
}
