import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import type { Project } from "../../lib/types";
import Explorer from "./Explorer";
import Maps from "./Maps";
import Projects from "./Projects";
import UiSkin from "./UiSkin";

type Tab = "projects" | "explorer" | "skin" | "maps";
const TABS: { id: Tab; label: string }[] = [
  { id: "projects", label: "Meus projetos" },
  { id: "explorer", label: "Arquivos do jogo" },
  { id: "skin", label: "Skin de interface" },
  { id: "maps", label: "Mapas" },
];

export default function Studio() {
  const [tab, setTab] = useState<Tab>("projects");
  const [projects, setProjects] = useState<Project[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const reload = async () => {
    const list = await api.listProjects();
    setProjects(list);
    setCurrent((c) => (c && list.some((p) => p.id === c) ? c : list[0]?.id ?? null));
  };
  useEffect(() => { void reload(); }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Estúdio</h1>
          <p>Crie mods sem sair do launcher: copie arquivos do jogo para um projeto, edite Lua, texturas e modelos, e gere o mod direto na biblioteca.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === "projects" && <Projects projects={projects} current={current} setCurrent={setCurrent} reload={reload} openExplorer={() => setTab("explorer")} />}
      {tab === "explorer" && <Explorer projects={projects} target={current} setTarget={setCurrent} />}
      {tab === "skin" && <UiSkin />}
      {tab === "maps" && <Maps />}
    </div>
  );
}
