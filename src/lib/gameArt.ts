// Arte dos menus do próprio jogo no launcher: texturas do menu principal lidas da instalação do
// usuário (nada é distribuído com o launcher) e postas em variáveis CSS (--art-*). Sem o jogo, ou se
// alguma não existir, o launcher fica com o visual próprio dele (as variáveis ficam vazias).
import { useEffect } from "react";
import { api } from "./api";

const FRONTEND = "/textures/ui/common/pc/frontend/";

/** variável CSS → textura do menu e o tamanho máximo pedido */
const ART: [string, string, number][] = [
  ["--art-overlay", "blue_overlay.dds", 1024],
  ["--art-grad", "top_blue_grad.dds", 512],
  ["--art-line", "line03.dds", 512],
  ["--art-logo", "mainmenu/sc_logo.dds", 512],
  ["--art-btn", "mainmenu/btn_u.dds", 512],
  ["--art-btn-hover", "mainmenu/btn_o.dds", 512],
  ["--art-plate", "mainmenu/gamertag_bg.dds", 512],
];

let loading: Promise<Record<string, string>> | null = null;

function load(): Promise<Record<string, string>> {
  loading ??= Promise.all(
    ART.map(([name, file, max]) => api.gameTexture(FRONTEND + file, max).then((url) => [name, url] as const).catch(() => null)),
  ).then((list) => Object.fromEntries(list.filter((x): x is readonly [string, string] => !!x)));
  return loading;
}

/** Liga a arte do jogo no elemento (a raiz do app) quando `on`; desliga e limpa quando não. */
export function useGameArt(root: React.RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!on) {
      el.removeAttribute("data-art");
      for (const [name] of ART) el.style.removeProperty(name);
      return;
    }
    let alive = true;
    void load().then((art) => {
      if (!alive || !Object.keys(art).length) return;
      for (const [name, url] of Object.entries(art)) el.style.setProperty(name, `url("${url}")`);
      el.setAttribute("data-art", Object.keys(art).map((k) => k.slice(6)).join(" "));
    });
    return () => { alive = false; };
  }, [root, on]);
}

/** Lê a arte de novo (depois de trocar a pasta do jogo). */
export function reloadGameArt() {
  loading = null;
}
