import { Gamepad2, Globe2, Hammer, Home, Library, Minus, Settings, Square, Users, X } from "lucide-react";
import { windowAction } from "../lib/api";
import { plural, useStore, type Page } from "../lib/store";

export function TitleBar() {
  return (
    <header className="titlebar">
      <svg width="18" height="18" viewBox="0 0 100 100" aria-hidden>
        <polygon points="17,6 83,6 94,17 94,83 83,94 17,94 6,83 6,17" fill="#102133" />
        <polygon points="32,24 68,24 74,30 74,37 62,37 59,34 37,34 34,37 34,63 37,66 59,66 62,63 74,63 74,70 68,76 32,76 24,68 24,32" fill="#f2b33d" />
      </svg>
      <span className="brand"><b>CommandProject</b>&nbsp; Supreme Commander 2</span>
      <div className="drag" data-tauri-drag-region />
      <button className="winbtn" onClick={() => windowAction("minimize")} aria-label="Minimizar"><Minus size={16} /></button>
      <button className="winbtn" onClick={() => windowAction("maximize")} aria-label="Maximizar"><Square size={13} /></button>
      <button className="winbtn close" onClick={() => windowAction("close")} aria-label="Fechar"><X size={17} /></button>
    </header>
  );
}

const NAV: { id: Page; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Comando", icon: Home },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "hub", label: "Hub de mods", icon: Globe2 },
  { id: "multiplayer", label: "Multiplayer", icon: Users },
  { id: "studio", label: "Estúdio", icon: Hammer },
];

export function Sidebar() {
  const page = useStore((s) => s.page);
  const go = useStore((s) => s.go);
  const d = useStore((s) => s.dashboard);
  const pending = d ? d.pending.add.length + d.pending.remove.length + d.pending.replace.length + d.pending.restore.length : 0;
  return (
    <nav className="sidebar" aria-label="Navegação principal">
      {NAV.map(({ id, label, icon: Icon }) => (
        <button key={id} className="nav-item" aria-current={page === id ? "page" : undefined} onClick={() => go(id)}>
          <Icon size={18} />
          {label}
          {id === "library" && d && <span className="count" title="mods ativos">{d.enabledMods}</span>}
        </button>
      ))}
      <div className="spacer" />
      <button className="nav-item" aria-current={page === "settings" ? "page" : undefined} onClick={() => go("settings")}>
        <Settings size={18} /> Configurações
      </button>
      {d && (
        <button className="profile-chip" style={{ textAlign: "left", background: "transparent", cursor: "pointer" }} onClick={() => go("library")}>
          <b>{d.activeProfileName}</b>
          <span className="row" style={{ gap: 6 }}>
            <Gamepad2 size={13} />
            {pending ? `${plural(pending, "alteração", "alterações")} para aplicar` : d.game ? "Pronto para jogar" : "Jogo não encontrado"}
          </span>
        </button>
      )}
    </nav>
  );
}
