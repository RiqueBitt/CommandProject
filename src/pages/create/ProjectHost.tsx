// Mostra os editores das abas de projeto abertas. Todos ficam montados (trocar de aba não perde
// a edição nem a câmera); só o da aba ativa aparece e recebe atalhos.
import { lazy, Suspense } from "react";
import { ActiveEditor } from "../../components/studio/kit";
import { useTabs } from "../../lib/tabs";
import { UNITS_ENABLED } from "../../lib/features";
import { Empty } from "../../components/ui";
import { t } from "../../lib/i18n";

const MapStudio = lazy(() => import("./MapStudio"));
const ModelStudio = lazy(() => import("./ModelStudio"));
const UnitStudio = lazy(() => import("./UnitStudio"));

export default function ProjectHost() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  return (
    <>
      {tabs.map((tab) => (
        <div key={tab.id} className="project-host" hidden={tab.id !== active}>
          <ActiveEditor.Provider value={tab.id === active}>
            <Suspense fallback={<div className="page muted">{t("Abrindo o editor…")}</div>}>
              {tab.kind === "map" && <MapStudio id={tab.id} />}
              {tab.kind === "model" && <ModelStudio id={tab.id} />}
              {tab.kind === "unit" && (UNITS_ENABLED ? <UnitStudio id={tab.id} /> : (
                <div className="page"><Empty icon="pause_circle" title={t("Editor de tropas pausado")}>{t("O editor de tropas está desligado por enquanto: o foco agora é o gerador e o editor de mapas. Seu projeto continua salvo e abre normalmente quando o editor voltar.")}</Empty></div>
              ))}
            </Suspense>
          </ActiveEditor.Provider>
        </div>
      ))}
    </>
  );
}
