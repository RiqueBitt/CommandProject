// Quantos jogadores o jogo aguenta numa partida grande. Iguais às contas de crates/cp-core/src/bigmatch.rs.
//
// O SC2 é um programa de 32 bits (até 4 GB de memória) e cada exército guarda dados do tamanho do
// mapa inteiro. Testado num PC de verdade: 32 jogadores em 2048 e 16 em 4096 abrem a partida;
// 24 e 32 em 4096 fecham o jogo logo depois de criar os exércitos, sem relatório de erro (falta de
// memória). O limite é a conta jogadores × (lado do mapa / 1024)², até 256.

/** Exércitos que o motor aceita (máscaras de 32 bits), contando os civis do mapa. */
export const MAX_PLAYERS = 32;
/** jogadores × (lado / 1024)² que ainda cabem na memória do jogo (16 em 4096 = 256). */
export const MEMORY_BUDGET = 256;

/** Máximo de jogadores numa partida num mapa com esse lado. */
export function maxPlayersFor(size: number): number {
  const area = (Math.max(size || 1024, 1024) / 1024) ** 2;
  return Math.max(2, Math.min(MAX_PLAYERS, Math.floor(MEMORY_BUDGET / area + 1e-9)));
}

/** Maior lado (entre os oferecidos) em que `players` jogadores ainda cabem. */
export function largestSizeFor(players: number, sizes: number[]): number | null {
  const ok = sizes.filter((s) => maxPlayersFor(s) >= players);
  return ok.length ? Math.max(...ok) : null;
}

/** `n` bases bem espalhadas: começa na primeira e pega sempre a mais longe das já escolhidas. */
export function spreadBases(starts: [number, number][], n: number): Set<number> {
  const pick = new Set<number>();
  if (!starts.length || n <= 0) return pick;
  pick.add(0);
  const dist = starts.map((p) => Math.hypot(p[0] - starts[0][0], p[1] - starts[0][1]));
  while (pick.size < Math.min(n, starts.length)) {
    let best = -1;
    for (let i = 0; i < starts.length; i++) if (!pick.has(i) && (best < 0 || dist[i] > dist[best])) best = i;
    pick.add(best);
    starts.forEach((p, i) => { dist[i] = Math.min(dist[i], Math.hypot(p[0] - starts[best][0], p[1] - starts[best][1])); });
  }
  return pick;
}
