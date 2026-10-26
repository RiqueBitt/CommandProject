import { useEffect, useState } from "react";
import { NewProfile } from "../components/Shell";
import { Field, hueOf, Icon, Modal, monogram } from "../components/ui";
import { api } from "../lib/api";
import { community } from "../lib/community";
import { switchProfile, useStore } from "../lib/store";
import type { ServerInfo } from "../lib/types";
import { t, tr } from "../lib/i18n";

interface News { tag: string; title: string; text: string; icon: string; hue: number; action?: { label: string; run: () => void } }

export default function Me() {
  const settings = useStore((s) => s.settings);
  const profiles = useStore((s) => s.profiles);
  const appUpdate = useStore((s) => s.appUpdate);
  const d = useStore((s) => s.dashboard);
  const { go } = useStore.getState();
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [editNick, setEditNick] = useState(false);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!settings?.serverUrl) return;
    community.info(settings.serverUrl).then((i) => { setServer(i); setServerErr(null); }).catch((e) => setServerErr(tr(String(e.message ?? e))));
  }, [settings?.serverUrl]);

  const news: News[] = [
    ...(appUpdate ? [{ tag: t("Atualização"), title: `CommandProject ${appUpdate.version}`, text: t("Uma versão nova do launcher está disponível."), icon: "system_update", hue: 90, action: { label: t("Atualizar agora"), run: () => useStore.getState().openSettings("atualizacoes") } }] : []),
    ...(server?.motd ? [{ tag: server.name, title: t("Recado do servidor"), text: server.motd, icon: "campaign", hue: 200 }] : []),
    { tag: t("Dica"), title: t("Ação rápida"), text: t("Aperte Ctrl+K em qualquer tela para jogar, trocar de perfil ou ligar um mod sem tirar a mão do teclado."), icon: "bolt", hue: 75 },
    { tag: t("Estúdio"), title: t("Skin de interface em minutos"), text: t("Recolora a HUD inteira do jogo, veja antes e depois e gere o mod direto na biblioteca."), icon: "palette", hue: 160, action: { label: t("Abrir o Estúdio"), run: () => { useStore.getState().setStudioTab("skin"); go("studio"); } } },
    { tag: t("Mapas"), title: t("Crie mapas de escaramuça"), text: t("Escolha um terreno, clique para posicionar as bases e o toolkit verifica se todo mundo se alcança."), icon: "map", hue: 25, action: { label: t("Criar um mapa"), run: () => { useStore.getState().setStudioTab("maps"); go("studio"); } } },
  ];
  const n = news[slide % news.length];
  const nick = settings?.nickname?.trim() || "";
  const list = (profiles?.profiles ?? []).filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <>
      <aside className="side-panel">
        <div className="card pad row" style={{ gap: 12 }}>
          <span className="avatar" style={{ width: 40, height: 40 }}>{monogram(nick || t("Você"))}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>{nick || t("Sem apelido")}</b>
            <div className="small muted">{nick ? t("usado nas salas e no chat") : t("defina para entrar nas salas")}</div>
          </div>
          <button className="btn icon-btn sm" aria-label={t("Editar apelido")} onClick={() => setEditNick(true)}><Icon name="edit" size={18} /></button>
        </div>
        <div className="card pad col" style={{ gap: 8 }}>
          <div className="row"><Icon name="dns" style={{ color: "var(--primary)" }} /><b style={{ flex: 1 }}>{t("Servidor da comunidade")}</b></div>
          {!settings?.serverUrl ? (
            <>
              <p className="small muted">{t("Conecte a um servidor para ver salas, conversar e baixar mods do hub dele.")}</p>
              <button className="btn sm tonal" onClick={() => useStore.getState().openSettings("comunidade")}>{t("Configurar")}</button>
            </>
          ) : server ? (
            <>
              <div className="row small"><span className="dot ok" /> {server.name}</div>
              <div className="row small muted"><Icon name="group" size={16} /> {t("{online} online, {rooms} sala(s)", { online: server.online, rooms: server.rooms })}</div>
              <button className="btn sm tonal" onClick={() => go("multiplayer")}>{t("Ver salas")}</button>
            </>
          ) : (
            <div className="row small muted"><span className="dot err" /> {serverErr ?? t("Conectando…")}</div>
          )}
        </div>
        <div className="card pad col" style={{ gap: 6 }}>
          <div className="overline">{t("Atalhos")}</div>
          <button className="content-line" onClick={() => go("library")}><Icon name="extension" /> {t("Mods do perfil ativo")}</button>
          <button className="content-line" onClick={() => go("hub")}><Icon name="store" /> {t("Hub de mods")}</button>
          <button className="content-line" onClick={() => useStore.getState().setPalette(true)}><Icon name="bolt" /> {t("Ação rápida")} <span className="kbd" style={{ marginLeft: "auto" }}>Ctrl+K</span></button>
        </div>
      </aside>

      <div className="scroll">
        <div className="page">
          <div className="row"><Icon name="newspaper" style={{ color: "var(--primary)" }} /><span className="spacer" /><h2>{t("Novidades")}</h2></div>
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
            <button className="btn icon-btn nav l" aria-label={t("Anterior")} onClick={() => setSlide((s) => (s + news.length - 1) % news.length)}><Icon name="chevron_left" /></button>
            <button className="btn icon-btn nav r" aria-label={t("Próxima")} onClick={() => setSlide((s) => (s + 1) % news.length)}><Icon name="chevron_right" /></button>
            <div className="dots">{news.map((x, i) => <button key={x.title} aria-label={x.title} aria-current={i === slide % news.length} onClick={() => setSlide(i)} />)}</div>
          </div>

          <div>
            <div className="section-head">
              <Icon name="apps" />
              <h2>{t("Seus perfis")}</h2>
              <button className="btn primary sm" onClick={() => setCreating(true)}><Icon name="add" /> {t("Criar perfil")}</button>
            </div>
            <div className="search-bar" style={{ maxWidth: 320, marginBottom: 14 }}>
              <Icon name="search" />
              <input className="input dense" placeholder={t("Filtrar")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Filtrar perfis")} />
            </div>
            <div className="room-grid">
              {list.map((p) => {
                const h = hueOf(p.id);
                const isActive = p.id === profiles?.active;
                return (
                  <button key={p.id} className="list-row clickable" style={{ textAlign: "left" }} onClick={() => void switchProfile(p.id, p.name, isActive)}>
                    <span className="instance-tile" style={{ ["--tile-a" as string]: `hsl(${h} 42% 38%)`, ["--tile-b" as string]: `hsl(${(h + 35) % 360} 45% 18%)` }}>{monogram(p.name)}</span>
                    <span className="grow">
                      <span className="title" style={{ display: "block" }}>{p.name}</span>
                      <span className="sub">{isActive && d?.inSync ? t("{n} mods ativos, aplicado", { n: p.mods.filter((m) => m.enabled).length }) : t("{n} mods ativos", { n: p.mods.filter((m) => m.enabled).length })}</span>
                    </span>
                    {isActive && <span className="chip ok">{t("ativo")}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <Explore />
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
    <Modal title={t("Apelido")} icon="badge" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!settings) return;
        const r = await run("nick", () => api.saveSettings({ ...settings, nickname: nick.trim() }), t("Apelido salvo."));
        if (r) { await refresh(); onClose(); }
      }}>
        <Field label={t("Como você aparece nas salas e no chat")} hint={t("2 a 20 caracteres: letras, números, espaço, _ - . [ ]")}>
          <input className="input" value={nick} maxLength={20} onChange={(e) => setNick(e.target.value)} />
        </Field>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" disabled={!valid}>{t("Salvar")}</button></footer>
      </form>
    </Modal>
  );
}

/** Atalhos ilustrados para o que o CommandProject faz (preenche a tela "Eu" com algo útil). */
function Explore() {
  const { go, setStudioTab } = useStore.getState();
  const items: { icon: string; title: string; text: string; tint: string; action: () => void }[] = [
    { icon: "auto_awesome", title: "Shaders", text: t("Nitidez, brilho e cores vivas sem dessincronizar o multiplayer."), tint: "163 230 53", action: () => go("library") },
    { icon: "hd", title: t("Texturas HD"), text: t("Amplie as texturas do seu jogo com um clique no Estúdio."), tint: "56 189 248", action: () => { setStudioTab("hd"); go("studio"); } },
    { icon: "map", title: t("Criar mapas"), text: t("Posicione bases e gere mapas jogáveis com o SC2 Map Toolkit."), tint: "245 184 75", action: () => { setStudioTab("maps"); go("studio"); } },
    { icon: "hub", title: t("Jogar online"), text: t("Salas, chat e perfis de mods iguais para todo mundo."), tint: "167 139 250", action: () => go("multiplayer") },
  ];
  return (
    <section className="col" style={{ gap: 12, marginTop: 26 }}>
      <div className="section-head" style={{ marginBottom: 0 }}><Icon name="explore" /><h2>{t("Explore")}</h2></div>
      <div className="explore-grid">
        {items.map((i) => (
          <button key={i.title} className="explore" style={{ ["--tint" as string]: i.tint }} onClick={i.action}>
            <span className="ico"><Icon name={i.icon} /></span>
            <b>{i.title}</b>
            <span className="muted small">{i.text}</span>
            <Icon name="arrow_forward" className="go" />
          </button>
        ))}
      </div>
    </section>
  );
}
