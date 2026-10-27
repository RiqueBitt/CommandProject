// Conexão com a sala de convite (WebSocket no launcher do anfitrião): quem está, prontos, chat,
// voz e o aviso de começar.
import { useCallback, useEffect, useRef, useState } from "react";
import type { PartyMember } from "./types";
import { Voice, type VoiceMode } from "./voice";

export interface ChatLine { id: number; from: string; text: string; at: number; mine?: boolean; system?: boolean }

export type RoomStatus = "connecting" | "open" | "closed" | "kicked" | "full";

function stored<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v === null ? fallback : (JSON.parse(v) as T); } catch { return fallback; }
}
function keep(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ok */ }
}

export function useRoom(url: string | null, onStart: () => void) {
  const ws = useRef<WebSocket | null>(null);
  const voice = useRef<Voice | null>(null);
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [me, setMe] = useState(0);
  const [members, setMembers] = useState<PartyMember[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [levels, setLevels] = useState<Map<number, number>>(new Map());
  const [myLevel, setMyLevel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [mode, setModeState] = useState<VoiceMode>(() => stored("cp-voice-mode", "open"));
  const [volume, setVolumeState] = useState(() => stored("cp-voice-volume", 1));
  const [sensitivity, setSensitivityState] = useState(() => stored("cp-voice-sens", 0.6));
  const startRef = useRef(onStart);
  startRef.current = onStart;
  const statusRef = useRef<Record<string, unknown>>({});

  const sendJson = useCallback((v: unknown) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(v));
  }, []);
  /** estado deste membro (pronto, progresso, falando) — reenviado se reconectar */
  const report = useCallback((patch: Record<string, unknown>) => {
    statusRef.current = { ...statusRef.current, ...patch };
    sendJson({ type: "status", ...patch });
  }, [sendJson]);

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let retry = 0;
    let timer = 0;
    const connect = () => {
      setStatus("connecting");
      const s = new WebSocket(url);
      s.binaryType = "arraybuffer";
      ws.current = s;
      s.onopen = () => {
        retry = 0;
        setStatus("open");
        if (Object.keys(statusRef.current).length) s.send(JSON.stringify({ type: "status", ...statusRef.current }));
      };
      s.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) { voice.current?.receive(e.data); return; }
        let m: { type: string; [k: string]: unknown };
        try { m = JSON.parse(String(e.data)); } catch { return; }
        if (m.type === "hello") setMe(Number(m.id));
        else if (m.type === "state") setMembers(m.members as PartyMember[]);
        else if (m.type === "chat") setChat((c) => [...c.slice(-80), { id: Number(m.id), from: String(m.from), text: String(m.text), at: Date.now() }]);
        else if (m.type === "start") startRef.current();
        else if (m.type === "kicked") { setStatus("kicked"); alive = false; s.close(); }
        else if (m.type === "closed") { setStatus("closed"); alive = false; }
      };
      s.onclose = (e) => {
        if (!alive) { setStatus((st) => (st === "kicked" ? st : "closed")); return; }
        // sala cheia ou partida começada: não insiste
        if (e.code === 1006 && retry > 4) { setStatus("closed"); return; }
        setStatus("connecting");
        retry++;
        timer = window.setTimeout(connect, Math.min(5000, 600 * retry));
      };
    };
    connect();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ws.current?.close();
      ws.current = null;
      voice.current?.stop();
      voice.current = null;
      setVoiceOn(false);
    };
  }, [url]);

  const startVoice = useCallback(async () => {
    setVoiceError(null);
    const v = new Voice((data) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(data); });
    v.mode = mode;
    v.sensitivity = sensitivity;
    v.volume = volume;
    v.onLevels = (l, mine) => { setLevels(l); setMyLevel(mine); };
    v.onTalking = (t) => report({ talking: t });
    try {
      await v.start(stored<string | undefined>("cp-voice-mic", undefined));
      voice.current = v;
      setVoiceOn(true);
      report({ muted: false });
    } catch (e) {
      v.stop();
      const msg = String((e as Error)?.name ?? e);
      setVoiceError(msg.includes("NotAllowed") ? "mic-denied" : msg.includes("NotFound") ? "mic-missing" : "mic-error");
    }
  }, [mode, sensitivity, volume, report]);
  const stopVoice = useCallback(() => {
    voice.current?.stop();
    voice.current = null;
    setVoiceOn(false);
    report({ talking: false, muted: true });
  }, [report]);

  const setMute = (m: boolean) => { setMuted(m); if (voice.current) voice.current.muted = m; report({ muted: m }); };
  const setDeaf = (d: boolean) => { setDeafened(d); voice.current?.setDeafened(d); };
  const setMode = (m: VoiceMode) => { setModeState(m); keep("cp-voice-mode", m); if (voice.current) voice.current.mode = m; };
  const setVolume = (v: number) => { setVolumeState(v); keep("cp-voice-volume", v); voice.current?.setVolume(v); };
  const setSensitivity = (v: number) => { setSensitivityState(v); keep("cp-voice-sens", v); if (voice.current) voice.current.sensitivity = v; };
  const setPtt = (down: boolean) => { if (voice.current) voice.current.pttDown = down; };
  const mutePeer = (id: number, m: boolean) => voice.current?.mutePeer(id, m);

  const say = (text: string) => {
    const t = text.trim();
    if (t) sendJson({ type: "chat", text: t });
  };

  return {
    status, me, members, chat, sendJson, report, say,
    voice: { on: voiceOn, error: voiceError, start: startVoice, stop: stopVoice, levels, myLevel, muted, setMute, deafened, setDeaf, mode, setMode, volume, setVolume, sensitivity, setSensitivity, setPtt, mutePeer },
  };
}

export type Room = ReturnType<typeof useRoom>;
