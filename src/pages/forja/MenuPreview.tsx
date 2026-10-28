// Prévia da tela inicial do jogo com o que os mods da Forja mudam: botões novos na coluna principal
// e no submenu Extras, nomes trocados e botões escondidos. Segue as mesmas regras da montagem
// (crates/cp-core/src/mainmenu.rs): botões dos mods antes de Sair, no máximo 8 na coluna e 7 no
// Extras, o que não cabe vai para o outro lugar.
import { useState } from "react";
import { t } from "../../lib/i18n";
import type { ForjaMod, ForjaStatus } from "../../lib/types";
import { Icon } from "../../components/ui";

const MAIN = [
  ["campaign", "CAMPANHA"],
  ["skirmish", "BATALHA"],
  ["multiplayer", "MULTIJOGADOR"],
  ["options", "OPÇÕES"],
  ["extras", "EXTRAS"],
  ["quit", "SAIR"],
] as const;
const EXTRAS = [["replays", "REPLAYS"], ["credits", "CRÉDITOS"]] as const;
const MAX_MAIN = 8;
const MAX_EXTRAS = 7;

/** Ações do jogo que um botão pode chamar (mainmenu::NATIVE). */
export const NATIVE_LABEL: Record<string, string> = {
  campaign: "Menu da campanha", continue: "Continuar o último jogo salvo", tutorial: "Tutorial", loadCampaign: "Carregar campanha salva",
  skirmish: "Batalha", loadSkirmish: "Carregar batalha salva", lan: "Partida em rede local (LAN)", hostGame: "Hospedar partida",
  publicGame: "Entrar em partida", privateGame: "Partida privada", quickMatch: "Partida rápida", leaderboards: "Classificação",
  chat: "Chat da Steam", options: "Opções", replays: "Replays", credits: "Créditos", exit: "Sair do jogo",
};

interface Row { key: string; label: string; mod?: string; what?: string }

function layout(mods: ForjaMod[]) {
  const rename: Record<string, string> = {};
  const hide = new Set<string>();
  const buttons: (Row & { place: "main" | "extras" })[] = [];
  for (const m of mods) {
    const menu = m.menu;
    if (!menu) continue;
    for (const b of menu.buttons ?? []) {
      const what = b.native ? t(NATIVE_LABEL[b.native] ?? b.native) : b.url ? b.url.replace(/^https?:\/\//, "") : b.message ? t("mensagem") : t("código do mod");
      buttons.push({ key: `${m.id}:${b.id}`, label: b.label, mod: m.name, what, place: b.where ?? "extras" });
    }
    Object.assign(rename, menu.rename ?? {});
    for (const h of menu.hide ?? []) if (h !== "quit") hide.add(h);
  }
  const stockMain = MAIN.filter(([k]) => !hide.has(k));
  const stockExtras = EXTRAS.filter(([k]) => !hide.has(k));
  const extrasOpen = !hide.has("extras");
  const toMain: Row[] = [];
  const toExtras: Row[] = [];
  const left: Row[] = [];
  for (const b of buttons) {
    const wantMain = b.place === "main" || !extrasOpen;
    const mainFree = stockMain.length + toMain.length < MAX_MAIN;
    const extrasFree = extrasOpen && stockExtras.length + toExtras.length < MAX_EXTRAS;
    if (wantMain && mainFree) toMain.push(b);
    else if (!wantMain && extrasFree) toExtras.push(b);
    else if (mainFree) toMain.push(b);
    else if (extrasFree) toExtras.push(b);
    else left.push(b);
  }
  const stockRow = ([k, l]: readonly [string, string]): Row => ({ key: k, label: rename[k] ?? t(l) });
  const main: Row[] = [...stockMain.filter(([k]) => k !== "quit").map(stockRow), ...toMain, stockRow(MAIN[5])];
  const extras: Row[] = extrasOpen ? [...stockExtras.map(stockRow), ...toExtras] : [];
  return { main, extras, extrasOpen, left, hidden: [...hide] };
}

export default function MenuPreview({ mods, built }: { mods: ForjaMod[]; built: ForjaStatus | null }) {
  const withMenu = mods.filter((m) => m.menu && ((m.menu.buttons?.length ?? 0) > 0 || Object.keys(m.menu.rename ?? {}).length > 0 || (m.menu.hide?.length ?? 0) > 0));
  const view = layout(withMenu);
  const [open, setOpen] = useState(true);
  if (withMenu.length === 0) return null;
  const inGame = new Set((built?.menu ?? []).map((m) => m.key));
  const tight = view.main.length > 6;
  return (
    <section className="card pad col">
      <div className="card-title">
        <Icon name="home" /><h3>{t("Tela inicial do jogo")}</h3>
        <span className="grow" />
        <span className="small muted">{t("{n} mod(s) mexem nela", { n: withMenu.length })}</span>
        <button className="btn sm text" onClick={() => setOpen(!open)} aria-expanded={open}><Icon name={open ? "expand_less" : "expand_more"} /></button>
      </div>
      {open && (
        <div className="menu-preview-wrap">
          <div className="menu-preview" role="img" aria-label={t("Prévia da tela inicial com os botões dos mods")}>
            <div className="mp-logo">SUPREME<br /><b>COMMANDER 2</b></div>
            <div className="mp-band" />
            <div className={`mp-col ${tight ? "tight" : ""}`}>
              {view.main.map((r) => (
                <div key={r.key} className={`mp-btn ${r.mod ? "mod" : ""} ${r.key === "extras" ? "active" : ""}`} title={r.mod ? `${r.mod} · ${r.what}` : undefined}>
                  {r.label}{r.key === "extras" && view.extrasOpen && <Icon name="chevron_right" size={14} />}
                </div>
              ))}
            </div>
            {view.extrasOpen && (
              <div className="mp-sub">
                {view.extras.map((r) => (
                  <div key={r.key} className={`mp-btn small ${r.mod ? "mod" : ""}`} title={r.mod ? `${r.mod} · ${r.what}` : undefined}>{r.label}</div>
                ))}
              </div>
            )}
          </div>
          <div className="col menu-preview-legend">
            <p className="muted small">{t("Os botões em destaque vêm dos mods. A tela é montada quando você aplica o perfil ou joga, com a cena da interface do próprio jogo.")}</p>
            <ul className="mp-list">
              {[...view.main, ...view.extras].filter((r) => r.mod).map((r) => (
                <li key={r.key}>
                  <b>{r.label}</b> <span className="faint small">{r.mod}</span>
                  <span className="small muted"> · {r.what}</span>
                  {built && !inGame.has(r.key) && <span className="chip warn small">{t("aplique para ver no jogo")}</span>}
                </li>
              ))}
            </ul>
            {view.hidden.length > 0 && <p className="small muted"><Icon name="visibility_off" size={14} /> {t("Escondidos: {list}", { list: view.hidden.join(", ") })}</p>}
            {view.left.length > 0 && <p className="small warn-text">⚠ {t("Não couberam: {list}", { list: view.left.map((r) => r.label).join(", ") })}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
