// Partida grande com amigos: o anfitrião gera um código de convite (endereço + partida + mods) e
// manda por onde quiser; quem recebe cola o código e o jogo dele conecta direto no do anfitrião.
// Nada fica guardado em servidor: o código carrega tudo o que é preciso.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import type { BigMatch, InviteCheck, MatchMap } from "../lib/types";
import { CopyButton, Field, Icon, Notice } from "./ui";

const DEFAULT_PORT = 15000;

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function keep(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* ok */ }
}

const FACES = ["?", "UEF", "Cybran", "Illuminate"];

interface Props {
  /** a partida montada na tela (null = ainda com erro) */
  spec: BigMatch | null;
  maps: MatchMap[];
  busy: boolean;
  running: boolean;
  /** abre o jogo (como anfitrião ou entrando no convite) */
  launch: (spec: BigMatch, label: string) => Promise<void>;
  /** marca as vagas de IA como amigos (atalho para quem ainda não marcou nenhuma) */
  markGuests: () => void;
}

export default function MatchInvite({ spec, maps, busy, running, launch, markGuests }: Props) {
  const [tab, setTab] = useState<"host" | "join">(() => (stored("cp-invite-tab", "host") === "join" ? "join" : "host"));
  const [name, setName] = useState(() => stored("cp-player-name", ""));
  const [port, setPort] = useState(() => Number(stored("cp-invite-port", String(DEFAULT_PORT))) || DEFAULT_PORT);
  const [ip, setIp] = useState(() => stored("cp-invite-ip", ""));
  const [code, setCode] = useState("");
  const [paste, setPaste] = useState("");
  const [check, setCheck] = useState<InviteCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => { keep("cp-invite-tab", tab); }, [tab]);
  useEffect(() => { keep("cp-player-name", name); }, [name]);
  useEffect(() => { keep("cp-invite-port", String(port)); }, [port]);
  useEffect(() => { keep("cp-invite-ip", ip); }, [ip]);
  // o endereço deste PC na rede (dá para trocar pelo da VPN, como Radmin ou ZeroTier)
  useEffect(() => { if (!ip) void api.bigMatchAddress().then((a) => a && setIp(a)).catch(() => undefined); }, [ip]);

  const guests = spec?.slots.filter((s) => s.kind === "guest").length ?? 0;
  const address = `${ip.trim()}:${port}`;
  const who = name.trim() || t("Anfitrião");
  // o código fica velho quando a partida muda
  const specKey = JSON.stringify(spec);
  useEffect(() => { setCode(""); }, [specKey, ip, port, name]);

  const makeCode = async () => {
    if (!spec) return;
    try {
      setCode(await api.bigMatchInvite(spec, address, who));
    } catch (e) {
      useStore.getState().toast("error", String(e));
    }
  };

  const read = async (text: string) => {
    setPaste(text);
    setCheck(null);
    setProblem(null);
    if (!text.trim()) return;
    try {
      setCheck(await api.bigMatchReadInvite(text));
    } catch (e) {
      setProblem(String(e));
    }
  };

  const inv = check?.invite;
  const invMap = inv ? maps.find((m) => m.path.toLowerCase() === inv.game.map.toLowerCase()) : undefined;
  const invGuests = inv?.game.slots.filter((s) => s.kind === "guest") ?? [];
  const invPlayers = inv?.game.slots.filter((s) => s.kind !== "empty").length ?? 0;

  return (
    <section className="card pad bm-invite">
      <div className="card-title">
        <Icon name="group_add" /><h3>{t("Jogar com amigos")}</h3>
        <span className="chip" title={t("Funciona na mesma rede, por VPN (Radmin VPN, ZeroTier, Hamachi) ou com a porta aberta no roteador de quem convida.")}>{t("experimental")}</span>
        <span className="grow" />
        <div className="seg" role="tablist" aria-label={t("Jogar com amigos")}>
          <button type="button" role="tab" className="btn sm" aria-pressed={tab === "host"} onClick={() => setTab("host")}><Icon name="share" size={15} /> {t("Convidar")}</button>
          <button type="button" role="tab" className="btn sm" aria-pressed={tab === "join"} onClick={() => setTab("join")}><Icon name="login" size={15} /> {t("Entrar com convite")}</button>
        </div>
      </div>

      <div className="bm-invite-row">
        <Field label={t("Seu nome no jogo")}>
          <input className="input" value={name} maxLength={24} placeholder={t("Comandante")} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>

      {tab === "host" ? (
        <div className="col" style={{ gap: 12 }}>
          {guests === 0 ? (
            <Notice kind="info">
              {t("Em \"Quem\", escolha Amigo nas bases dos convidados. Quem entrar fica com essas bases na ordem em que conectar; as que sobrarem viram IA.")}
              {spec && <button type="button" className="btn sm" style={{ marginLeft: 10 }} onClick={markGuests}><Icon name="group" size={15} /> {t("Trocar as IAs do meu time por amigos")}</button>}
            </Notice>
          ) : (
            <p className="muted small">{t("{n} vaga(s) para amigos. A partida começa sozinha quando todos entrarem, ou aperte ENTER no jogo para começar antes (as vagas livres viram IA).", { n: guests })}</p>
          )}
          <div className="bm-invite-row">
            <Field label={t("Endereço para os amigos")} hint={t("O IP deste PC na rede. Por VPN, use o IP que a VPN mostra; pela internet, o IP público com a porta aberta (UDP) no roteador.")}>
              <input className="input mono" value={ip} placeholder="192.168.0.10" onChange={(e) => setIp(e.target.value.trim())} />
            </Field>
            <Field label={t("Porta (UDP)")}>
              <input className="input" type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Math.max(1024, Math.min(65535, Math.round(Number(e.target.value) || DEFAULT_PORT))))} />
            </Field>
          </div>
          {code ? (
            <div className="bm-invite-code">
              <code className="mono" title={code}>{code}</code>
              <CopyButton text={code} label={t("Copiar convite")} />
            </div>
          ) : (
            <button type="button" className="btn" disabled={!spec || guests === 0 || !ip} onClick={() => void makeCode()}><Icon name="link" /> {t("Criar convite")}</button>
          )}
          <div className="row bm-invite-actions">
            <span className="grow muted small">{t("Mande o convite (Discord, WhatsApp…) e abra o jogo: ele espera os amigos numa tela própria.")}</span>
            <button className="btn primary" disabled={!spec || guests === 0 || !ip || busy || running}
              onClick={() => spec && void launch({ ...spec, net: { host: true, port, address: "", name: who } }, t("Abrindo o jogo e esperando os amigos na porta {port}.", { port }))}>
              <Icon name="wifi_tethering" /> {t("Abrir e esperar amigos")}
            </button>
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: 12 }}>
          <Field label={t("Código do convite")}>
            <textarea className="input mono bm-invite-paste" rows={3} value={paste} placeholder="CPM1.…" onChange={(e) => void read(e.target.value)} spellCheck={false} />
          </Field>
          {problem && <Notice kind="warn">{problem}</Notice>}
          {inv && (
            <div className="bm-invite-summary">
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <span className="chip ok"><Icon name="person" size={14} /> {inv.host}</span>
                <span className="chip"><Icon name="map" size={14} /> {invMap?.name ?? inv.game.map.split("/")[2]}</span>
                <span className="chip"><Icon name="groups" size={14} /> {t("{n} jogadores", { n: invPlayers })}</span>
                <span className="chip"><Icon name="group_add" size={14} /> {t("{n} vaga(s) para amigos", { n: invGuests.length })}</span>
                <span className="chip mono">{inv.address}</span>
              </div>
              {invGuests.length > 0 && (
                <p className="faint small">{t("Facções das vagas: {list}", { list: invGuests.map((s) => FACES[s.faction] ?? "?").join(", ") })}</p>
              )}
              {!invMap && <Notice kind="warn">{t("Você não tem este mapa. Peça o arquivo do mapa para quem convidou e instale antes de entrar.")}</Notice>}
              {check.missing.length > 0 && (
                <Notice kind="warn">
                  {t("Mods do anfitrião desligados ou faltando aqui: {list}", { list: check.missing.map((m) => m[1]).join(", ") })}
                  <button type="button" className="btn sm" style={{ marginLeft: 10 }} onClick={async () => {
                    const left = await api.bigMatchMatchMods(check.missing.map((m) => m[0]));
                    if (left.length) useStore.getState().toast("error", t("Instale antes: {list}", { list: left.join(", ") }));
                    await read(paste);
                  }}><Icon name="toggle_on" size={15} /> {t("Ligar os que tenho")}</button>
                </Notice>
              )}
              {check.extra.length > 0 && (
                <p className="faint small">{t("Mods ligados aqui que o anfitrião não usa (podem dessincronizar a partida): {list}", { list: check.extra.map((m) => m[1]).join(", ") })}</p>
              )}
            </div>
          )}
          <div className="row bm-invite-actions">
            <span className="grow muted small">{t("O jogo abre numa tela de espera e entra quando o anfitrião começar.")}</span>
            <button className="btn primary" disabled={!inv || !invMap || busy || running}
              onClick={() => inv && void launch({ ...inv.game, net: { host: false, port: 0, address: inv.address, name: name.trim() || t("Amigo") } }, t("Entrando na partida de {host}…", { host: inv.host }))}>
              <Icon name="login" /> {t("Entrar na partida")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
