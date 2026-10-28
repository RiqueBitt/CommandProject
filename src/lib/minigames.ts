// Minigames da Partida grande (CPMinigames.lua, no mod cp-partida-grande): textos e ícones para
// a tela da Partida grande e o Início. As chaves são as de `CPMode` (`cp_core::bigmatch::MODES`).

export type MinigameMode = "" | "total" | "arena" | "defense" | "domination" | "supreme";

export interface MinigameInfo { key: MinigameMode; name: string; icon: string; hint: string; win: string }

export const MINIGAMES: MinigameInfo[] = [
  { key: "", name: "Partida normal", icon: "sports_esports", hint: "A escaramuça de sempre, com o tipo de vitória das regras.", win: "Conforme as regras" },
  { key: "domination", name: "Dominação Estratégica", icon: "flag", hint: "Pontos de controle marcados por setas dão 1 ponto por segundo ao time que os segura (e um pouco de recursos). A IA também disputa os pontos.", win: "O primeiro time a chegar à pontuação-alvo" },
  { key: "arena", name: "Arena dos Experimentais", icon: "smart_toy", hint: "Cada jogador começa com experimentais da sua facção no lugar do comandante. Depois de 3 minutos, a zona segura fecha no centro.", win: "O último que sobrar" },
  { key: "defense", name: "Última Linha de Defesa", icon: "shield", hint: "Tempo para montar a base e depois ondas de inimigos cada vez maiores, com experimentais a cada 5. Entre as ondas chegam suprimentos.", win: "Segurar todas as ondas com o comandante vivo" },
  { key: "total", name: "Guerra Total", icon: "public", hint: "Mais recursos no começo e 5 pontos estratégicos que dão massa, energia e pesquisa a quem os segura. Guerra em várias frentes.", win: "Destruir os comandantes inimigos" },
  { key: "supreme", name: "Projeto Supremo", icon: "science", hint: "A pesquisa vem das eliminações e dos pontos de controle. Cada nível dá um bônus: o caminho na árvore de pesquisa é escolha sua.", win: "Destruir os comandantes inimigos" },
];

export function minigame(key: string | undefined): MinigameInfo {
  return MINIGAMES.find((m) => m.key === (key ?? "")) ?? MINIGAMES[0];
}

/** Recorde de um minigame (gravado pelo jogo no perfil dele). */
export interface MinigameRecord { mode: MinigameMode; played: number; wins: number; fastest: number | null; best: number }
