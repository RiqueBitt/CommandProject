// Recursos do launcher: os mods do próprio CommandProject. Já vêm com o launcher (são montados no
// seu PC com os arquivos do jogo na primeira vez que você liga), não aparecem na aba Mods e só valem
// quando o jogo é aberto pelo launcher. Aqui dá para ligar, desligar, configurar e remontar.
import { useState } from "react";
import { api } from "../lib/api";
import { type Page, useStore } from "../lib/store";
import type { ModView } from "../lib/types";
import { AiModal, FirstPersonModal, loadAi, loadFirstPerson, OptimizeModal } from "./dialogs";
import { hueOf, Icon, Switch } from "./ui";
import { FEATURES } from "../lib/features";
import { t } from "../lib/i18n";

type ModalId = "ai" | "opt" | "fp";
interface Entry {
  /** ids na biblioteca (o primeiro é o atual; os outros, versões antigas do mesmo mod) */
  ids: string[];
  name: string;
  icon: string;
  desc: string;
  tags: string[];
  /** como instala/configura: uma janela de opções ou uma tela do launcher */
  modal?: ModalId;
  page?: Page;
  /** liga e desliga sozinho (não tem chave manual) */
  auto?: string;
  isNew?: boolean;
  /** precisa ser gerado numa tela antes (texturas, tema): o texto explica onde */
  build?: string;
  /** cartão desta mesma tela */
  anchor?: string;
  /** só aparece com o recurso ligado */
  feature?: keyof typeof FEATURES;
}

const ALL_MODS: Entry[] = [
  { ids: ["cp-primeira-pessoa"], name: "Primeira Pessoa", icon: "videocam", modal: "fp", isNew: true, feature: "firstPerson", tags: ["Câmera", "Controle"],
    desc: "Selecione uma unidade e aperte F5: câmera em primeira pessoa presa nela, depois em terceira pessoa; com um grupo, câmera de comando. W A S D andam, botão do meio + mouse olha, F atira, construtores constroem pelo menu normal." },
  { ids: ["cp-ia-esperta"], name: "IA esperta", icon: "psychology", modal: "ai", tags: ["IA", "Escaramuça"],
    desc: "Comandante estratégico para a IA: navios, economia, mini-bases, personalidades e um painel (F4) que mostra o que ela pensa." },
  { ids: ["cp-otimizacao"], name: "Otimização", icon: "speed", modal: "opt", tags: ["Desempenho"],
    desc: "Limite de FPS (até 240, menor nas partidas grandes), placa de vídeo dedicada e ajustes do Windows para o jogo. Não remove nada." },
  { ids: ["cp-partida-grande"], name: "Partida grande", icon: "groups", page: "bigmatch", auto: "Liga sozinho nas partidas grandes e desliga no Jogar comum.", tags: ["Até 64 jogadores"],
    desc: "Escaramuça com quantos jogadores o mapa tiver (12 contra 12 e mais), 32 cores, todas as opções da escaramuça normal." },
  { ids: ["cp-clima"], name: "Climas", icon: "thunderstorm", page: "bigmatch", isNew: true, auto: "Escolha o clima na tela da Partida grande: o mod é montado para o mapa e liga só nessa partida.", tags: ["Chuva", "Tempestade", "Nevasca"],
    desc: "Chuva, tempestade com raios e trovões ou nevasca na partida grande: gotas e flocos caem no mapa (não na tela), o chão fica molhado ou coberto de neve em qualquer mapa, sem perder FPS." },
  { ids: ["texturas-hd"], name: "Remaster HD", icon: "hd", page: "studio", tags: ["Visual"], build: "Gere as texturas no Remaster (uma vez): depois é só ligar e desligar aqui.",
    desc: "Texturas maiores e mais nítidas geradas a partir das do jogo, no tamanho que a memória aguenta." },
  { ids: ["menu-moderno"], name: "Menu moderno", icon: "dashboard_customize", anchor: "menu-theme", tags: ["Visual", "Interface"], build: "Monte o tema no cartão Menu moderno logo abaixo.",
    desc: "Tema novo para os menus do jogo, montado com as imagens do próprio jogo." },
  { ids: ["cp-jogo-ptbr"], name: "Jogo em português (Brasil)", icon: "translate", page: "settings", tags: ["Idioma", "Tradução"],
    auto: "Liga sozinho com o launcher em português (Brasil) e desliga em inglês (Configurações → Idioma).",
    desc: "Tradução de fã dos textos do jogo: menus, unidades, pesquisa, dicas e a campanha inteira. Textos dentro de imagens e dos vídeos continuam como no jogo." },
];

export const CP_MODS: Entry[] = ALL_MODS.filter((e) => !e.feature || FEATURES[e.feature]);

const banner = (name: string) => {
  const h = hueOf(name);
  return `radial-gradient(120% 140% at 20% 10%, hsl(${h} 55% 40%), hsl(${(h + 50) % 360} 45% 13%))`;
};

/** Monta um recurso com as opções salvas (ou as padrão) — sem perguntar nada. */
async function buildDefault(id: ModalId, enable: boolean) {
  if (id === "ai") return api.buildAi(loadAi(), enable);
  if (id === "opt") return api.buildOptimize((await api.optimizeStatus()).options, enable);
  return api.buildFirstPerson(loadFirstPerson(), enable);
}

/** Os recursos do launcher com o estado de cada um no perfil ativo. */
export default function CpModsHub() {
  const mods = useStore((s) => s.mods);
  const busy = useStore((s) => s.busy);
  const { run, refreshMods, go } = useStore.getState();
  const [modal, setModal] = useState<ModalId | null>(null);
  const find = (e: Entry): ModView | undefined => e.ids.map((id) => mods.find((m) => m.manifest.id === id)).find(Boolean);
  const installedOf = (id: ModalId) => { const e = CP_MODS.find((x) => x.modal === id); return !!e && !!find(e); };

  const open = (e: Entry) => {
    if (e.modal) setModal(e.modal);
    else if (e.anchor) document.getElementById(e.anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (e.page) go(e.page);
  };
  const toggle = async (e: Entry, m: ModView | undefined, v: boolean) => {
    const name = t(e.name);
    if (!m) {
      // ainda não montado: monta agora com as opções salvas (vem com o launcher, não precisa instalar)
      if (e.modal) {
        await run("toggle:" + e.ids[0], () => buildDefault(e.modal!, true), t("{name} ligado.", { name }));
        await refreshMods();
      } else open(e);
      return;
    }
    await run("toggle:" + m.manifest.id, () => api.setModEnabled(m.manifest.id, v), v ? t("{name} ligado.", { name }) : t("{name} desligado.", { name }));
    await refreshMods();
  };
  /** remonta os recursos com as opções salvas (depois de atualizar o jogo ou o launcher) */
  const updateAll = async () => {
    const jobs: [string, ModalId][] = [];
    if (installedOf("ai")) jobs.push([t("IA esperta"), "ai"]);
    if (installedOf("opt")) jobs.push([t("Otimização"), "opt"]);
    if (installedOf("fp")) jobs.push([t("Primeira Pessoa"), "fp"]);
    if (!jobs.length) return;
    const done: string[] = [];
    for (const [name, id] of jobs) {
      const on = !!CP_MODS.filter((x) => x.modal === id).map(find).find((m) => m?.enabled);
      const ok = await run("hub:cp", () => buildDefault(id, on));
      if (ok !== undefined) done.push(name);
    }
    await refreshMods();
    if (done.length) useStore.getState().toast("ok", t("Atualizados com os arquivos do seu jogo: {list}.", { list: done.join(", ") }));
  };
  const updatable = (["ai", "opt", "fp"] as ModalId[]).some(installedOf);

  return (
    <section>
      <div className="section-head">
        <Icon name="verified" style={{ color: "var(--primary)" }} />
        <h2>{t("Já vêm com o CommandProject")}</h2>
        <span className="muted small">{t("montados no seu PC com os arquivos do jogo · só valem quando você joga pelo launcher")}</span>
        <span className="grow" />
        {updatable && <button className="btn sm" disabled={!!busy["hub:cp"]} onClick={() => void updateAll()} title={t("Monta de novo com as opções salvas (use depois de atualizar o jogo ou o launcher)")}><Icon name="sync" size={16} /> {busy["hub:cp"] ? t("Atualizando…") : t("Atualizar todos")}</button>}
      </div>
      <div className="store-grid">
        {CP_MODS.map((e) => {
          const m = find(e);
          const on = !!m?.enabled;
          const working = !!busy["toggle:" + (m?.manifest.id ?? e.ids[0])];
          const configurable = !!e.modal || !!e.page || !!e.anchor;
          return (
            <article key={e.ids[0]} className="store-card cp-mod" onClick={() => configurable && open(e)}>
              <div className="banner" style={{ background: banner(e.name) }}>
                <Icon name={e.icon} className="big" />
                <div className="chips">
                  <span className="chip dark">{e.isNew ? <><Icon name="fiber_new" /> {t("Novo")}</> : <><Icon name="verified" /> CommandProject</>}</span>
                  <span className={`chip ${on ? "ok" : "dark"}`}>{on ? t("Ligado") : t("Desligado")}</span>
                </div>
              </div>
              <div className="body">
                <div className="name">{t(e.name)}</div>
                <div className="desc cp-desc">{t(e.desc)}</div>
                <div className="row wrap" style={{ gap: 6 }}>{e.tags.map((tag) => <span key={tag} className="chip">{t(tag)}</span>)}</div>
                {!m && e.build && <p className="small faint">{t(e.build)}</p>}
                <div className="foot" onClick={(ev) => ev.stopPropagation()}>
                  {configurable && (
                    <button className="btn sm" onClick={() => open(e)}>
                      <Icon name={e.modal ? "tune" : e.anchor ? "south" : "open_in_new"} size={16} /> {e.modal ? t("Opções") : t("Abrir")}
                    </button>
                  )}
                  <span className="grow" />
                  {e.auto
                    ? <span className="small faint" title={t(e.auto)}><Icon name="bolt" size={15} /> {t("automático")}</span>
                    : (m || e.modal) && <Switch label={on ? t("Desligar") : t("Ligar")} checked={on} disabled={working} onChange={(v) => void toggle(e, m, v)} />}
                  {!m && !e.modal && !e.auto && <button className="btn sm primary" onClick={() => open(e)}><Icon name="auto_awesome" size={16} /> {t("Gerar")}</button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {modal === "ai" && <AiModal installed={installedOf("ai")} onClose={() => setModal(null)} />}
      {modal === "opt" && <OptimizeModal onClose={() => { setModal(null); void refreshMods(); }} />}
      {modal === "fp" && <FirstPersonModal installed={installedOf("fp")} onClose={() => setModal(null)} />}
    </section>
  );
}
