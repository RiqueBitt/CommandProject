// Jogar por IP (sem a Steam) com o SC2-Proxima (Rackover, GPL-3.0). O launcher baixa o lançamento
// oficial, coloca o steam_api.dll dele só enquanto o jogo aberto por aqui está rodando e devolve o
// original quando ele fecha. Hospedar: abre o jogo e mostra os endereços para mandar. Entrar: copia
// o endereço e abre o jogo (Entrar em partida → cola na busca → Buscar).
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { errorText, useStore } from "../lib/store";
import type { PartyRoute, ProximaStatus } from "../lib/types";
import { CopyButton, Field, Icon, Notice } from "./ui";

const PORT = 16010;
const REPO = "https://github.com/Rackover/sc2-proxima";

function stored(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function keep(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ok */ }
}

export default function IpPlay({ nick }: { nick: string }) {
  const busy = useStore((s) => s.busy);
  const game = useStore((s) => s.dashboard?.game);
  const { run, toast } = useStore.getState();
  const [status, setStatus] = useState<ProximaStatus | null>(null);
  const [name, setName] = useState(() => stored("cp-ip-name", ""));
  const [port, setPort] = useState(() => Number(stored("cp-ip-port", String(PORT))) || PORT);
  const [address, setAddress] = useState(() => stored("cp-ip-last", ""));
  const [routes, setRoutes] = useState<PartyRoute[]>([]);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [showIp, setShowIp] = useState(false);
  const [mode, setMode] = useState<"host" | "join" | null>(null);

  useEffect(() => {
    void api.proximaStatus().then((s) => {
      setStatus(s);
      if (!stored("cp-ip-name", "") && (s.name || nick)) setName(s.name || nick);
      if (!localStorage.getItem("cp-ip-port") && s.port) setPort(s.port);
    }).catch(() => setStatus(null));
    void api.partyRoutes().then(setRoutes).catch(() => setRoutes([]));
  }, [nick]);
  useEffect(() => { keep("cp-ip-name", name); keep("cp-ip-port", String(port)); }, [name, port]);

  const download = async () => {
    const s = await run("proxima", () => api.proximaDownload(), (r) => t("Proxima {version} baixado.", { version: r.version ?? "" }));
    if (s) setStatus(s);
  };
  const play = async (host: boolean) => {
    if (!host) {
      let addr: string;
      try {
        addr = await api.proximaAddress(address);
      } catch (e) {
        toast("error", errorText(e));
        return;
      }
      keep("cp-ip-last", address.trim());
      try { await navigator.clipboard.writeText(addr); } catch { /* sem área de transferência: o endereço fica na tela */ }
    }
    setMode(host ? "host" : "join");
    await run("launch", () => api.launchIp(name.trim() || nick || "Commander", port), host ? t("Jogo aberto para hospedar por IP.") : t("Endereço copiado. Jogo aberto: cole na busca de partidas."));
  };
  const revealPublic = async () => {
    if (!publicIp) {
      const ip = await run("publicip", () => api.partyPublicIp());
      if (!ip) return;
      setPublicIp(ip);
    }
    setShowIp((v) => !v);
  };

  const ready = !!status?.version;
  const withPort = (ip: string) => (port === PORT ? ip : `${ip}:${port}`);
  const vpn = routes.filter((r) => r.kind !== "lan");
  const lan = routes.filter((r) => r.kind === "lan");

  return (
    <div className="col" style={{ gap: 16 }}>
      <section className="card pad col" style={{ gap: 10 }}>
        <div className="card-title"><Icon name="lan" style={{ color: "var(--primary)" }} /><h3>{t("Jogar por IP, sem a Steam")}</h3></div>
        <p className="muted small" style={{ maxWidth: "80ch" }}>
          {t("Partidas privadas pela rede local, por VPN (Radmin, ZeroTier, Hamachi, Tailscale) ou pela internet com a porta aberta. Usa o SC2-Proxima, que liga o conector UDP antigo do próprio jogo.")}
        </p>
        <Notice kind="info">{t("Só vale quando o jogo é aberto por aqui: ao fechar, o steam_api.dll original volta e, pela Steam, o jogo continua o de sempre (conquistas e partidas da Steam).")}</Notice>
        {!game?.exe && <Notice kind="warn">{t("Escolha a pasta do jogo (versão Steam 1.260) em Início antes.")}</Notice>}
        <div className="row wrap" style={{ gap: 10 }}>
          {ready ? (
            <span className="chip ok"><Icon name="check_circle" size={16} /> {t("Proxima {version} pronto", { version: status?.version ?? "" })}</span>
          ) : <span className="chip">{t("Ainda não baixado")}</span>}
          <button className={`btn sm ${ready ? "" : "primary"}`} disabled={!!busy.proxima} onClick={() => void download()}>
            <Icon name={ready ? "sync" : "download"} size={16} /> {busy.proxima ? t("Baixando…") : ready ? t("Atualizar") : t("Baixar o Proxima")}
          </button>
          <span className="grow" />
          <a className="small" href={REPO} target="_blank" rel="noreferrer">{t("SC2-Proxima por Rackover · licença GPL-3.0")}</a>
        </div>
      </section>

      <div className="grid">
        <section className="card pad col" style={{ gap: 10 }}>
          <div className="card-title"><Icon name="badge" style={{ color: "var(--primary)" }} /><h3>{t("Você")}</h3></div>
          <Field label={t("Nome na partida")}>
            <input className="input" value={name} maxLength={24} placeholder={nick || "Commander"} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("Porta")} hint={t("Padrão 16010. Quem hospeda precisa dela aberta (ou usar uma VPN).")}>
            <input className="input" type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Math.max(1024, Math.min(65535, Number(e.target.value) || PORT)))} />
          </Field>
        </section>

        <section className="card pad col" style={{ gap: 10 }}>
          <div className="card-title"><Icon name="cell_tower" style={{ color: "var(--primary)" }} /><h3>{t("Hospedar")}</h3></div>
          <p className="muted small">{t("Mande um destes endereços para quem vai entrar:")}</p>
          {vpn.map((r) => <div key={r.ip} className="ip-addr"><div className="v"><b>{withPort(r.ip)}</b><span>{r.label}</span></div><CopyButton text={withPort(r.ip)} /></div>)}
          {lan.map((r) => <div key={r.ip} className="ip-addr"><div className="v"><b>{withPort(r.ip)}</b><span>{t("mesma rede")}</span></div><CopyButton text={withPort(r.ip)} /></div>)}
          <div className="ip-addr">
            <div className="v"><b>{showIp && publicIp ? withPort(publicIp) : "•••.•••.•••.•••"}</b><span>{t("internet (porta aberta)")}</span></div>
            <button className="btn icon-btn sm" aria-label={showIp ? t("Esconder") : t("Mostrar")} onClick={() => void revealPublic()}><Icon name={showIp ? "visibility_off" : "visibility"} size={16} /></button>
            {showIp && publicIp && <CopyButton text={withPort(publicIp)} />}
          </div>
          <button className="btn primary" disabled={!ready || !!busy.launch} onClick={() => void play(true)}><Icon name="play_arrow" /> {t("Abrir o jogo para hospedar")}</button>
          {mode === "host" && <Notice kind="info">{t("No jogo: Multijogador → Hospedar partida, monte a sala e espere os outros entrarem.")}</Notice>}
        </section>

        <section className="card pad col" style={{ gap: 10 }}>
          <div className="card-title"><Icon name="login" style={{ color: "var(--primary)" }} /><h3>{t("Entrar")}</h3></div>
          <Field label={t("Endereço de quem hospeda")}>
            <input className="input mono" value={address} placeholder="192.168.0.10  ·  26.12.0.5:16010" onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && ready) void play(false); }} />
          </Field>
          <button className="btn primary" disabled={!ready || !address.trim() || !!busy.launch} onClick={() => void play(false)}><Icon name="play_arrow" /> {t("Copiar e abrir o jogo")}</button>
          <ol className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{t("No jogo: Multijogador → Entrar em partida.")}</li>
            <li>{t("Cole o endereço (Ctrl+V) na barra de busca e clique em Buscar.")}</li>
            <li>{t("Aparece uma partida só (o nome e o mapa não importam): clique duas vezes nela.")}</li>
          </ol>
        </section>
      </div>
      <p className="faint small">
        <Icon name="info" size={15} /> {t("Todos precisam dos mesmos mods: confira a assinatura na aba Códigos e assinatura. Partidas ranqueadas e o buscador da Steam não funcionam por IP.")}
      </p>
    </div>
  );
}
