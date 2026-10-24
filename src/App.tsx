import { lazy, Suspense, useEffect } from "react";
import { CommandPalette, Rail, SystemBar } from "./components/Shell";
import { Toasts } from "./components/ui";
import { api, onEvent } from "./lib/api";
import { errorText, useStore } from "./lib/store";
import Home from "./pages/Home";
import Hub from "./pages/Hub";
import Library from "./pages/Library";
import Me from "./pages/Me";
import Multiplayer from "./pages/Multiplayer";
import SettingsPage from "./pages/Settings";

// o Estúdio carrega three.js e o editor de código: só baixa quando abrir
const Studio = lazy(() => import("./pages/studio/Studio"));

export default function App() {
  const page = useStore((s) => s.page);
  const refresh = useStore((s) => s.refresh);
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    (async () => {
      try {
        const recovered = await api.recover();
        if (recovered) toast("info", `Uma operação interrompida foi resolvida: ${recovered}`);
        const info = await api.appInfo();
        useStore.setState({ info });
        await refresh();
        if (useStore.getState().settings?.checkAppUpdates) {
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
      onEvent<number>("cp://memory-limited", (mb) => toast("ok", `Memória do jogo limitada a ${(mb / 1024).toLocaleString("pt-BR")} GB.`)),
      onEvent<string>("cp://memory-limit-failed", (e) => toast("error", `Não deu para aplicar o limite de memória: ${e}. O jogo está usando até 4 GB.`)),
    ];
    return () => offs.forEach((p) => p.then((off) => off()));
  }, [refresh, toast]);

  return (
    <div className="app">
      <SystemBar />
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
        {page === "settings" && <SettingsPage />}
      </main>
      <CommandPalette />
      <Toasts />
    </div>
  );
}
