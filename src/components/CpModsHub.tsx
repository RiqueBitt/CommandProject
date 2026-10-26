// Hub de Mods integrado: os mods do CommandProject, montados no seu PC a partir dos arquivos do
// próprio jogo (nada é baixado de servidor). Ver, instalar, configurar, ligar, desligar, remover e
// atualizar todos de uma vez, sem mexer nos arquivos do jogo à mão.
import { useState } from "react";
import { api, confirmDialog } from "../lib/api";
import { type Page, useStore } from "../lib/store";
import type { ModView } from "../lib/types";
import { AiModal, CheatsModal, FirstPersonModal, loadAi, loadCheats, loadFirstPerson, OptimizeModal } from "./dialogs";
import { hueOf, Icon, Switch } from "./ui";
import { FEATURES } from "../lib/features";
import { t } from "../lib/i18n";

type ModalId = "ai" | "cheats" | "opt" | "fp";
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
  /** só aparece com o recurso ligado */
  feature?: keyof typeof FEATURES;
}

const ALL_MODS: Entry[] = [
  { ids: ["cp-primeira-pessoa"], name: "Primeira Pessoa", icon: "videocam", modal: "fp", isNew: true, feature: "firstPerson", tags: ["Câmera", "Controle"],
    desc: "Selecione uma unidade e aperte F5: câmera em primeira pessoa presa nela, depois em terceira pessoa; com um grupo, câmera de comando. W A S D andam, botão do meio + mouse olha, F atira, construtores constroem pelo menu normal." },
  { ids: ["cp-ia-esperta"], name: "IA esperta", icon: "psychology", modal: "ai", tags: ["IA", "Escaramuça"],
    desc: "Comandante estratégico para a IA: navios, economia, mini-bases, personalidades e um painel (F4) que mostra o que ela pensa." },
  { ids: ["cp-trapacas", "cp-trapacas-menu"], name: "Trapaças", icon: "auto_fix_high", modal: "cheats", tags: ["Jogar sozinho"],
    desc: "Massa, energia e pesquisa infinitas, modo deus e construção rápida, com um menu na partida (F3) para ligar e desligar cada uma." },
  { ids: ["cp-otimizacao"], name: "Otimização", icon: "speed", modal: "opt", tags: ["Desempenho"],
    desc: "Limite de FPS (até 240, menor nas partidas grandes), placa de vídeo dedicada e ajustes do Windows para o jogo. Não remove nada." },
  { ids: ["cp-partida-grande"], name: "Partida grande", icon: "groups", page: "bigmatch", auto: "Liga sozinho nas partidas grandes e desliga no Jogar comum.", tags: ["Até 64 jogadores"],
    desc: "Escaramuça com quantos jogadores o mapa tiver (12 contra 12 e mais), 32 cores, todas as opções da escaramuça normal." },
  { ids: ["texturas-hd"], name: "Texturas HD", icon: "hd", page: "studio", tags: ["Visual"],
    desc: "Texturas maiores e mais nítidas geradas a partir das do jogo, no tamanho que a memória aguenta." },
  { ids: ["menu-moderno"], name: "Menu moderno", icon: "dashboard_customize", page: "library", tags: ["Visual", "Interface"],
    desc: "Tema novo para os menus do jogo, montado com as imagens do próprio jogo." },
];

export const CP_MODS: Entry[] = ALL_MODS.filter((e) => !e.feature || FEATURES[e.feature]);

const banner = (name: string) => {
  const h = hueOf(name);
  return `radial-gradient(120% 140% at 20% 10%, hsl(${h} 55% 40%), hsl(${(h + 50) % 360} 45% 13%))`;
};

/** Os mods do CommandProject com o estado de cada um no perfil ativo. */
export default function CpModsHub() {
  const mods = useStore((s) => s.mods);
  const busy = useStore((s) => s.busy);
  const { run, refreshMods, go } = useStore.getState();
  const [modal, setModal] = useState<ModalId | null>(null);
  const find = (e: Entry): ModView | undefined => e.ids.map((id) => mods.find((m) => m.manifest.id === id)).find(Boolean);
  const installedOf = (id: ModalId) => { const e = CP_MODS.find((x) => x.modal === id); return !!e && !!find(e); };

  const open = (e: Entry) => {
    if (e.modal) setModal(e.modal);
    else if (e.page) go(e.page);
  };
  const toggle = async (m: ModView, v: boolean) => {
    await run("toggle:" + m.manifest.id, () => api.setModEnabled(m.manifest.id, v), v ? t("{name} ligado.", { name: m.manifest.name }) : t("{name} desligado.", { name: m.manifest.name }));
    await refreshMods();
  };
  const remove = async (m: ModView) => {
    if (!(await confirmDialog(t("Remover {name} da biblioteca? Dá para instalar de novo pelo hub quando quiser.", { name: m.manifest.name }), t("Remover")))) return;
    await run("remove", () => api.removeMod(m.manifest.id), t("{name} removido.", { name: m.manifest.name }));
    await refreshMods();
  };
  /** remonta os mods instalados com as opções salvas (depois de atualizar o jogo ou o launcher) */
  const updateAll = async () => {
    const jobs: [string, () => Promise<unknown>][] = [];
    const has = (id: ModalId) => installedOf(id);
    if (has("ai")) jobs.push([t("IA esperta"), () => api.buildAi(loadAi(), true)]);
    if (has("cheats")) jobs.push([t("Trapaças"), () => api.buildCheats(loadCheats(), true)]);
    if (has("opt")) jobs.push([t("Otimização"), async () => api.buildOptimize((await api.optimizeStatus()).options, true)]);
    if (has("fp")) jobs.push([t("Primeira Pessoa"), () => api.buildFirstPerson(loadFirstPerson(), true)]);
    if (!jobs.length) return;
    const done: string[] = [];
    for (const [name, job] of jobs) {
      const ok = await run("hub:cp", job);
      if (ok !== undefined) done.push(name);
    }
    await refreshMods();
    if (done.length) useStore.getState().toast("ok", t("Atualizados com os arquivos do seu jogo: {list}.", { list: done.join(", ") }));
  };
  const updatable = (["ai", "cheats", "opt", "fp"] as ModalId[]).some(installedOf);

  return (
    <section>
      <div className="section-head">
        <Icon name="verified" style={{ color: "var(--primary)" }} />
        <h2>{t("Mods do CommandProject")}</h2>
        <span className="muted small">{t("montados no seu PC com os arquivos do jogo · nada é baixado da internet")}</span>
        <span className="grow" />
        {updatable && <button className="btn sm" disabled={!!busy["hub:cp"]} onClick={() => void updateAll()} title={t("Monta de novo os mods instalados com as opções salvas (use depois de atualizar o jogo ou o launcher)")}><Icon name="sync" size={16} /> {busy["hub:cp"] ? t("Atualizando…") : t("Atualizar todos")}</button>}
      </div>
      <div className="store-grid">
        {CP_MODS.map((e) => {
          const m = find(e);
          const on = !!m?.enabled;
          return (
            <article key={e.ids[0]} className="store-card cp-mod" onClick={() => open(e)}>
              <div className="banner" style={{ background: banner(e.name) }}>
                <Icon name={e.icon} className="big" />
                <div className="chips">
                  <span className="chip dark">{e.isNew ? <><Icon name="fiber_new" /> {t("Novo")}</> : <><Icon name="verified" /> CommandProject</>}</span>
                  {m && <span className={`chip ${on ? "ok" : "dark"}`}>{on ? t("Ativo") : t("Desligado")}{m.manifest.version ? ` · ${m.manifest.version}` : ""}</span>}
                </div>
              </div>
              <div className="body">
                <div className="name">{t(e.name)}</div>
                <div className="desc cp-desc">{t(e.desc)}</div>
                <div className="row wrap" style={{ gap: 6 }}>{e.tags.map((tag) => <span key={tag} className="chip">{t(tag)}</span>)}</div>
                <div className="foot" onClick={(ev) => ev.stopPropagation()}>
                  <button className={`btn sm ${m ? "" : "primary"}`} onClick={() => open(e)}>
                    <Icon name={m ? "tune" : e.page ? "open_in_new" : "download"} size={16} /> {m ? t("Configurar") : e.page ? t("Abrir") : t("Instalar")}
                  </button>
                  <span className="grow" />
                  {m && !e.auto && <Switch label={on ? t("Desligar") : t("Ligar")} checked={on} onChange={(v) => void toggle(m, v)} />}
                  {m && e.auto && <span className="small faint" title={t(e.auto)}><Icon name="bolt" size={15} /> {t("automático")}</span>}
                  {m && <button className="btn icon-btn sm" title={t("Remover da biblioteca")} aria-label={t("Remover {name}", { name: t(e.name) })} onClick={() => void remove(m)}><Icon name="delete" size={16} /></button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {modal === "ai" && <AiModal installed={installedOf("ai")} onClose={() => setModal(null)} />}
      {modal === "cheats" && <CheatsModal installed={installedOf("cheats")} onClose={() => setModal(null)} />}
      {modal === "opt" && <OptimizeModal onClose={() => { setModal(null); void refreshMods(); }} />}
      {modal === "fp" && <FirstPersonModal installed={installedOf("fp")} onClose={() => setModal(null)} />}
    </section>
  );
}
