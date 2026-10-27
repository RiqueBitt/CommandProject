// Som do clima da partida grande: chuva, chuva forte com vento (tempestade) ou vento da nevasca, feito
// na hora pelo launcher enquanto o jogo está aberto, baixo e sempre variando. O jogo não tem som de
// chuva nem de vento forte. Os trovões não são daqui: tocam dentro do jogo, com sons do próprio jogo,
// no lugar de cada raio (som 3D, com a distância e a direção dele, depois do clarão).
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
function noise(c: AudioContext, color: "white" | "pink" | "brown", seconds = 9): AudioBufferSourceNode {
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

/** Variação natural: o volume de uma camada vai mudando devagar para alvos sorteados (rajadas de
 * chuva e de vento), sem ciclo fixo, então o som nunca se repete do mesmo jeito. */
function drift(c: AudioContext, g: GainNode, base: number, spread: number, minS: number, maxS: number) {
  const step = () => {
    if (!current) return;
    const target = Math.max(0, base * (1 + (Math.random() * 2 - 1) * spread));
    const secs = minS + Math.random() * (maxS - minS);
    g.gain.setTargetAtTime(target, c.currentTime, secs / 3);
    timers.push(window.setTimeout(step, secs * 1000));
  };
  step();
}

function build(c: AudioContext, kind: WeatherKind) {
  // volumes baixos de propósito: é um fundo, o som do jogo continua na frente
  if (kind === "rain" || kind === "storm") {
    const heavy = kind === "storm";
    // chiado da chuva no chão
    const hiss = layer(c, "white", [filter(c, "highpass", 650), filter(c, "lowpass", heavy ? 7500 : 6000)], heavy ? 0.1 : 0.07);
    drift(c, hiss, heavy ? 0.1 : 0.07, 0.35, 4, 11);
    // corpo da chuva (gotas grossas), mais grave
    const body = layer(c, "pink", [filter(c, "bandpass", heavy ? 850 : 1100, 0.5)], heavy ? 0.14 : 0.09);
    drift(c, body, heavy ? 0.14 : 0.09, 0.4, 5, 14);
    if (heavy) {
      // vento da tempestade: rajadas sem ritmo
      const band = filter(c, "bandpass", 360, 0.9);
      const wind = layer(c, "pink", [band], 0.07);
      drift(c, wind, 0.07, 0.8, 3, 9);
      wobble(c, band.frequency, 0.04, 90);
    }
  } else {
    // nevasca: vento que sobe e desce sem ritmo, um assobio bem leve e o chiado da neve
    const band = filter(c, "bandpass", 480, 0.8);
    const wind = layer(c, "pink", [band], 0.13);
    drift(c, wind, 0.13, 0.7, 3, 10);
    wobble(c, band.frequency, 0.05, 220);
    const whistle = filter(c, "bandpass", 1400, 6);
    const w2 = layer(c, "white", [whistle], 0.015);
    drift(c, w2, 0.015, 0.9, 4, 12);
    wobble(c, whistle.frequency, 0.03, 400);
    layer(c, "white", [filter(c, "highpass", 3800)], 0.015);
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
  master.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, volume)) * 0.8, c.currentTime + 20);
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
  }
  const mine = current;
  timers.push(window.setTimeout(() => { if (current === mine) stop(1.5); }, seconds * 1000));
}
