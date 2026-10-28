// "Tela inicial nova": a tela inicial do jogo no estilo do CommandProject (logo em cima, botões com
// ícone e borda neon, submenus ao lado, caixa do jogador e notícias), na cor escolhida, com o logo
// e o vídeo de fundo do jogador. Montada pelo launcher quando você aplica o perfil ou joga.
import { useEffect, useState } from "react";
import { api, pickFile } from "../lib/api";
import { t } from "../lib/i18n";
import { errorText, useStore } from "../lib/store";
import type { StartScreenSettings, StartScreenView } from "../lib/types";
import { Icon, Notice, Switch, TaskProgress } from "./ui";

const COLORS = [
  { id: "#2b8cff", name: "Azul" },
  { id: "#e21e24", name: "Vermelho" },
  { id: "#22c55e", name: "Verde" },
  { id: "#a855f7", name: "Roxo" },
  { id: "#f59e0b", name: "Âmbar" },
  { id: "#06b6d4", name: "Ciano" },
  { id: "#e5e7eb", name: "Prata" },
];

const BUTTONS: [string, string][] = [
  ["CAMPANHA", "star"], ["BATALHA", "gps_fixed"], ["MULTIJOGADOR", "public"], ["OPÇÕES", "settings"], ["EXTRAS", "folder"], ["SAIR", "power_settings_new"],
];

function Preview({ s, logo }: { s: StartScreenSettings; logo: string | null }) {
  return (
    <div className="ss-preview" style={{ ["--ss" as string]: s.accent }} role="img" aria-label={t("Prévia da tela inicial nova")}>
      <div className="ss-tint" />
      {logo && s.customLogo ? <img className="ss-logo img" src={logo} alt="" /> : <div className="ss-logo">SUPREME<br /><b>COMMANDER 3</b></div>}
      <div className="ss-tag"><span className="ss-av" />{t("Você")}</div>
      <div className="ss-col">
        {BUTTONS.map(([label, icon], i) => (
          <div key={label} className={`ss-btn ${i === 0 ? "on" : ""}`}><Icon name={icon} size={14} /><span>{t(label)}</span><i>»</i></div>
        ))}
      </div>
      <div className="ss-sub">
        {["TUTORIAL", "MENU DA CAMPANHA", "CARREGAR CAMPANHA"].map((l, i) => <div key={l} className={`ss-btn sub ${i === 1 ? "hover" : ""}`}><span>{t(l)}</span><i>›</i></div>)}
      </div>
      {(s.newsTitle || s.newsText) && (
        <div className="ss-news">
          <b>{t("NOTÍCIAS")}</b>
          <div className="ss-art" />
          <strong>{s.newsTitle}</strong>
          <small>{s.newsText}</small>
        </div>
      )}
    </div>
  );
}

export default function StartScreenCard() {
  const { run, refresh, toast } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const [v, setV] = useState<StartScreenView | null>(null);
  const [draft, setDraft] = useState<StartScreenSettings | null>(null);

  useEffect(() => {
    api.startScreen().then((x) => { setV(x); setDraft(x.settings); }).catch(() => setV(null));
  }, []);
  // guarda sozinho um tempinho depois de mexer
  useEffect(() => {
    if (!draft || !v || JSON.stringify(draft) === JSON.stringify(v.settings)) return;
    const h = setTimeout(() => {
      api.startScreenSave(draft).then(setV).catch((e) => toast("error", errorText(e)));
    }, 400);
    return () => clearTimeout(h);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v || !draft) return null;
  const set = (p: Partial<StartScreenSettings>) => setDraft({ ...draft, ...p });
  const after = (x: StartScreenView | undefined) => { if (x) { setV(x); setDraft(x.settings); } };

  const chooseLogo = async () => {
    const p = await pickFile([{ name: t("Imagem"), extensions: ["png", "jpg", "jpeg", "webp"] }]);
    if (p) after(await run("sslogo", () => api.startScreenLogo(p), t("Logo pronto: o fundo preto vira transparente.")));
  };
  const chooseVideo = async () => {
    const p = await pickFile([{ name: t("Vídeo"), extensions: ["mp4", "mkv", "mov", "webm", "avi", "usm"] }]);
    if (!p) return;
    if (!p.toLowerCase().endsWith(".usm") && !v.ffmpeg) {
      toast("info", t("Para converter o vídeo o launcher precisa do ffmpeg: baixe com o botão ao lado."));
      return;
    }
    after(await run("startvideo", () => api.startScreenVideo(p, 60), t("Vídeo convertido para o formato do jogo.")));
  };
  const apply = async () => {
    await run("apply", () => api.applyActive(), t("Tela inicial montada. Abra o jogo para ver."));
    await refresh();
    after(await api.startScreen().catch(() => undefined));
  };

  return (
    <section className="card pad col ss-card">
      <div className="card-title">
        <Icon name="space_dashboard" style={{ color: "var(--primary)" }} /><h3>{t("Tela inicial nova")}</h3>
        <span className="chip"><Icon name="fiber_new" size={15} /> {t("Novo")}</span>
        <span className="grow" />
        <Switch label={draft.enabled ? t("Desligar") : t("Ligar")} checked={draft.enabled} onChange={(on) => set({ enabled: on })} />
      </div>
      <p className="muted small">{t("Logo em cima, botões grandes com ícone e borda neon, submenus ao lado, caixa do jogador e notícias. Os outros menus (criar partida, opções, multijogador, campanha) ganham o mesmo visual e a mesma cor, e os botões dos mods da Forja entram junto. Só muda a aparência: o jogo e o multijogador continuam iguais.")}</p>
      <div className="ss-grid">
        <Preview s={draft} logo={v.logo} />
        <div className="col" style={{ gap: 14 }}>
          <div className="col" style={{ gap: 6 }}>
            <b className="small">{t("Cor")}</b>
            <div className="accent-swatches">
              {COLORS.map((c) => (
                <button key={c.id} type="button" className="accent-swatch" style={{ background: c.id }} aria-pressed={draft.accent.toLowerCase() === c.id} title={t(c.name)} aria-label={t(c.name)} onClick={() => set({ accent: c.id })} />
              ))}
              <input type="color" value={draft.accent} onChange={(e) => set({ accent: e.target.value })} aria-label={t("Outra cor")} title={t("Outra cor")} />
            </div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <b className="small">{t("Logo")}</b>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn sm" disabled={!!busy.sslogo} onClick={() => void chooseLogo()}><Icon name="image" size={16} /> {v.logo ? t("Trocar imagem") : t("Usar uma imagem")}</button>
              {v.logo && <button className="btn sm text" onClick={async () => after(await run("sslogo", () => api.startScreenLogo(null)))}><Icon name="undo" size={16} /> {t("Logo padrão")}</button>}
            </div>
            <span className="faint small">{t("PNG ou JPG com fundo preto ou transparente: o fundo some e o brilho fica.")}</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <b className="small">{t("Vídeo de fundo")}</b>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn sm" disabled={!!busy.startvideo} onClick={() => void chooseVideo()}><Icon name="movie" size={16} /> {v.video ? t("Trocar vídeo") : t("Usar um vídeo")}</button>
              {!v.ffmpeg && <button className="btn sm" disabled={!!busy.ffmpeg} onClick={async () => after(await run("ffmpeg", () => api.startScreenGetFfmpeg(), t("ffmpeg pronto.")))}><Icon name="download" size={16} /> {t("Baixar o ffmpeg")}</button>}
              {v.video && <button className="btn sm text" onClick={async () => after(await run("startvideo", () => api.startScreenVideo(null)))}><Icon name="undo" size={16} /> {t("Vídeo do jogo")}</button>}
            </div>
            {v.video && <span className="small muted"><Icon name="check_circle" size={14} /> {draft.videoName || "FMV_FRONTEND"} · {(v.video.size / 1e6).toFixed(0)} MB</span>}
            <span className="faint small">{t("Qualquer vídeo (MP4, MKV, MOV…): vira 1920×1080 a 60 quadros no formato do jogo. Faça o último quadro igual ao primeiro para o fundo repetir sem pulo.")}</span>
            <TaskProgress task="startvideo" />
            <TaskProgress task="ffmpeg" />
          </div>
          <div className="col" style={{ gap: 6 }}>
            <b className="small">{t("Atalhos de partida grande (submenu Batalha)")}</b>
            {draft.shortcuts.length === 0 && <span className="faint small">{t("Monte uma partida na tela Partida grande e use \"Pôr na tela inicial do jogo\".")}</span>}
            {draft.shortcuts.map((sc, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <Icon name="groups" size={16} /><span className="small grow">{sc.label}</span>
                <button className="btn icon-btn sm" aria-label={t("Tirar")} title={t("Tirar")} onClick={async () => after(await run("shortcut", () => api.startScreenRemoveShortcut(i)))}><Icon name="close" size={16} /></button>
              </div>
            ))}
          </div>
          <div className="col" style={{ gap: 6 }}>
            <b className="small">{t("Notícias")}</b>
            <input className="input" value={draft.newsTitle} maxLength={60} placeholder={t("Título")} onChange={(e) => set({ newsTitle: e.target.value })} />
            <input className="input" value={draft.newsText} maxLength={90} placeholder={t("Texto (vazio = sem painel)")} onChange={(e) => set({ newsText: e.target.value })} />
          </div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn primary" disabled={!!busy.apply} onClick={() => void apply()}><Icon name="published_with_changes" /> {t("Aplicar agora")}</button>
            {v.active && <span className="chip ok"><Icon name="check_circle" size={15} /> {t("No perfil")}</span>}
          </div>
        </div>
      </div>
      {draft.enabled && <Notice kind="info">{t("Vale quando você joga pelo launcher. O logo e o vídeo que você escolher ficam só no seu computador.")}</Notice>}
    </section>
  );
}
