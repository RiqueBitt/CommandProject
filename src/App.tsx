import { Fragment, lazy, Suspense, useEffect, useRef } from "react";
import { locale, setLang, t, tr, useLang } from "./lib/i18n";
import { FP_VERSION, loadFirstPerson } from "./components/dialogs";
import { FEATURES } from "./lib/features";
import { CommandPalette, Rail, SystemBar } from "./components/Shell";
import { Toasts } from "./components/ui";
import { api, onEvent } from "./lib/api";
import { errorText, useStore } from "./lib/store";
import { useTabs } from "./lib/tabs";
import type { GameCrash } from "./lib/types";
import { useGameArt } from "./lib/gameArt";
import Home from "./pages/Home";

// só a tela inicial vem junto: as outras páginas baixam quando abrem (o launcher abre mais rápido)
const Hub = lazy(() => import("./pages/Hub"));
const Files = lazy(() => import("./pages/Files"));
const Library = lazy(() => import("./pages/Library"));
const Me = lazy(() => import("./pages/Me"));
const Multiplayer = lazy(() => import("./pages/Multiplayer"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const NewsModal = lazy(() => import("./components/NewsModal"));

// o Estúdio carrega three.js e o editor de código: só baixa quando abrir
const Studio = lazy(() => import("./pages/studio/Studio"));
const Create = lazy(() => import("./pages/create/Create"));
const ProjectHost = lazy(() => import("./pages/create/ProjectHost"));
const Performance = lazy(() => import("./pages/Performance"));
const Icons = lazy(() => import("./pages/Icons"));
const BigMatch = lazy(() => import("./pages/BigMatch"));
const Forja = lazy(() => import("./pages/Forja"));
const Features = lazy(() => import("./pages/Features"));

export default function App() {
  const page = useStore((s) => s.page);
  const lang = useLang((s) => s.lang);
  const refresh = useStore((s) => s.refresh);
  const activeTab = useTabs((s) => s.active);
  const hasTabs = useTabs((s) => s.tabs.length > 0);
  const toast = useStore((s) => s.toast);
  const prefs = useStore((s) => s.settings?.uiPrefs);
  const skin = (prefs?.skin as string | undefined) ?? "sc";
  const fac = (prefs?.faction as string | undefined) ?? "uef";
  const root = useRef<HTMLDivElement>(null);
  const hasGame = useStore((s) => !!s.dashboard?.game);
  // arte dos menus do jogo (da instalação do usuário), se ligada e com o jogo encontrado
  useGameArt(root, prefs?.gameArt !== false && hasGame);

  useEffect(() => {
    (async () => {
      try {
        const recovered = await api.recover();
        if (recovered) toast("info", t("Uma operação interrompida foi resolvida: {detail}", { detail: tr(recovered) }));
        // mods só pelo launcher: o que ficou na pasta do jogo (launcher fechado no meio) sai agora
        void api.ensureVanilla().then((cleaned) => { if (cleaned) { toast("info", t("A pasta do jogo voltou ao original: os mods só entram quando você joga pelo launcher.")); void refresh(); } }).catch(() => {});
        const info = await api.appInfo();
        useStore.setState({ info });
        await refresh();
        // o idioma salvo nas configurações vale mais que o do navegador (é ele que liga o jogo em português)
        const saved = useStore.getState().settings?.uiPrefs?.lang;
        if (saved === "en" || saved === "pt-BR") setLang(saved);
        // o Menu moderno 1.x trocava a fonte de um jeito que fazia o jogo fechar ao abrir
        const oldTheme = useStore.getState().mods.find((m) => m.manifest.id === "menu-moderno" && m.enabled && m.manifest.version.startsWith("1."));
        if (oldTheme) {
          await api.setModEnabled(oldTheme.manifest.id, false).catch(() => {});
          await refresh();
          toast("info", t("Desliguei o Menu moderno antigo, que fazia o jogo fechar ao abrir. Gere de novo na Biblioteca para usar a versão corrigida."));
        }
        // Primeira Pessoa: desligada por enquanto (FEATURES.firstPerson); com ela ligada, a cópia montada
        // por um launcher antigo é montada de novo com as opções salvas
        const fp = (await api.listMods()).find((m) => m.manifest.id === "cp-primeira-pessoa");
        if (fp && !FEATURES.firstPerson) {
          if (fp.enabled) {
            await api.setModEnabled(fp.manifest.id, false).catch(() => {});
            await refresh();
          }
        } else if (fp && fp.manifest.version !== FP_VERSION) {
          try {
            await api.buildFirstPerson(loadFirstPerson(), fp.enabled);
            await refresh();
            toast("info", t("Primeira Pessoa atualizada para a versão {version}.", { version: FP_VERSION }));
          } catch (e) {
            toast("error", t("Não deu para atualizar a Primeira Pessoa: {error}. Abra o Hub de mods e clique em Atualizar.", { error: errorText(e) }));
          }
        }
        // cópia de segurança automática dos projetos (local, de tempos em tempos)
        void api.backupAuto().then((b) => { if (b) toast("info", t("Cópia de segurança automática dos projetos feita ({n} projeto(s)).", { n: b.projects })); }).catch(() => {});
        if (useStore.getState().settings?.checkAppUpdates && !useStore.getState().settings?.offline) {
          // em segundo plano: sem internet ou GitHub lento não atrasa a abertura
          void api.appUpdateCheck().then((up) => {
            if (!up) return;
            useStore.setState({ appUpdate: up });
            toast("info", t('CommandProject {version} disponível. Em Configurações → Atualizações é só clicar em "Atualizar agora".', { version: up.version }));
          }).catch(() => {});
        }
      } catch (e) {
        toast("error", errorText(e));
      }
    })();
    const offs = [
      onEvent<string | null>("cp://game-exited", (e) => {
        if (e) toast("error", t("O jogo fechou, mas não deu para restaurar os arquivos: {error}", { error: tr(e) }));
        else toast("ok", t("Jogo fechado. A pasta do jogo voltou ao original."));
        void refresh();
      }),
      onEvent("cp://game-started", () => toast("info", t("Jogo aberto. Os arquivos serão restaurados quando ele fechar."))),
      onEvent<GameCrash>("cp://game-crashed", (c) => {
        useStore.setState({ crash: c });
        toast("error", c.log ? t("O jogo fechou no meio da partida grande. Veja na tela da partida o que o log do jogo diz.") : t("O jogo fechou com erro. Veja na tela inicial o que pode ter causado."));
      }),
      onEvent<number>("cp://memory-limited", (mb) => toast("ok", t("Memória do jogo limitada a {size} GB.", { size: (mb / 1024).toLocaleString(locale()) }))),
      onEvent<string>("cp://priority-set", (p) => toast("ok", t("Prioridade do jogo: {level}.", { level: p === "high" ? t("alta") : t("acima do normal") }))),
      onEvent<string>("cp://priority-failed", (e) => toast("error", t("Não deu para mudar a prioridade do jogo: {error}", { error: tr(e) }))),
      onEvent<string>("cp://memory-limit-failed", (e) => toast("error", t("Não deu para aplicar o limite de memória: {error}. O jogo está usando até 4 GB.", { error: tr(e) }))),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [refresh, toast]);

  return (
    <div ref={root} className={`app ${activeTab ? "in-project" : ""}`} data-skin={skin} data-fac={fac} data-motion={prefs?.reduceMotion ? "off" : "on"}>
      {/* trocar o idioma remonta a interface: tudo que usa t() muda na hora */}
      <Fragment key={lang}>
      <SystemBar />
      {hasTabs && (
        <div className="project-area" hidden={!activeTab}>
          <Suspense fallback={<div className="page muted">{t("Abrindo…")}</div>}><ProjectHost /></Suspense>
        </div>
      )}
      <Rail />
      <main className="main">
        <Suspense fallback={<div className="page"><div className="bar indeterminate"><i /></div></div>}>
        {page === "me" && <Me />}
        {page === "home" && <Home />}
        {page === "library" && <Library />}
        {page === "hub" && <Hub />}
        {page === "features" && <Features />}
        {page === "multiplayer" && <Multiplayer />}
        {page === "studio" && (
          <Suspense fallback={<div className="page muted">{t("Carregando o Estúdio…")}</div>}>
            <Studio />
          </Suspense>
        )}
        {page === "create" && (
          <Suspense fallback={<div className="page muted">{t("Carregando…")}</div>}>
            <Create />
          </Suspense>
        )}
        {page === "performance" && (
          <div className="scroll">
            <Suspense fallback={<div className="page muted">{t("Carregando…")}</div>}>
              <Performance />
            </Suspense>
          </div>
        )}
        {page === "forja" && (
          <div className="scroll">
            <Suspense fallback={<div className="page muted">{t("Carregando…")}</div>}>
              <Forja />
            </Suspense>
          </div>
        )}
        {page === "bigmatch" && (
          <div className="scroll">
            <Suspense fallback={<div className="page muted">{t("Carregando…")}</div>}>
              <BigMatch />
            </Suspense>
          </div>
        )}
        {page === "settings" && <SettingsPage />}
        {page === "files" && <div className="scroll"><Files /></div>}
        {page === "icons" && (
          <Suspense fallback={<div className="page muted">{t("Carregando…")}</div>}>
            <Icons />
          </Suspense>
        )}
        </Suspense>
      </main>
      <CommandPalette />
      <Suspense fallback={null}><NewsModal /></Suspense>
      <Toasts />
      </Fragment>
    </div>
  );
}
