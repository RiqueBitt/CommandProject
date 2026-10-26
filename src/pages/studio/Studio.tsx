import { useEffect, useState } from "react";
import { Icon } from "../../components/ui";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import { t } from "../../lib/i18n";
import type { Project } from "../../lib/types";
import Explorer from "./Explorer";
import Maps from "./Maps";
import Projects from "./Projects";
import TexturesHd from "./TexturesHd";
import UiSkin from "./UiSkin";

type Tab = "projects" | "explorer" | "hd" | "skin" | "maps";
const TABS: { id: Tab; label: string; icon: string; hint: string }[] = [
  { id: "projects", label: "Meus projetos", icon: "folder_special", hint: "Lua, texturas e modelos do seu mod" },
  { id: "explorer", label: "Arquivos do jogo", icon: "folder_zip", hint: "Navegue e copie o que quer mudar" },
  { id: "hd", label: "Texturas HD", icon: "hd", hint: "Mais resolução e nitidez em lote" },
  { id: "skin", label: "Skin de interface", icon: "palette", hint: "Recolore a HUD inteira" },
  { id: "maps", label: "Mapas", icon: "map", hint: "SC2 Map Toolkit" },
];

export default function Studio() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = useStore.getState().studioTab as Tab | null;
    useStore.getState().setStudioTab(null);
    return saved ?? "projects";
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const reload = async () => {
    const list = await api.listProjects();
    setProjects(list);
    setCurrent((c) => (c && list.some((p) => p.id === c) ? c : list[0]?.id ?? null));
  };
  useEffect(() => { void reload(); }, []);
  const cur = TABS.find((x) => x.id === tab)!;

  return (
    <>
      <aside className="side-panel">
        <div className="overline" style={{ padding: "4px 12px" }}>{t("Estúdio")}</div>
        <nav className="nav-list">
          {TABS.map((x) => (
            <button key={x.id} className="nav-link" aria-current={tab === x.id ? "page" : undefined} onClick={() => setTab(x.id)}>
              <Icon name={x.icon} />
              <span style={{ display: "flex", flexDirection: "column" }}>{t(x.label)}<small className="faint" style={{ fontWeight: 400 }}>{t(x.hint)}</small></span>
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <p className="small faint" style={{ padding: "0 12px" }}>{t("Tudo que você gera aqui entra na biblioteca como um mod comum: dá para ligar, desligar, compartilhar e publicar no hub.")}</p>
      </aside>
      <div className="scroll">
        <div className="page">
          <div className="row"><Icon name={cur.icon} size={28} style={{ color: "var(--primary)" }} /><h1 className="page-title">{t(cur.label)}</h1></div>
          {tab === "projects" && <Projects projects={projects} current={current} setCurrent={setCurrent} reload={reload} openExplorer={() => setTab("explorer")} />}
          {tab === "explorer" && <Explorer projects={projects} target={current} setTarget={setCurrent} />}
          {tab === "hd" && <TexturesHd />}
          {tab === "skin" && <UiSkin />}
          {tab === "maps" && <Maps />}
        </div>
      </div>
    </>
  );
}
