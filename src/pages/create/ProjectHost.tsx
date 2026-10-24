// Mostra os editores das abas de projeto abertas. Todos ficam montados (trocar de aba não perde
// a edição nem a câmera); só o da aba ativa aparece e recebe atalhos.
import { lazy, Suspense } from "react";
import { ActiveEditor } from "../../components/studio/kit";
import { useTabs } from "../../lib/tabs";

const MapStudio = lazy(() => import("./MapStudio"));
const ModelStudio = lazy(() => import("./ModelStudio"));
const UnitStudio = lazy(() => import("./UnitStudio"));

export default function ProjectHost() {
  const tabs = useTabs((s) => s.tabs);
  const active = useTabs((s) => s.active);
  return (
    <>
      {tabs.map((t) => (
        <div key={t.id} className="project-host" hidden={t.id !== active}>
          <ActiveEditor.Provider value={t.id === active}>
            <Suspense fallback={<div className="page muted">Abrindo o editor…</div>}>
              {t.kind === "map" && <MapStudio id={t.id} />}
              {t.kind === "model" && <ModelStudio id={t.id} />}
              {t.kind === "unit" && <UnitStudio id={t.id} />}
            </Suspense>
          </ActiveEditor.Provider>
        </div>
      ))}
    </>
  );
}
