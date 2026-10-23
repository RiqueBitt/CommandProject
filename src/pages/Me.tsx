import { useEffect, useState } from "react";
import { NewProfile } from "../components/Shell";
import { Field, hueOf, Icon, Modal, monogram } from "../components/ui";
import { api, openUrl } from "../lib/api";
import { community } from "../lib/community";
import { useStore } from "../lib/store";
import type { ServerInfo } from "../lib/types";

interface News { tag: string; title: string; text: string; icon: string; hue: number; action?: { label: string; run: () => void } }

export default function Me() {
  const settings = useStore((s) => s.settings);
  const profiles = useStore((s) => s.profiles);
  const appUpdate = useStore((s) => s.appUpdate);
  const d = useStore((s) => s.dashboard);
  const { run, refresh, go } = useStore.getState();
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [editNick, setEditNick] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!settings?.serverUrl) return;
    community.info(settings.serverUrl).then((i) => { setServer(i); setServerErr(null); }).catch((e) => setServerErr(String(e.message ?? e)));
  }, [settings?.serverUrl]);

  const news: News[] = [
    ...(appUpdate ? [{ tag: "Atualização", title: `CommandProject ${appUpdate.version}`, text: "Uma versão nova do launcher está disponível.", icon: "system_update", hue: 90, action: { label: "Ver novidades", run: () => openUrl(appUpdate.url) } }] : []),
    ...(server?.motd ? [{ tag: server.name, title: "Recado do servidor", text: server.motd, icon: "campaign", hue: 200 }] : []),
    { tag: "Dica", title: "Ação rápida", text: "Aperte Ctrl+K em qualquer tela para jogar, trocar de perfil ou ligar um mod sem tirar a mão do teclado.", icon: "bolt", hue: 75 },
    { tag: "Estúdio", title: "Skin de interface em minutos", text: "Recolora a HUD inteira do jogo, veja antes e depois e gere o mod direto na biblioteca.", icon: "palette", hue: 160, action: { label: "Abrir o Estúdio", run: () => go("studio") } },
    { tag: "Mapas", title: "Crie mapas de escaramuça", text: "Escolha um terreno, clique para posicionar as bases e o toolkit verifica se todo mundo se alcança.", icon: "map", hue: 25, action: { label: "Criar um mapa", run: () => go("studio") } },
  ];
  const n = news[slide % news.length];
  const nick = settings?.nickname?.trim() || "";
  const list = (profiles?.profiles ?? []).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <>
      <aside className="side-panel">
        <div className="card pad row" style={{ gap: 12 }}>
          <span className="avatar" style={{ width: 40, height: 40 }}>{monogram(nick || "Você")}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{nick || "Sem apelido"}</b>
            <div className="small muted">{nick ? "usado nas salas e no chat" : "defina para entrar nas salas"}</div>
          </div>
          <button className="btn icon-btn sm" aria-label="Editar apelido" onClick={() => setEditNick(true)}><Icon name="edit" size={18} /></button>
        </div>
        <div className="card pad col" style={{ gap: 8 }}>
          <div className="row"><Icon name="dns" style={{ color: "var(--primary)" }} /><b style={{ flex: 1 }}>Servidor da comunidade</b></div>
          {!settings?.serverUrl ? (
            <>
              <p className="small muted">Conecte a um servidor para ver salas, conversar e baixar mods do hub dele.</p>
              <button className="btn sm tonal" onClick={() => go("settings")}>Configurar</button>
            </>
          ) : server ? (
            <>
              <div className="row small"><span className="dot ok" /> {server.name}</div>
              <div className="row small muted"><Icon name="group" size={16} /> {server.online} online, {server.rooms} sala(s)</div>
              <button className="btn sm tonal" onClick={() => go("multiplayer")}>Ver salas</button>
            </>
          ) : (
            <div className="row small muted"><span className="dot err" /> {serverErr ?? "Conectando…"}</div>
          )}
        </div>
        <div className="card pad col" style={{ gap: 6 }}>
          <div className="overline">Atalhos</div>
          <button className="content-line" onClick={() => go("library")}><Icon name="extension" /> Mods do perfil ativo</button>
          <button className="content-line" onClick={() => go("hub")}><Icon name="store" /> Hub de mods</button>
          <button className="content-line" onClick={() => useStore.getState().setPalette(true)}><Icon name="bolt" /> Ação rápida <span className="kbd" style={{ marginLeft: "auto" }}>Ctrl+K</span></button>
        </div>
      </aside>

      <div className="scroll">
        <div className="page">
          <div className="row"><Icon name="newspaper" style={{ color: "var(--primary)" }} /><span className="spacer" /><h2>Novidades</h2></div>
          <div className="hero-carousel">
            <div className="art" style={{ background: `radial-gradient(120% 120% at 30% 30%, hsl(${n.hue} 55% 34%), hsl(${(n.hue + 40) % 360} 50% 10%))` }}>
              <Icon name={n.icon} />
            </div>
            <div className="info">
              <div className="row small"><b className="overline" style={{ color: "var(--text)" }}>{n.tag}</b></div>
              <h2>{n.title}</h2>
              <p className="muted">{n.text}</p>
              {n.action && <button className="btn sm text" style={{ alignSelf: "flex-start", color: "var(--primary)", paddingLeft: 0 }} onClick={n.action.run}>{n.action.label} <Icon name="arrow_forward" size={16} /></button>}
            </div>
            <button className="btn icon-btn nav l" aria-label="Anterior" onClick={() => setSlide((s) => (s + news.length - 1) % news.length)}><Icon name="chevron_left" /></button>
            <button className="btn icon-btn nav r" aria-label="Próxima" onClick={() => setSlide((s) => (s + 1) % news.length)}><Icon name="chevron_right" /></button>
            <div className="dots">{news.map((x, i) => <button key={x.title} aria-label={x.title} aria-current={i === slide % news.length} onClick={() => setSlide(i)} />)}</div>
          </div>

          <div>
            <div className="section-head">
              <Icon name="apps" />
              <h2>Seus perfis</h2>
              <button className="btn primary sm" onClick={() => setCreating(true)}><Icon name="add" /> Criar perfil</button>
            </div>
            <div className="search-bar" style={{ maxWidth: 320, marginBottom: 14 }}>
              <Icon name="search" />
              <input className="input dense" placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar perfis" />
            </div>
            <div className="room-grid">
              {list.map((p) => {
                const h = hueOf(p.id);
                const isActive = p.id === profiles?.active;
                return (
                  <button key={p.id} className="list-row clickable" style={{ textAlign: "left" }} onClick={async () => {
                    if (!isActive) await run("profile", () => api.setActiveProfile(p.id));
                    await refresh();
                    go("home");
                  }}>
                    <span className="instance-tile" style={{ ["--tile-a" as string]: `hsl(${h} 42% 38%)`, ["--tile-b" as string]: `hsl(${(h + 35) % 360} 45% 18%)` }}>{monogram(p.name)}</span>
                    <span className="grow">
                      <span className="title" style={{ display: "block" }}>{p.name}</span>
                      <span className="sub">{p.mods.filter((m) => m.enabled).length} mods ativos{isActive && d?.inSync ? ", aplicado" : ""}</span>
                    </span>
                    {isActive && <span className="chip ok">ativo</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {creating && <NewProfile onClose={() => setCreating(false)} />}
      {editNick && <NickModal onClose={() => setEditNick(false)} />}
    </>
  );
}

export function NickModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const { run, refresh } = useStore.getState();
  const [nick, setNick] = useState(settings?.nickname ?? "");
  const valid = /^[\p{L}\p{N} _.\-[\]]{2,20}$/u.test(nick.trim());
  return (
    <Modal title="Apelido" icon="badge" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!settings) return;
        const r = await run("nick", () => api.saveSettings({ ...settings, nickname: nick.trim() }), "Apelido salvo.");
        if (r) { await refresh(); onClose(); }
      }}>
        <Field label="Como você aparece nas salas e no chat" hint="2 a 20 caracteres: letras, números, espaço, _ - . [ ]">
          <input className="input" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} />
        </Field>
        <footer><button type="button" className="btn text" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={!valid}>Salvar</button></footer>
      </form>
    </Modal>
  );
}
