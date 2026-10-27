// Partida grande com amigos: a sala de convite.
//
// Quem convida abre a sala (o launcher dele vira um servidor pequeno, só para quem tem o código) e
// manda o convite. Quem recebe cola o código: o launcher baixa da sala os mods e o mapa que faltam,
// entra na sala (chat e voz) e, quando o anfitrião começa, abre o jogo direto na partida dele.
// O IP de ninguém aparece na tela: o convite é cifrado e o endereço fica só dentro do launcher.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useRoom } from "../lib/room";
import { errorText, useStore } from "../lib/store";
import type { BigMatch, MatchMap, PartyHosted, PartyJoined, PartyRoute } from "../lib/types";
import RoomPanel from "./RoomPanel";
import { CopyButton, Field, Icon, Notice, TaskProgress } from "./ui";

const DEFAULT_PORT = 15000;
const FACES = ["Aleatória", "UEF", "Cybran", "Illuminate"];

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function keep(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ok */ }
}
function fmtSize(b: number) {
  return b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(0)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

interface Props {
  /** a partida montada na tela (null = ainda com erro) */
  spec: BigMatch | null;
  maps: MatchMap[];
  busy: boolean;
  running: boolean;
  /** abre o jogo (como anfitrião ou entrando na partida) */
  launch: (spec: BigMatch, label: string) => Promise<void>;
  /** marca as IAs do time do anfitrião como amigos */
  markGuests: () => void;
}

export default function MatchInvite(props: Props) {
  const [tab, setTab] = useState<"host" | "join">(() => (stored("cp-invite-tab", "host") === "join" ? "join" : "host"));
  const [name, setName] = useState(() => stored("cp-player-name", ""));
  useEffect(() => { keep("cp-invite-tab", tab); }, [tab]);
  useEffect(() => { keep("cp-player-name", name); }, [name]);
  const [hosted, setHosted] = useState<PartyHosted | null>(null);
  const [joined, setJoined] = useState<{ code: string; info: PartyJoined } | null>(null);
  const inRoom = !!hosted || !!joined;

  return (
    <section className={`card pad bm-invite ${inRoom ? "in-room" : ""}`}>
      <div className="card-title">
        <Icon name="group_add" /><h3>{t("Jogar com amigos")}</h3>
        <span className="chip" title={t("Funciona na mesma rede, por VPN (Radmin VPN, ZeroTier, Hamachi) ou com a porta aberta no roteador de quem convida.")}>{t("experimental")}</span>
        <span className="grow" />
        {!inRoom && (
          <div className="seg" role="tablist" aria-label={t("Jogar com amigos")}>
            <button type="button" role="tab" className="btn sm" aria-pressed={tab === "host"} onClick={() => setTab("host")}><Icon name="share" size={15} /> {t("Convidar")}</button>
            <button type="button" role="tab" className="btn sm" aria-pressed={tab === "join"} onClick={() => setTab("join")}><Icon name="login" size={15} /> {t("Entrar com convite")}</button>
          </div>
        )}
      </div>
      {!inRoom && (
        <div className="bm-invite-row">
          <Field label={t("Seu nome no jogo")}>
            <input className="input" value={name} maxLength={24} placeholder={t("Comandante")} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
      )}
      {hosted ? <HostRoom {...props} hosted={hosted} name={name} onClose={() => { void api.partyStop(); setHosted(null); }} />
        : joined ? <GuestRoom {...props} code={joined.code} info={joined.info} name={name} onLeave={() => { void api.partyLeave().then(() => useStore.getState().refresh()); setJoined(null); }} />
        : tab === "host" ? <HostSetup {...props} name={name} onHosted={setHosted} />
        : <JoinSetup {...props} name={name} onJoin={(code, info) => setJoined({ code, info })} />}
    </section>
  );
}

// ---------------------------------------------------------------- anfitrião

function HostSetup({ spec, markGuests, name, onHosted }: Props & { name: string; onHosted: (h: PartyHosted) => void }) {
  const [routes, setRoutes] = useState<PartyRoute[] | null>(null);
  const [route, setRoute] = useState(() => stored("cp-invite-route", ""));
  const [port, setPort] = useState(() => Number(stored("cp-invite-port", String(DEFAULT_PORT))) || DEFAULT_PORT);
  const [opening, setOpening] = useState(false);
  useEffect(() => { void api.partyRoutes().then(setRoutes).catch(() => setRoutes([])); }, []);
  useEffect(() => { keep("cp-invite-route", route); keep("cp-invite-port", String(port)); }, [route, port]);
  const options = useMemo<PartyRoute[]>(() => [...(routes ?? []), { kind: "internet", label: "Pela internet (porta aberta no roteador)", ip: "" }], [routes]);
  const chosen = options.find((r) => r.kind === route) ?? options[0];
  const guests = spec?.slots.filter((s) => s.kind === "guest").length ?? 0;

  const open = async () => {
    if (!spec || !chosen) return;
    setOpening(true);
    try {
      const ip = chosen.kind === "internet" ? await api.partyPublicIp() : chosen.ip;
      onHosted(await api.partyHost(spec, name.trim() || t("Anfitrião"), ip, port));
    } catch (e) {
      useStore.getState().toast("error", errorText(e));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <ol className="invite-steps">
        <li className={guests > 0 ? "done" : ""}>
          <b>{t("Escolha as bases dos amigos")}</b>
          {guests > 0 ? <span className="muted small">{t("{n} vaga(s) para amigos. Quem entrar fica com elas na ordem em que conectar; as que sobrarem viram IA.", { n: guests })}</span> : (
            <span className="muted small">{t("Em \"Quem\", escolha Amigo nas bases dos convidados.")} {spec && <button type="button" className="btn sm text" onClick={markGuests}><Icon name="group" size={15} /> {t("Trocar as IAs do meu time por amigos")}</button>}</span>
          )}
        </li>
        <li>
          <b>{t("Como seus amigos vão se conectar?")}</b>
          <div className="route-list" role="radiogroup" aria-label={t("Como seus amigos vão se conectar?")}>
            {routes === null && <div className="bar indeterminate"><i /></div>}
            {options.map((r) => {
              const on = chosen?.kind === r.kind;
              return (
                <button key={r.kind + r.ip} type="button" role="radio" aria-checked={on} className={`route ${on ? "on" : ""}`} onClick={() => setRoute(r.kind)}>
                  <Icon name={r.kind === "internet" ? "public" : r.kind === "lan" ? "lan" : "vpn_lock"} size={18} />
                  <span>{t(r.label)}</span>
                </button>
              );
            })}
          </div>
          {chosen?.kind === "internet" && <span className="faint small">{t("Abra no roteador a porta {port} (TCP e UDP) para este PC.", { port })}</span>}
          {chosen && ["radmin", "zerotier", "hamachi", "tailscale"].includes(chosen.kind) && <span className="faint small">{t("Os amigos precisam estar na mesma rede da VPN que você.")}</span>}
          <details className="faint small">
            <summary>{t("Avançado")}</summary>
            <div className="row" style={{ gap: 10, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
              <label className="row" style={{ gap: 6 }}>{t("Porta")}
                <input className="input dense" style={{ width: 90 }} type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Math.max(1024, Math.min(65535, Math.round(Number(e.target.value) || DEFAULT_PORT))))} />
              </label>
              {chosen?.ip && <span className="mono">{t("Seu endereço nesta rede: {ip} (só você vê)", { ip: chosen.ip })}</span>}
            </div>
          </details>
        </li>
      </ol>
      <div className="row bm-invite-actions">
        <span className="grow muted small">{t("Os mods que mudam a partida (e o mapa, se for de um mod) vão junto: quem entra baixa do seu PC.")}</span>
        <button className="btn primary" disabled={!spec || guests === 0 || opening || !chosen} onClick={() => void open()}>
          <Icon name="meeting_room" /> {opening ? t("Abrindo a sala…") : t("Abrir sala e criar convite")}
        </button>
      </div>
    </div>
  );
}

function HostRoom({ spec, busy, running, launch, hosted, name, onClose }: Props & { hosted: PartyHosted; name: string; onClose: () => void }) {
  const room = useRoom(hosted.room, () => undefined);
  const guests = room.members.filter((m) => !m.host);
  const ready = guests.filter((m) => m.ready).length;
  const [confirm, setConfirm] = useState(false);
  const start = async () => {
    if (!spec) return;
    room.sendJson({ type: "start" });
    await launch({ ...spec, net: { host: true, port: hosted.port, address: "", name: name.trim() || t("Anfitrião") } }, t("Abrindo o jogo: os amigos entram em seguida."));
  };
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="invite-code">
        <div className="grow col" style={{ gap: 2, minWidth: 0 }}>
          <span className="overline">{t("Convite")}</span>
          <code className="mono" title={t("O convite é cifrado: ele não mostra o seu IP.")}>{hosted.code.slice(0, 18)}…{hosted.code.slice(-6)}</code>
          <span className="faint small">{t("Mande para os amigos (Discord, WhatsApp…). O IP não aparece no convite.")}</span>
        </div>
        <CopyButton text={hosted.code} label={t("Copiar convite")} />
      </div>
      {hosted.mods.length > 0 && <p className="faint small">{t("Vão junto para os amigos: {list}", { list: hosted.mods.map((m) => m[1]).join(", ") })}</p>}
      <RoomPanel room={room} hostView />
      <div className="row bm-invite-actions">
        <button className="btn text" onClick={onClose}><Icon name="close" /> {t("Fechar a sala")}</button>
        <span className="grow muted small">{guests.length === 0 ? t("Esperando os amigos entrarem…") : t("{ready} de {n} pronto(s).", { ready, n: guests.length })}</span>
        {confirm && ready < guests.length && <span className="small warn-text">{t("Quem não estiver pronto fica de fora.")}</span>}
        <button className="btn primary" disabled={!spec || busy || running || ready === 0} onClick={() => {
          if (ready < guests.length && !confirm) { setConfirm(true); return; }
          void start();
        }}>
          <Icon name="play_arrow" /> {confirm && ready < guests.length ? t("Começar mesmo assim") : t("Começar a partida")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- quem entra

function JoinSetup({ maps, name, onJoin }: Props & { name: string; onJoin: (code: string, info: PartyJoined) => void }) {
  const [paste, setPaste] = useState("");
  const [info, setInfo] = useState<PartyJoined | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const read = async (text: string) => {
    setPaste(text);
    setInfo(null);
    setProblem(null);
    if (!text.trim()) return;
    setReading(true);
    try { setInfo(await api.partyRead(text, name)); } catch (e) { setProblem(errorText(e)); } finally { setReading(false); }
  };
  const map = info ? maps.find((m) => m.path.toLowerCase() === info.game.map.toLowerCase()) : undefined;
  const toGet = info?.mods.filter((m) => m.status !== "ok") ?? [];
  // o mapa pode vir num mod do anfitrião (ele chega com o download)
  const mapComing = !map && toGet.length > 0;
  const guests = info?.game.slots.filter((s) => s.kind === "guest") ?? [];
  return (
    <div className="col" style={{ gap: 12 }}>
      <Field label={t("Código do convite")}>
        <textarea className="input mono bm-invite-paste" rows={2} value={paste} placeholder="CPM2.…" onChange={(e) => void read(e.target.value)} spellCheck={false} />
      </Field>
      {reading && <div className="bar indeterminate"><i /></div>}
      {problem && <Notice kind="warn">{problem}</Notice>}
      {info && (
        <div className="invite-summary">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="chip ok"><Icon name="person" size={14} /> {t("Sala de {host}", { host: info.host })}</span>
            <span className="chip"><Icon name="map" size={14} /> {map?.name ?? info.game.map.split("/")[2]}</span>
            <span className="chip"><Icon name="groups" size={14} /> {t("{n} jogadores", { n: info.game.slots.filter((s) => s.kind !== "empty").length })}</span>
            <span className="chip"><Icon name="group_add" size={14} /> {t("{n} na sala de {cap}", { n: Math.max(0, info.members - 1), cap: info.capacity })}</span>
          </div>
          {guests.length > 0 && <p className="faint small">{t("Facções das vagas: {list}", { list: guests.map((s) => t(FACES[s.faction] ?? "Aleatória")).join(", ") })}</p>}
          {toGet.length > 0 ? (
            <p className="small"><Icon name="download" size={15} /> {t("Vai baixar do PC de {host}: {list} ({size}).", { host: info.host, list: toGet.map((m) => m.name).join(", "), size: fmtSize(info.download) })}</p>
          ) : <p className="small ok-text"><Icon name="check" size={15} /> {t("Você já tem tudo o que a partida usa.")}</p>}
          {!map && !mapComing && <Notice kind="warn">{t("O mapa desta partida não foi encontrado nem nos mods do anfitrião. Peça o mapa para quem convidou.")}</Notice>}
          {info.started && <Notice kind="warn">{t("A partida já começou.")}</Notice>}
        </div>
      )}
      <div className="row bm-invite-actions">
        <span className="grow muted small">{t("Você entra na sala, baixa o que faltar e o jogo abre sozinho quando o anfitrião começar.")}</span>
        <button className="btn primary" disabled={!info || info.started || (!map && !mapComing)} onClick={() => info && onJoin(paste, info)}>
          <Icon name="login" /> {t("Entrar na sala")}
        </button>
      </div>
    </div>
  );
}

function GuestRoom({ busy, running, launch, code, info, name, onLeave }: Props & { code: string; info: PartyJoined; name: string; onLeave: () => void }) {
  const [phase, setPhase] = useState<"download" | "ready" | "error">("download");
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const progress = useStore((s) => s.progress.party);
  const launchRef = useRef(launch);
  launchRef.current = launch;
  const join = () => launchRef.current({ ...info.game, net: { host: false, port: 0, address: info.address, name: name.trim() || t("Amigo") } }, t("Entrando na partida de {host}…", { host: info.host }));
  const room = useRoom(info.room, () => {
    setLaunched((was) => {
      if (!was) void join();
      return true;
    });
  });
  const report = room.report;
  // baixa e instala o que falta (e monta o perfil com os mods do anfitrião), avisando a sala
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        report({ ready: false, progress: 0 });
        await api.partyPrepare(code, info.mods);
        await useStore.getState().refresh();
        if (!alive) return;
        setPhase("ready");
        report({ ready: true, progress: 1 });
      } catch (e) {
        if (!alive) return;
        setPhase("error");
        setError(errorText(e));
      }
    })();
    return () => { alive = false; };
  }, [code, info.mods, report]);
  useEffect(() => {
    if (progress && phase === "download") report({ progress: progress.step / Math.max(1, progress.total) });
  }, [progress, phase, report]);

  return (
    <div className="col" style={{ gap: 14 }}>
      {phase === "download" && <TaskProgress task="party" label={t("Preparando os mods da partida…")} />}
      {phase === "ready" && <Notice kind="ok">{launched ? t("O jogo está abrindo na partida de {host}.", { host: info.host }) : t("Tudo pronto. O jogo abre sozinho quando {host} começar a partida — deixe o launcher aberto.", { host: info.host })}</Notice>}
      {phase === "error" && <Notice kind="err">{t("Não deu para baixar os mods: {error}", { error: error ?? "" })}</Notice>}
      {(room.status === "closed" || room.status === "kicked") && !launched && <Notice kind="warn">{room.status === "kicked" ? t("O anfitrião tirou você da sala.") : t("A sala fechou.")}</Notice>}
      <RoomPanel room={room} hostView={false} />
      <div className="row bm-invite-actions">
        <button className="btn text" onClick={onLeave}><Icon name="logout" /> {t("Sair da sala")}</button>
        <span className="grow" />
        {launched && !running && !busy && (
          <button className="btn" onClick={() => void join()}><Icon name="replay" /> {t("Abrir o jogo de novo")}</button>
        )}
      </div>
    </div>
  );
}
