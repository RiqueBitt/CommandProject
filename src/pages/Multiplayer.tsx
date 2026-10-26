import { useCallback, useEffect, useRef, useState } from "react";
import { CopyButton, Empty, Field, Icon, Modal, monogram, Notice } from "../components/ui";
import { api } from "../lib/api";
import { locale, t } from "../lib/i18n";
import { community, OFFLINE_TEXT, useChat, useHosting } from "../lib/community";
import { useStore } from "../lib/store";
import type { HubIndex, Room, ServerInfo, SyncItem, SyncPayload } from "../lib/types";
import { NickModal } from "./Me";

type Tab = "rooms" | "codes";

export default function Multiplayer() {
  const settings = useStore((s) => s.settings);
  const base = settings?.serverUrl ?? null;
  const nick = settings?.nickname?.trim() ?? "";
  const hosting = useHosting();
  const [tab, setTab] = useState<Tab>(base ? "rooms" : "codes");
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [infoErr, setInfoErr] = useState<string | null>(null);
  const [joined, setJoined] = useState<Room | null>(null);
  const [channel, setChannel] = useState("global");
  const [editNick, setEditNick] = useState(false);
  const chat = useChat(base, nick, channel);
  const global = useChat(channel === "global" ? null : base, nick, "global"); // presença do canal geral

  useEffect(() => {
    if (!base) return;
    community.info(base).then((i) => { setInfo(i); setInfoErr(null); }).catch((e) => setInfoErr(e.message));
  }, [base]);

  const roomChannel = hosting.room?.id ?? joined?.id ?? null;
  useEffect(() => {
    if (channel !== "global" && channel !== roomChannel) setChannel("global");
  }, [roomChannel, channel]);
  const online = channel === "global" ? chat.users : global.users;

  return (
    <>
      <aside className="side-panel">
        <div className="card pad col" style={{ gap: 8 }}>
          <div className="row"><Icon name="dns" style={{ color: "var(--primary)" }} /><b style={{ flex: 1 }}>{info?.name ?? t("Servidor da comunidade")}</b></div>
          {!base ? <p className="small muted">{t("Nenhum servidor configurado.")}</p> : info ? (
            <>
              {info.motd && <p className="small muted">{info.motd}</p>}
              <div className="row small"><span className="dot ok" /> {t("conectado, {n} sala(s)", { n: info.rooms })}</div>
            </>
          ) : <div className="row small muted"><span className="dot err" /> {infoErr ?? t("Conectando…")}</div>}
        </div>
        <div className="card pad row" style={{ gap: 12 }}>
          <span className="avatar">{monogram(nick || t("Você"))}</span>
          <div style={{ flex: 1, minWidth: 0 }}><b>{nick || t("Sem apelido")}</b><div className="small muted">{t("seu apelido")}</div></div>
          <button className="btn icon-btn sm" aria-label={t("Editar apelido")} onClick={() => setEditNick(true)}><Icon name="edit" size={18} /></button>
        </div>
        {base && (
          <div className="group">
            <div className="overline">{t("Online agora ({n})", { n: online.length })}</div>
            {online.length === 0 ? <p className="small faint">{t("Ninguém no chat geral.")}</p> : online.slice(0, 60).map((u) => (
              <div key={u} className="user-line"><span className="avatar">{monogram(u)}</span>{u}</div>
            ))}
          </div>
        )}
      </aside>

      <div className="scroll">
        <div className="page">
          <div className="head">
            <div className="grow">
              <h1 className="page-title">{t("Multiplayer")}</h1>
              {useStore.getState().settings?.offline && <div style={{ marginTop: 8 }}><Notice kind="info">{t(OFFLINE_TEXT)}</Notice></div>}
              <p className="muted" style={{ marginTop: 6, maxWidth: "75ch" }}>
                {t("A partida acontece no lobby da Steam. Aqui você encontra gente para jogar, copia o perfil de mods de quem hospeda e confere se os arquivos estão idênticos — senão o SC2 dessincroniza.")}
              </p>
            </div>
          </div>
          <div className="tabs" role="tablist">
            <button role="tab" className="tab" aria-selected={tab === "rooms"} onClick={() => setTab("rooms")}>{t("Salas e chat")}</button>
            <button role="tab" className="tab" aria-selected={tab === "codes"} onClick={() => setTab("codes")}>{t("Códigos e assinatura")}</button>
          </div>
          {tab === "rooms" ? (
            !base ? (
              <div className="card"><Empty icon="hub" title={t("Conecte a um servidor da comunidade")} action={<button className="btn primary" onClick={() => useStore.getState().openSettings("comunidade")}>{t("Configurar servidor")}</button>}>
                {t("O servidor (cp-server) mostra as salas abertas, tem chat e pode publicar um hub de mods. Qualquer pessoa pode hospedar um.")}
              </Empty></div>
            ) : nick.length < 2 ? (
              <div className="card"><Empty icon="badge" title={t("Escolha um apelido")} action={<button className="btn primary" onClick={() => setEditNick(true)}>{t("Definir apelido")}</button>}>{t("É como você aparece nas salas e no chat.")}</Empty></div>
            ) : (
              <div className="mp">
                <Rooms base={base} nick={nick} joined={joined} onJoined={(r) => { setJoined(r); if (r) setChannel(r.id); }} />
                <section className="card chat">
                  <div className="viewer-head">
                    <Icon name="forum" style={{ color: "var(--primary)" }} />
                    <select className="select dense" style={{ flex: 1 }} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t("Canal")}>
                      <option value="global">{t("Chat geral")}</option>
                      {roomChannel && <option value={roomChannel}>{t("Sala {name}", { name: hosting.room?.name ?? joined?.name })}</option>}
                    </select>
                    <span className={`dot ${chat.state === "online" ? "ok" : chat.state === "connecting" ? "warn" : "err"}`} title={chat.state === "online" ? t("conectado") : chat.state === "connecting" ? t("Conectando…") : t("desconectado")} />
                  </div>
                  <ChatBody chat={chat} />
                </section>
              </div>
            )
          ) : <Codes />}
        </div>
      </div>
      {editNick && <NickModal onClose={() => setEditNick(false)} />}
    </>
  );
}

function ChatBody({ chat }: { chat: ReturnType<typeof useChat> }) {
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat.messages.length]);
  return (
    <>
      <div className="msgs" aria-live="polite">
        {chat.messages.length === 0 && <Empty icon="forum" title={t("Tudo quieto por aqui")}>{t("Ninguém falou nada ainda. Diga oi!")}</Empty>}
        {chat.messages.map((m, i) => (
          <div key={i} className="msg"><b>{m.nick}</b>{m.text}<time>{new Date(m.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })}</time></div>
        ))}
        <div ref={end} />
      </div>
      {chat.notice && <div style={{ padding: "0 10px" }}><Notice kind="warn">{chat.notice}</Notice></div>}
      <form onSubmit={(e) => { e.preventDefault(); if (chat.send(text)) setText(""); }}>
        <input className="input dense" style={{ flex: 1 }} maxLength={500} placeholder={chat.state === "online" ? t("Mensagem") : t("Conectando…")} value={text} onChange={(e) => setText(e.target.value)} aria-label={t("Mensagem")} />
        <button className="btn primary icon-btn" style={{ borderRadius: 8 }} disabled={chat.state !== "online" || !text.trim()} aria-label={t("Enviar")}><Icon name="send" size={19} /></button>
      </form>
    </>
  );
}

function Rooms({ base, nick, joined, onJoined }: { base: string; nick: string; joined: Room | null; onJoined: (r: Room | null) => void }) {
  const { run } = useStore.getState();
  const hosting = useHosting();
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [review, setReview] = useState<Room | null>(null);
  const [askPw, setAskPw] = useState<Room | null>(null);

  const load = useCallback(async () => {
    try {
      setRooms(await community.rooms(base));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [base]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  const join = async (r: Room, password?: string) => {
    const full = await run("join", () => community.join(base, r.id, nick, password));
    if (full) {
      onJoined(full);
      setReview(full);
      setAskPw(null);
      void load();
    }
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      {hosting.room && (
        <section className="card pad col" style={{ gap: 10, boxShadow: "inset 0 0 0 1px var(--primary)" }}>
          <div className="row"><Icon name="cell_tower" style={{ color: "var(--primary)" }} /><h3 style={{ flex: 1 }}>{t("Sua sala: {name}", { name: hosting.room.name })}</h3><span className="chip ok">{t("código {code}", { code: hosting.room.id })}</span></div>
          <div className="players">{hosting.room.players.map((p) => <span key={p} className="chip">{p}</span>)}<span className="faint small">{hosting.room.players.length}/{hosting.room.maxPlayers}</span></div>
          {hosting.error && <Notice kind="warn">{hosting.error}</Notice>}
          <div className="row wrap">
            <button className="btn sm" onClick={async () => {
              const status = hosting.room!.status === "aguardando" ? "em partida" : "aguardando";
              const r = await run("status", () => community.update(base, hosting.room!.id, hosting.token!, { status }));
              if (r) hosting.setRoom(r);
            }}><Icon name={hosting.room.status === "aguardando" ? "play_arrow" : "pause"} /> {hosting.room.status === "aguardando" ? t("Marcar “em partida”") : t("Voltar a aguardar")}</button>
            <button className="btn sm" onClick={async () => {
              const syncCode = await run("code", () => api.exportSyncCode());
              const fp = await api.fingerprint().catch(() => null);
              if (!syncCode) return;
              const r = await run("upd", () => community.update(base, hosting.room!.id, hosting.token!, { syncCode, fingerprint: fp?.code }), t("Sala atualizada com o seu perfil atual."));
              if (r) hosting.setRoom(r);
            }}><Icon name="sync" /> {t("Atualizar perfil da sala")}</button>
            <span className="spacer" />
            <button className="btn sm danger" onClick={() => hosting.stop()}><Icon name="close" /> {t("Fechar sala")}</button>
          </div>
        </section>
      )}
      {joined && !hosting.room && (
        <Notice kind="info">{t("Você está na sala")} <b>{joined.name}</b>. <button className="btn sm text" onClick={() => setReview(joined)}>{t("Conferir mods")}</button> <button className="btn sm text" onClick={async () => { await community.leave(base, joined.id, nick).catch(() => {}); onJoined(null); void load(); }}>{t("Sair")}</button></Notice>
      )}
      <div className="section-head" style={{ marginBottom: 0 }}>
        <Icon name="meeting_room" />
        <h2>{t("Salas abertas")}</h2>
        <button className="btn sm text" onClick={load}><Icon name="refresh" /></button>
        {!hosting.room && <button className="btn primary sm" onClick={() => setCreating(true)}><Icon name="add" /> {t("Criar sala")}</button>}
      </div>
      {err ? (
        <div className="card"><Empty icon="cloud_off" title={t("Sem conexão com o servidor")}
          action={<div className="row"><button className="btn" onClick={load}><Icon name="refresh" /> {t("Tentar de novo")}</button><button className="btn text" onClick={() => useStore.getState().openSettings("comunidade")}><Icon name="dns" /> {t("Configurar servidor")}</button></div>}>
          {err} {t("As partidas continuam pelo lobby da Steam; salas e chat voltam quando o servidor responder.")}
        </Empty></div>
      ) : rooms === null ? <div className="bar indeterminate"><i /></div> : rooms.length === 0 ? (
        <div className="card"><Empty icon="weekend" title={t("Nenhuma sala aberta")}>{t("Crie uma e chame a galera pelo chat.")}</Empty></div>
      ) : (
        <div className="room-grid">
          {rooms.map((r) => (
            <article key={r.id} className="card room">
              <div className="row">
                {r.private && <Icon name="lock" size={18} style={{ color: "var(--warn)" }} />}
                <b style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</b>
                <span className={`chip ${r.status === "aguardando" ? "ok" : "warn"}`}>{t(r.status)}</span>
              </div>
              <div className="small muted row" style={{ gap: 4 }}><Icon name="person" size={15} /> {t("{host}, {n}/{max} jogadores", { host: r.host, n: r.players.length, max: r.maxPlayers })}</div>
              <div className="small faint" style={{ minHeight: 38 }}>{r.mods.length ? r.mods.slice(0, 3).join(", ") + (r.mods.length > 3 ? ` +${r.mods.length - 3}` : "") : t("Sem mods (jogo original)")}</div>
              <div className="row">
                {r.fingerprint && <span className="chip" title={t("Assinatura da pasta de quem hospeda")}><Icon name="fingerprint" /> {r.fingerprint}</span>}
                <span className="spacer" />
                {hosting.room?.id === r.id ? <span className="chip ok">{t("sua")}</span> : (
                  <button className="btn sm tonal" disabled={r.players.length >= r.maxPlayers && !r.players.includes(nick)} onClick={() => (r.private ? setAskPw(r) : join(r))}>{t("Entrar")}</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {creating && <CreateRoom base={base} nick={nick} onClose={() => setCreating(false)} onCreated={load} />}
      {askPw && <PasswordModal room={askPw} onClose={() => setAskPw(null)} onSubmit={(pw) => join(askPw, pw)} />}
      {review?.syncCode && <SyncReviewModal code={review.syncCode} expected={review.fingerprint ?? undefined} title={t("Mods da sala {name}", { name: review.name })} onClose={() => setReview(null)} />}
    </div>
  );
}

function CreateRoom({ base, nick, onClose, onCreated }: { base: string; nick: string; onClose: () => void; onCreated: () => void }) {
  const { run } = useStore.getState();
  const d = useStore((s) => s.dashboard);
  const busy = useStore((s) => s.busy.room);
  const [name, setName] = useState(() => t("Sala de {nick}", { nick }));
  const [max, setMax] = useState(4);
  const [pw, setPw] = useState("");
  return (
    <Modal title={t("Criar sala")} icon="meeting_room" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("room", async () => {
          const syncCode = await api.exportSyncCode();
          const fp = await api.fingerprint().catch(() => null);
          return community.create(base, { name: name.trim(), nick, syncCode, fingerprint: fp?.code, maxPlayers: max, password: pw.trim() || undefined });
        }, t("Sala criada. Quem entrar recebe o seu perfil de mods."));
        if (r) {
          useHosting.getState().start(base, r.room, r.token);
          onCreated();
          onClose();
        }
      }}>
        <Field label={t("Nome da sala")}><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label={t("Jogadores")}><select className="select" value={max} onChange={(e) => setMax(Number(e.target.value))}>{[2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label={t("Senha (opcional)")} hint={t("Sala privada esconde o perfil de quem não tem a senha.")}><input className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        </div>
        <Notice kind="info">{t("A sala leva o perfil")} <b>{d?.activeProfileName}</b> {t("({n} mods) e a assinatura da sua pasta.", { n: d?.enabledMods ?? 0 })}{d && !d.inSync ? " " + t("Aplique o perfil antes para a assinatura bater com a dos outros.") : ""}</Notice>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" disabled={busy || name.trim().length < 3}>{t("Criar sala")}</button></footer>
      </form>
    </Modal>
  );
}

function PasswordModal({ room, onClose, onSubmit }: { room: Room; onClose: () => void; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <Modal title={t("Entrar em {name}", { name: room.name })} icon="lock" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }}>
        <Field label={t("Senha da sala")}><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <footer><button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button><button className="btn primary" disabled={!pw}>{t("Entrar")}</button></footer>
      </form>
    </Modal>
  );
}

/** Confere um código de perfil: o que eu tenho, o que falta, baixa do hub e aplica. */
function SyncReview({ code, expected, onDone }: { code: string; expected?: string; onDone?: () => void }) {
  const { run, refresh, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const [data, setData] = useState<{ payload: SyncPayload; items: SyncItem[] } | null>(null);
  const [hubs, setHubs] = useState<HubIndex[] | null>(null);
  const [mine, setMine] = useState<string | null>(null);

  const inspect = useCallback(async () => {
    const r = await run("inspect", () => api.inspectSyncCode(code));
    setData(r ?? null);
    if (r?.items.some((i) => i.state !== "ok" && i.hubId)) setHubs((await run("hubs", () => api.hubFetch()))?.indexes ?? []);
  }, [code, run]);
  useEffect(() => { void inspect(); }, [inspect]);

  if (!data) return <div className="bar indeterminate"><i /></div>;
  const allOk = data.items.every((i) => i.state === "ok");
  const installFromHub = async (item: SyncItem) => {
    const idx = hubs?.find((h) => h.mods.some((m) => m.id === item.hubId && m.versions.some((v) => v.version === item.version)));
    if (!idx) {
      useStore.getState().toast("error", t("{name} {version} não está nos hubs que você usa. Peça o arquivo ou o link para quem hospeda.", { name: item.name, version: item.version }));
      return;
    }
    await run("hub:" + item.hubId, () => api.hubInstall(idx.sourceUrl, item.hubId!, item.version, false), t("{name} {version} instalado.", { name: item.name, version: item.version }));
    await refreshMods();
    await inspect();
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <p><b>{data.payload.profile}</b> <span className="muted">{t("— {n} mod(s)", { n: data.items.length })}</span></p>
      <div className="list">
        {data.items.length === 0 && <p className="muted small">{t("Perfil sem mods: o jogo original.")}</p>}
        {data.items.map((i) => (
          <div key={i.id} className="list-row">
            <span className={`dot ${i.state === "ok" ? "ok" : i.state === "different" ? "warn" : "err"}`} />
            <div className="grow">
              <div className="title">{i.name} <span className="faint" style={{ fontWeight: 400 }}>{i.version}</span></div>
              <div className="sub">{i.state === "ok" ? t("Você tem exatamente esta versão.") : i.state === "different" ? t("Você tem a {version} com arquivos diferentes.", { version: i.installedVersion }) : t("Você não tem este mod.")}</div>
            </div>
            {i.state !== "ok" && i.hubId && <button className="btn sm tonal" disabled={busy["hub:" + i.hubId]} onClick={() => installFromHub(i)}>{t("Baixar do hub")}</button>}
          </div>
        ))}
      </div>
      {!allOk && <Notice kind="warn">{t("Instale os mods que faltam antes de jogar — sem eles a partida não abre ou dessincroniza.")}</Notice>}
      {mine && expected && (mine === expected ? <Notice kind="ok">{t("Assinatura igual à de quem hospeda ({mine}). Pode entrar no lobby.", { mine })}</Notice> : <Notice kind="err">{t("Sua assinatura ({mine}) é diferente da de quem hospeda ({expected}). Os arquivos não estão idênticos.", { mine, expected })}</Notice>)}
      <div className="row wrap">
        <button className="btn primary" disabled={busy.applycode || !allOk} onClick={async () => {
          const r = await run("applycode", async () => {
            const res = await api.applySyncCode(code);
            await api.applyActive();
            return res;
          }, t("Perfil criado e aplicado na pasta do jogo."));
          if (r) {
            await refresh();
            if (expected) setMine((await api.fingerprint().catch(() => null))?.code ?? null);
            onDone?.();
          }
        }}><Icon name="done_all" /> {t("Usar este perfil e aplicar")}</button>
        {expected && <span className="faint small">{t("Depois de aplicar, a assinatura é comparada com a de quem hospeda.")}</span>}
      </div>
    </div>
  );
}

function SyncReviewModal({ code, expected, title, onClose }: { code: string; expected?: string; title: string; onClose: () => void }) {
  return (
    <Modal title={title} icon="sync_alt" onClose={onClose} wide>
      <SyncReview code={code} expected={expected} />
      <footer><button className="btn text" onClick={onClose}>{t("Fechar")}</button></footer>
    </Modal>
  );
}

function Codes() {
  const profiles = useStore((s) => s.profiles);
  const d = useStore((s) => s.dashboard);
  const busy = useStore((s) => s.busy);
  const { run } = useStore.getState();
  const [fp, setFp] = useState<string | null>(null);
  const [profile, setProfile] = useState<string>(profiles?.active ?? "");
  const [code, setCode] = useState<string | null>(null);
  const [incoming, setIncoming] = useState("");
  const [checking, setChecking] = useState<string | null>(null);

  return (
    <>
      <div className="grid">
        <section className="card pad col">
          <div className="card-title"><Icon name="fingerprint" style={{ color: "var(--primary)" }} /><h3>{t("Assinatura da sua pasta")}</h3></div>
          <p className="muted small">{t("Mesma assinatura = mesmos arquivos = partida sem dessincronizar. Confira com todos antes de criar o lobby.")}</p>
          {fp ? <div className="code-box"><span style={{ flex: 1 }}>{fp}</span><CopyButton text={fp} /></div> : (
            <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy.fp} onClick={async () => setFp((await run("fp", () => api.fingerprint()))?.code ?? null)}>
              {busy.fp ? t("Calculando (a primeira vez demora)…") : t("Calcular assinatura")}
            </button>
          )}
          {d && !d.inSync && <Notice kind="warn">{t("O perfil ativo tem alterações não aplicadas — aplique antes de comparar.")}</Notice>}
        </section>
        <section className="card pad col">
          <div className="card-title"><Icon name="share" style={{ color: "var(--primary)" }} /><h3>{t("Compartilhar um perfil")}</h3></div>
          <Field label={t("Perfil")}>
            <select className="select" value={profile} onChange={(e) => { setProfile(e.target.value); setCode(null); }}>
              {profiles?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {code ? (
            <>
              <textarea className="textarea mono" readOnly rows={3} value={code} onFocus={(e) => e.target.select()} aria-label={t("Código do perfil")} />
              <div className="row"><CopyButton text={code} /><span className="faint small">{t("Mande no chat, no lobby ou no Discord.")}</span></div>
            </>
          ) : <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy.code} onClick={async () => setCode((await run("code", () => api.exportSyncCode(profile))) ?? null)}>{t("Gerar código")}</button>}
        </section>
      </div>
      <section className="card pad col">
        <div className="card-title"><Icon name="content_paste" style={{ color: "var(--primary)" }} /><h3>{t("Usar o perfil de um amigo")}</h3></div>
        <div className="row" style={{ alignItems: "stretch" }}>
          <textarea className="textarea mono" style={{ flex: 1 }} rows={2} placeholder={t("Cole aqui o código CP1-…")} value={incoming} onChange={(e) => { setIncoming(e.target.value); setChecking(null); }} aria-label={t("Código recebido")} />
          <button className="btn" disabled={!incoming.trim().startsWith("CP1-")} onClick={() => setChecking(incoming.trim())}>{t("Conferir")}</button>
        </div>
        {checking && <SyncReview key={checking} code={checking} />}
      </section>
    </>
  );
}
