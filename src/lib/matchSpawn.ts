// Posições iniciais na Partida grande: fixas (como na prévia) ou sorteadas na hora de jogar.
// "team": cada time troca de base só entre as bases dele (o lado do mapa continua o mesmo);
// "all": todo mundo sorteado entre todas as bases (times podem acabar misturados no mapa).

export type SpawnMode = "fixed" | "team" | "all";

interface Spot { kind: string; team: number }

/** Embaralha (Fisher–Yates) com a função de sorteio dada (0 ≤ r() < 1). */
function shuffle<T>(list: T[], r: () => number): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Nova ordem das vagas: a vaga `i` do resultado vai para a base `i`. No modo "team" o conteúdo só
 * troca entre bases do mesmo time (e quem joga sozinho só troca com quem também joga sozinho).
 */
export function shuffleSpawns<S extends Spot>(slots: S[], mode: SpawnMode, r: () => number = Math.random): S[] {
  if (mode === "fixed") return slots.slice();
  if (mode === "all") return shuffle(slots, r);
  const out = slots.slice();
  const groups = new Map<number, number[]>();
  slots.forEach((s, i) => groups.set(s.team, [...(groups.get(s.team) ?? []), i]));
  for (const idx of groups.values()) {
    const moved = shuffle(idx.map((i) => slots[i]), r);
    idx.forEach((pos, k) => { out[pos] = moved[k]; });
  }
  return out;
}
