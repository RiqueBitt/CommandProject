import { lazy, Suspense, useEffect } from "react";
import { FP_VERSION, loadFirstPerson } from "./components/dialogs";
import { CommandPalette, Rail, SystemBar } from "./components/Shell";
import { Toasts } from "./components/ui";
import { api, onEvent } from "./lib/api";
import { errorText, useStore } from "./lib/store";
import { useTabs } from "./lib/tabs";
import Home from "./pages/Home";
import Hub from "./pages/Hub";
import Files from "./pages/Files";
import Library from "./pages/Library";
import Me from "./pages/Me";
import Multiplayer from "./pages/Multiplayer";
import SettingsPage from "./pages/Settings";

// o Estúdio carrega three.js e o editor de código: só baixa quando abrir
const Studio = lazy(() => import("./pages/studio/Studio"));
const Create = lazy(() => import("./pages/create/Create"));
const ProjectHost = lazy(() => import("./pages/create/ProjectHost"));
const Performance = lazy(() => import("./pages/Performance"));
const Icons = lazy(() => import("./pages/Icons"));
const BigMatch = lazy(() => import("./pages/BigMatch"));

export default function App() {
  const page = useStore((s) => s.page);
  const refresh = useStore((s) => s.refresh);
  const activeTab = useTabs((s) => s.active);
  const hasTabs = useTabs((s) => s.tabs.length > 0);
  const toast = useStore((s) => s.toast);
  const prefs = useStore((s) => s.settings?.uiPrefs);
  const skin = (prefs?.skin as string | undefined) ?? "sc";
  const fac = (prefs?.faction as string | undefined) ?? "uef";

  useEffect(() => {
    (async () => {
      try {
        const recovered = await api.recover();
        if (recovered) toast("info", `Uma operação interrompida foi resolvida: ${recovered}`);
        const info = await api.appInfo();
        useStore.setState({ info });
        await refresh();
        // o Menu moderno 1.x trocava a fonte de um jeito que fazia o jogo fechar ao abrir
        const oldTheme = useStore.getState().mods.find((m) => m.manifest.id === "menu-moderno" && m.enabled && m.manifest.version.startsWith("1."));
        if (oldTheme) {
          await api.setModEnabled(oldTheme.manifest.id, false).catch(() => {});
          await refresh();
          toast("info", "Desliguei o Menu moderno antigo, que fazia o jogo fechar ao abrir. Gere de novo na Biblioteca para usar a versão corrigida.");
        }
        // Primeira Pessoa montada por um launcher antigo (a 1.0 fechava o jogo no F5): monta de novo
        // com as opções salvas, mantendo ligado ou desligado como estava
        const fp = useStore.getState().mods.find((m) => m.manifest.id === "cp-primeira-pessoa");
        if (fp && fp.manifest.version !== FP_VERSION) {
          try {
            await api.buildFirstPerson(loadFirstPerson(), fp.enabled);
            await refresh();
            toast("info", `Primeira Pessoa atualizada para a versão ${FP_VERSION}.`);
          } catch (e) {
            toast("error", `Não deu para atualizar a Primeira Pessoa: ${errorText(e)}. Abra o Hub de mods e clique em Atualizar.`);
          }
        }
        // cópia de segurança automática dos projetos (local, de tempos em tempos)
        void api.backupAuto().then((b) => { if (b) toast("info", `Cópia de segurança automática dos projetos feita (${b.projects} projeto(s)).`); }).catch(() => {});
        if (useStore.getState().settings?.checkAppUpdates && !useStore.getState().settings?.offline) {
          // em segundo plano: sem internet ou GitHub lento não atrasa a abertura
          void api.appUpdateCheck().then((up) => {
            if (!up) return;
            useStore.setState({ appUpdate: up });
            toast("info", `CommandProject ${up.version} disponível. Em Configurações → Atualizações é só clicar em "Atualizar agora".`);
          }).catch(() => {});
        }
      } catch (e) {
        toast("error", errorText(e));
      }
    })();
    const offs = [
      onEvent<string | null>("cp://game-exited", (e) => {
        if (e) toast("error", `O jogo fechou, mas não deu para restaurar os arquivos: ${e}`);
        else toast("ok", "Jogo fechado. A pasta do jogo voltou ao original.");
        void refresh();
      }),
      onEvent("cp://game-started", () => toast("info", "Jogo aberto. Os arquivos serão restaurados quando ele fechar.")),
      onEvent<{ dump: string; mods: [string, string][] }>("cp://game-crashed", (c) => {
        useStore.setState({ crash: c });
        toast("error", "O jogo fechou com erro. Veja na tela inicial o que pode ter causado.");
      }),
      onEvent<number>("cp://memory-limited", (mb) => toast("ok", `Memória do jogo limitada a ${(mb / 1024).toLocaleString("pt-BR")} GB.`)),
      onEvent<string>("cp://priority-set", (p) => toast("ok", `Prioridade do jogo: ${p === "high" ? "alta" : "acima do normal"}.`)),
      onEvent<string>("cp://priority-failed", (e) => toast("error", `Não deu para mudar a prioridade do jogo: ${e}`)),
      onEvent<string>("cp://memory-limit-failed", (e) => toast("error", `Não deu para aplicar o limite de memória: ${e}. O jogo está usando até 4 GB.`)),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [refresh, toast]);

  return (
    <div className={`app ${activeTab ? "in-project" : ""}`} data-skin={skin} data-fac={fac} data-motion={prefs?.reduceMotion ? "off" : "on"}>
      <SystemBar />
      {hasTabs && (
        <div className="project-area" hidden={!activeTab}>
          <Suspense fallback={<div className="page muted">Abrindo…</div>}><ProjectHost /></Suspense>
        </div>
      )}
      <Rail />
      <main className="main">
        {page === "me" && <Me />}
        {page === "home" && <Home />}
        {page === "library" && <Library />}
        {page === "hub" && <Hub />}
        {page === "multiplayer" && <Multiplayer />}
        {page === "studio" && (
          <Suspense fallback={<div className="page muted">Carregando o Estúdio…</div>}>
            <Studio />
          </Suspense>
        )}
        {page === "create" && (
          <Suspense fallback={<div className="page muted">Carregando…</div>}>
            <Create />
          </Suspense>
        )}
        {page === "performance" && (
          <Suspense fallback={<div className="page muted">Carregando…</div>}>
            <Performance />
          </Suspense>
        )}
        {page === "bigmatch" && (
          <Suspense fallback={<div className="page muted">Carregando…</div>}>
            <BigMatch />
          </Suspense>
        )}
        {page === "settings" && <SettingsPage />}
        {page === "files" && <Files />}
        {page === "icons" && (
          <Suspense fallback={<div className="page muted">Carregando…</div>}>
            <Icons />
          </Suspense>
        )}
      </main>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
