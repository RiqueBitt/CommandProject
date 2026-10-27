// A sala de convite na tela: quem está (pronto, baixando, falando), chat e voz.
import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { microphones } from "../lib/voice";
import type { Room } from "../lib/room";
import { Icon } from "./ui";

/** Teclas para falar e para o mudo: funcionam com o jogo na frente (atalho do sistema). */
const PTT_KEYS = ["Alt+V", "Alt+Q", "Ctrl+Alt+T", "F12", "CapsLock"];
const MUTE_KEY = "Alt+M";

function stored(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

/** Liga os atalhos globais (aperte para falar e mudo) enquanto a voz está ligada. */
function useShortcuts(room: Room, pttKey: string) {
  const v = room.voice;
  const mutedRef = useRef(v.muted);
  mutedRef.current = v.muted;
  const ref = useRef(v);
  ref.current = v;
  useEffect(() => {
    if (!v.on) return;
    let off = false;
    const keys: string[] = [];
    void (async () => {
      try {
        const gs = await import("@tauri-apps/plugin-global-shortcut");
        if (off) return;
        await gs.register(MUTE_KEY, (e) => { if (e.state === "Pressed") ref.current.setMute(!mutedRef.current); });
        keys.push(MUTE_KEY);
        if (v.mode === "ptt") {
          await gs.register(pttKey, (e) => ref.current.setPtt(e.state === "Pressed"));
          keys.push(pttKey);
        }
      } catch { /* fora do launcher (prévia no navegador) ou tecla em uso */ }
    })();
    return () => {
      off = true;
      void import("@tauri-apps/plugin-global-shortcut").then((gs) => keys.forEach((k) => void gs.unregister(k).catch(() => undefined))).catch(() => undefined);
    };
  }, [v.on, v.mode, pttKey]);
}

export default function RoomPanel({ room, hostView }: { room: Room; hostView: boolean }) {
  const v = room.voice;
  const [msg, setMsg] = useState("");
  const [pttKey, setPttKey] = useState(() => stored("cp-voice-ptt", "Alt+V"));
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState(() => { try { return JSON.parse(localStorage.getItem("cp-voice-mic") ?? "null") ?? ""; } catch { return ""; } });
  const [peerOff, setPeerOff] = useState<Set<number>>(new Set());
  const chatEnd = useRef<HTMLDivElement>(null);
  useShortcuts(room, pttKey);
  useEffect(() => { chatEnd.current?.scrollIntoView({ block: "nearest" }); }, [room.chat.length]);
  useEffect(() => { if (v.on) void microphones().then(setMics); }, [v.on]);

  const guests = room.members.filter((m) => !m.host);
  return (
    <div className="party-room">
      <div className="room-members">
        <div className="room-head">
          <span className={`room-dot ${room.status}`} />
          <b>{room.status === "open" ? t("Na sala") : room.status === "connecting" ? t("Conectando à sala…") : room.status === "kicked" ? t("Você foi removido da sala") : t("A sala fechou")}</b>
          <span className="grow" />
          <span className="muted small">{t("{n} amigo(s)", { n: guests.length })}</span>
        </div>
        <ul>
          {room.members.map((m) => {
            const level = m.id === room.me ? v.myLevel : v.levels.get(m.id) ?? 0;
            const talking = m.talking && !m.muted;
            return (
              <li key={m.id} className={`room-member ${talking ? "talking" : ""}`} style={{ ["--lvl" as string]: String(Math.min(1, level * 2)) }}>
                <span className="avatar">{m.name.slice(0, 1).toUpperCase()}</span>
                <span className="who">
                  <b>{m.name}{m.id === room.me ? ` (${t("você")})` : ""}</b>
                  <span className="small muted">
                    {m.host ? t("anfitrião") : m.ready ? t("pronto") : m.progress > 0 && m.progress < 1 ? t("baixando mods {p}%", { p: Math.round(m.progress * 100) }) : t("preparando…")}
                  </span>
                </span>
                {m.muted ? <Icon name="mic_off" size={18} className="faint" /> : talking ? <Icon name="graphic_eq" size={18} className="room-talk" /> : null}
                {m.id !== room.me && v.on && (
                  <button className="btn icon-btn sm" title={peerOff.has(m.id) ? t("Ouvir {name}", { name: m.name }) : t("Silenciar {name} só para você", { name: m.name })} onClick={() => {
                    const off = !peerOff.has(m.id);
                    v.mutePeer(m.id, off);
                    setPeerOff((s) => { const n = new Set(s); if (off) n.add(m.id); else n.delete(m.id); return n; });
                  }}><Icon name={peerOff.has(m.id) ? "volume_off" : "volume_up"} size={16} /></button>
                )}
                {hostView && !m.host && (
                  <button className="btn icon-btn sm" title={t("Tirar da sala")} onClick={() => room.sendJson({ type: "kick", id: m.id })}><Icon name="person_remove" size={16} /></button>
                )}
                {!m.host && <span className={`chip ${m.ready ? "ok" : ""}`}>{m.ready ? <Icon name="check" size={14} /> : <Icon name="hourglass_top" size={14} />}</span>}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="room-voice">
        {!v.on ? (
          <div className="col" style={{ gap: 8 }}>
            <button className="btn primary" disabled={room.status !== "open"} onClick={() => void v.start()}><Icon name="mic" /> {t("Entrar no chat de voz")}</button>
            {v.error && <span className="small warn-text">{v.error === "mic-denied" ? t("O microfone foi bloqueado. Libere em Configurações do Windows → Privacidade → Microfone (\"Permitir que aplicativos da área de trabalho acessem\") e tente de novo.") : v.error === "mic-missing" ? t("Nenhum microfone encontrado.") : t("Não deu para ligar o microfone.")}</span>}
            <span className="faint small">{t("A voz passa pelo launcher de quem convidou: funciona com o jogo aberto, sem programa extra.")}</span>
          </div>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button className={`btn ${v.muted ? "warn" : ""}`} onClick={() => v.setMute(!v.muted)} title={t("Atalho: {key}", { key: MUTE_KEY })}><Icon name={v.muted ? "mic_off" : "mic"} /> {v.muted ? t("Mudo") : t("Microfone")}</button>
              <button className={`btn ${v.deafened ? "warn" : ""}`} onClick={() => v.setDeaf(!v.deafened)}><Icon name={v.deafened ? "headset_off" : "headphones"} /> {v.deafened ? t("Sem som") : t("Som")}</button>
              <span className="grow" />
              <button className="btn text sm" onClick={v.stop}><Icon name="call_end" size={16} /> {t("Sair da voz")}</button>
            </div>
            <div className="room-meter" aria-hidden><i style={{ width: `${Math.min(100, v.myLevel * 160)}%` }} /></div>
            <div className="seg" role="group" aria-label={t("Como falar")}>
              <button type="button" className="btn sm" aria-pressed={v.mode === "open"} onClick={() => v.setMode("open")}>{t("Microfone aberto")}</button>
              <button type="button" className="btn sm" aria-pressed={v.mode === "ptt"} onClick={() => v.setMode("ptt")}>{t("Apertar para falar")}</button>
            </div>
            {v.mode === "ptt" ? (
              <label className="row small" style={{ gap: 8 }}>{t("Tecla (funciona dentro do jogo):")}
                <select className="select dense" value={pttKey} onChange={(e) => { setPttKey(e.target.value); try { localStorage.setItem("cp-voice-ptt", e.target.value); } catch { /* ok */ } }}>
                  {PTT_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
            ) : (
              <label className="range"><span>{t("Sensibilidade")}</span>
                <input type="range" min={0} max={1} step={0.05} value={v.sensitivity} onChange={(e) => v.setSensitivity(Number(e.target.value))} />
              </label>
            )}
            <label className="range"><span>{t("Volume dos amigos")}</span>
              <input type="range" min={0} max={2} step={0.05} value={v.volume} onChange={(e) => v.setVolume(Number(e.target.value))} />
              <output>{Math.round(v.volume * 100)}%</output>
            </label>
            {mics.length > 1 && (
              <label className="row small" style={{ gap: 8 }}><Icon name="mic" size={16} />
                <select className="select dense grow" value={mic} onChange={async (e) => {
                  setMic(e.target.value);
                  try { localStorage.setItem("cp-voice-mic", JSON.stringify(e.target.value || null)); } catch { /* ok */ }
                  v.stop();
                  await v.start();
                }}>
                  <option value="">{t("Microfone padrão do Windows")}</option>
                  {mics.filter((d) => d.deviceId && d.deviceId !== "default").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || t("Microfone")}</option>)}
                </select>
              </label>
            )}
            <span className="faint small">{t("Mudo no jogo: {key}.", { key: MUTE_KEY })}</span>
          </div>
        )}
      </div>

      <div className="room-chat">
        <div className="room-lines">
          {room.chat.length === 0 && <p className="faint small">{t("Chat da sala: combine os times e o começo aqui.")}</p>}
          {room.chat.map((c, i) => (
            <p key={i} className={c.id === room.me ? "mine" : ""}><b>{c.from}</b> {c.text}</p>
          ))}
          <div ref={chatEnd} />
        </div>
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); room.say(msg); setMsg(""); }}>
          <input className="input grow" value={msg} maxLength={300} placeholder={t("Mensagem para a sala…")} onChange={(e) => setMsg(e.target.value)} disabled={room.status !== "open"} />
          <button className="btn icon-btn" disabled={!msg.trim() || room.status !== "open"} aria-label={t("Enviar")}><Icon name="send" /></button>
        </form>
      </div>
    </div>
  );
}
