// Som do clima da partida grande: chuva, tempestade (com trovões ao fundo) ou nevasca (vento), feito
// na hora pelo launcher enquanto o jogo está aberto. O jogo não tem esses sons; tocar daqui evita mexer
// nos bancos de som dele. Tudo sintetizado (ruído filtrado e envelopes), sem arquivos de áudio.
//
// `prime()` precisa ser chamado no clique (o navegador só libera o áudio com um gesto do usuário);
// `start()` começa e `stop()` para com um fade. O launcher para sozinho quando o jogo fecha.

import { onEvent } from "./api";

export type WeatherKind = "rain" | "storm" | "blizzard";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let nodes: AudioNode[] = [];
let timers: number[] = [];
let unlisten: (() => void) | null = null;
let current: WeatherKind | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = AC ? new AC() : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Libera o áudio dentro do gesto do usuário (chame no clique de "Jogar"). */
export function prime() {
  const c = audio();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

/** Ruído em loop: branco, rosa (mais grave) ou marrom (bem grave). */
function noise(c: AudioContext, color: "white" | "pink" | "brown", seconds = 4): AudioBufferSourceNode {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "white") d[i] = w * 0.5;
      else if (color === "pink") {
        // filtro de Paul Kellet
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // emenda o fim no começo (sem estalo no loop)
    const fade = Math.min(2048, len >> 4);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
    }
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function filter(c: AudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function gain(c: AudioContext, v: number): GainNode {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}

/** Um ruído filtrado ligado ao volume geral, com um volume próprio. */
function layer(c: AudioContext, color: "white" | "pink" | "brown", chain: AudioNode[], level: number): GainNode {
  const src = noise(c, color);
  const g = gain(c, level);
  let at: AudioNode = src;
  for (const n of chain) {
    at.connect(n);
    at = n;
  }
  at.connect(g);
  g.connect(master!);
  src.start();
  nodes.push(src, g, ...chain);
  return g;
}

/** Variação lenta de um parâmetro (vento que sobe e desce). */
function wobble(c: AudioContext, param: AudioParam, rate: number, depth: number) {
  const lfo = c.createOscillator();
  lfo.frequency.value = rate;
  const amt = gain(c, depth);
  lfo.connect(amt);
  amt.connect(param);
  lfo.start();
  nodes.push(lfo, amt);
}

/** Trovão: um estalo curto (às vezes) e o ronco grave que rola e some. */
function thunder(c: AudioContext, near: boolean) {
  if (!master) return;
  const t = c.currentTime + 0.05;
  const src = noise(c, "brown", 8);
  const lp = filter(c, "lowpass", near ? 420 : 180, 0.5);
  const g = gain(c, 0);
  src.connect(lp);
  lp.connect(g);
  g.connect(master);
  const peak = near ? 1.4 : 0.8;
  const length = 4 + Math.random() * 4;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + (near ? 0.08 : 0.6 + Math.random() * 0.8));
  // o ronco rola: alguns repiques no caminho
  let at = t + 0.8;
  while (at < t + length - 1) {
    g.gain.linearRampToValueAtTime(peak * (0.35 + Math.random() * 0.5), at);
    at += 0.3 + Math.random() * 0.9;
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  lp.frequency.setValueAtTime(near ? 900 : 260, t);
  lp.frequency.exponentialRampToValueAtTime(110, t + length);
  src.start(t);
  src.stop(t + length + 0.2);
  if (near) {
    // estalo do raio perto
    const crack = noise(c, "white", 1);
    const hp = filter(c, "highpass", 1800, 0.6);
    const cg = gain(c, 0);
    crack.connect(hp);
    hp.connect(cg);
    cg.connect(master);
    cg.gain.setValueAtTime(0.9, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    crack.start(t);
    crack.stop(t + 0.4);
  }
}

function scheduleThunder(c: AudioContext) {
  const next = () => {
    const wait = 7000 + Math.random() * 16000;
    timers.push(window.setTimeout(() => {
      if (current !== "storm") return;
      thunder(c, Math.random() < 0.3);
      next();
    }, wait));
  };
  next();
}

function build(c: AudioContext, kind: WeatherKind) {
  if (kind === "rain" || kind === "storm") {
    const heavy = kind === "storm";
    // chiado da chuva no chão
    layer(c, "white", [filter(c, "highpass", 500), filter(c, "lowpass", heavy ? 9000 : 7000)], heavy ? 0.32 : 0.22);
    // corpo da chuva (gotas grossas)
    layer(c, "pink", [filter(c, "bandpass", heavy ? 900 : 1200, 0.5)], heavy ? 0.45 : 0.28);
    if (heavy) {
      // vento da tempestade
      const wind = layer(c, "pink", [filter(c, "bandpass", 380, 0.9)], 0.22);
      wobble(c, wind.gain, 0.07, 0.12);
      // ronco distante contínuo
      layer(c, "brown", [filter(c, "lowpass", 140)], 0.18);
      scheduleThunder(c);
    }
  } else {
    // nevasca: vento forte que sobe e desce, assobio alto e neve batendo
    const band = filter(c, "bandpass", 520, 0.8);
    const wind = layer(c, "pink", [band], 0.42);
    wobble(c, wind.gain, 0.09, 0.22);
    wobble(c, band.frequency, 0.05, 260);
    const whistle = filter(c, "bandpass", 1500, 6);
    const w2 = layer(c, "white", [whistle], 0.05);
    wobble(c, w2.gain, 0.13, 0.04);
    wobble(c, whistle.frequency, 0.03, 500);
    layer(c, "white", [filter(c, "highpass", 3500)], 0.05);
    layer(c, "brown", [filter(c, "lowpass", 200)], 0.2);
  }
}

/** Começa o som do clima (volume de 0 a 1) e para sozinho quando o jogo fechar. */
export function start(kind: WeatherKind, volume: number) {
  stop(0);
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  current = kind;
  master = gain(c, 0);
  master.connect(c.destination);
  build(c, kind);
  // entra devagar (o jogo leva alguns segundos para abrir)
  master.gain.setValueAtTime(0, c.currentTime);
  master.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)) * 0.8, c.currentTime + 6);
  void onEvent("cp://game-closed", () => stop()).then((off) => {
    if (current) unlisten = off;
    else off();
  });
}

/** Para o som (com um fade de `fade` segundos). */
export function stop(fade = 2) {
  current = null;
  timers.forEach((t) => window.clearTimeout(t));
  timers = [];
  unlisten?.();
  unlisten = null;
  const c = ctx;
  const m = master;
  const old = nodes;
  master = null;
  nodes = [];
  if (!c || !m) return;
  const end = c.currentTime + Math.max(0.01, fade);
  m.gain.cancelScheduledValues(c.currentTime);
  m.gain.setValueAtTime(m.gain.value, c.currentTime);
  m.gain.linearRampToValueAtTime(0, end);
  window.setTimeout(() => {
    for (const n of old) {
      try {
        if (n instanceof AudioScheduledSourceNode) n.stop();
        n.disconnect();
      } catch { /* já parou */ }
    }
    m.disconnect();
  }, fade * 1000 + 100);
}

/** Muda o volume do som que está tocando (0 a 1). */
export function setVolume(volume: number) {
  if (!ctx || !master) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * 0.8, ctx.currentTime, 0.2);
}

export function playing(): WeatherKind | null {
  return current;
}

/** Ouvir alguns segundos (botão de prévia na tela da partida). */
export function preview(kind: WeatherKind, volume: number, seconds = 6) {
  prime();
  start(kind, volume);
  if (master && ctx) {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)) * 0.8, ctx.currentTime + 0.8);
    if (kind === "storm") thunder(ctx, true);
  }
  const mine = current;
  timers.push(window.setTimeout(() => { if (current === mine) stop(1.5); }, seconds * 1000));
}
