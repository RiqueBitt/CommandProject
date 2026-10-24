// Cliente do servidor da comunidade (cp-server): salas, chat e informações.
// Fala direto do app com o servidor (HTTPS + WebSocket).

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useStore } from "./store";
import type { ChatMsg, Room, ServerInfo } from "./types";

export const OFFLINE_TEXT = "O modo local está ligado: o launcher não usa a internet. Desligue em Configurações → Modo local para usar o multiplayer.";
const isOffline = () => !!useStore.getState().settings?.offline;

async function req<T>(base: string, path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (isOffline()) throw new Error(OFFLINE_TEXT);
  let r: Response;
  try {
    r = await fetch(base.replace(/\/$/, "") + path, { ...init, headers, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new Error("Não foi possível falar com o servidor da comunidade. Confira o endereço e a sua conexão.");
  }
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `O servidor respondeu ${r.status}`);
  return body as T;
}

export const community = {
  info: (base: string) => req<ServerInfo>(base, "/api/info"),
  rooms: (base: string) => req<Room[]>(base, "/api/rooms"),
  create: (base: string, body: { name: string; nick: string; syncCode: string; fingerprint?: string | null; maxPlayers: number; password?: string }) =>
    req<{ room: Room; token: string }>(base, "/api/rooms", { method: "POST", body: JSON.stringify(body) }),
  join: (base: string, id: string, nick: string, password?: string) =>
    req<Room>(base, `/api/rooms/${id}/join`, { method: "POST", body: JSON.stringify({ nick, password }) }),
  leave: (base: string, id: string, nick: string) => req<void>(base, `/api/rooms/${id}/leave`, { method: "POST", body: JSON.stringify({ nick }) }),
  heartbeat: (base: string, id: string, token: string) => req<Room>(base, `/api/rooms/${id}/heartbeat`, { method: "POST", token }),
  update: (base: string, id: string, token: string, body: Partial<{ status: Room["status"]; syncCode: string; fingerprint: string }>) =>
    req<Room>(base, `/api/rooms/${id}`, { method: "PATCH", token, body: JSON.stringify(body) }),
  close: (base: string, id: string, token: string) => req<void>(base, `/api/rooms/${id}`, { method: "DELETE", token }),
};

// ---- sala que eu estou hospedando (o heartbeat continua mesmo trocando de tela) ----

interface Hosting {
  base: string | null;
  room: Room | null;
  token: string | null;
  error: string | null;
  start: (base: string, room: Room, token: string) => void;
  stop: () => Promise<void>;
  setRoom: (r: Room) => void;
}

let beat: ReturnType<typeof setInterval> | null = null;

export const useHosting = create<Hosting>((set, get) => ({
  base: null,
  room: null,
  token: null,
  error: null,
  start: (base, room, token) => {
    set({ base, room, token, error: null });
    if (beat) clearInterval(beat);
    beat = setInterval(async () => {
      const s = get();
      if (!s.base || !s.room || !s.token) return;
      try {
        set({ room: await community.heartbeat(s.base, s.room.id, s.token), error: null });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    }, 30_000);
  },
  stop: async () => {
    const { base, room, token } = get();
    if (beat) clearInterval(beat);
    beat = null;
    set({ room: null, token: null, base: null });
    if (base && room && token) await community.close(base, room.id, token).catch(() => undefined);
  },
  setRoom: (room) => set({ room }),
}));

// fecha a sala se o app for fechado
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    const { base, room, token } = useHosting.getState();
    if (base && room && token) {
      void fetch(`${base}/api/rooms/${room.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, keepalive: true });
    }
  });
}

// ---- chat ----

export type ChatState = "connecting" | "online" | "offline";

export function useChat(base: string | null | undefined, nick: string, channel: string) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [state, setState] = useState<ChatState>("offline");
  const [notice, setNotice] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!base || nick.trim().length < 2) return;
    if (isOffline()) { setState("offline"); setNotice(OFFLINE_TEXT); return; }
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const connect = () => {
      setState("connecting");
      const url = base.replace(/^http/, "ws").replace(/\/$/, "") + `/ws?nick=${encodeURIComponent(nick.trim())}&channel=${encodeURIComponent(channel)}`;
      const sock = new WebSocket(url);
      ws.current = sock;
      sock.onopen = () => { attempt = 0; setState("online"); setNotice(null); };
      sock.onmessage = (e) => {
        const ev = JSON.parse(e.data);
        if (ev.type === "history") setMessages(ev.messages);
        else if (ev.type === "msg") setMessages((m) => [...m.slice(-199), { nick: ev.nick, text: ev.text, at: ev.at }]);
        else if (ev.type === "presence") setUsers(ev.users);
        else if (ev.type === "error") setNotice(ev.message);
      };
      sock.onclose = () => {
        setState("offline");
        if (closed) return;
        attempt++;
        retry = setTimeout(connect, Math.min(30_000, 1500 * 2 ** attempt));
      };
    };
    setMessages([]);
    setUsers([]);
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws.current?.close();
    };
  }, [base, nick, channel]);

  const send = (text: string) => {
    if (ws.current?.readyState === WebSocket.OPEN && text.trim()) {
      ws.current.send(JSON.stringify({ text }));
      return true;
    }
    return false;
  };
  return { messages, users, state, notice, send };
}
