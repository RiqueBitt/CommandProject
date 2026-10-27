// Chat de voz da sala de convite. O áudio vai pelo WebSocket da sala (o launcher do anfitrião repassa
// para os outros), então funciona em qualquer rede em que a sala funciona, sem servidor.
//
// Captura: microfone com cancelamento de eco, redução de ruído e ganho automático; blocos de 20 ms.
// Codificação: Opus (WebCodecs) a 24 kbit/s; sem WebCodecs, PCM de 16 bits a 16 kHz.
// Só manda quando você fala (detector de voz) ou enquanto a tecla de falar está apertada.
// Cada quadro: 1 byte de formato (1 = Opus, 2 = PCM16) + os dados. O anfitrião põe na frente o número
// de quem falou.

export type VoiceMode = "open" | "ptt";

interface Peer { decoder: AudioDecoder | null; next: number; gain: GainNode; level: number; last: number }

const RATE = 48000;
const OPUS = 1;
const PCM = 2;

export class Voice {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private encoder: AudioEncoder | null = null;
  private peers = new Map<number, Peer>();
  private out: GainNode | null = null;
  private hang = 0;
  private ts = 0;
  private sending = false;
  muted = false;
  deafened = false;
  mode: VoiceMode = "open";
  pttDown = false;
  /** sensibilidade do detector de voz (0 a 1; maior = capta voz mais baixa) */
  sensitivity = 0.6;
  /** volume de quem fala (0 a 2) */
  volume = 1;
  /** quem está falando agora (número do membro), atualizado a cada quadro */
  onLevels?: (levels: Map<number, number>, me: number) => void;
  onTalking?: (talking: boolean) => void;
  private myLevel = 0;
  private talking = false;
  private levelsTimer = 0;
  private peerMuted = new Set<number>();

  constructor(private send: (data: ArrayBuffer) => void) {}

  get active() { return !!this.stream; }

  async start(deviceId?: string) {
    this.stop();
    this.ctx = new AudioContext({ sampleRate: RATE, latencyHint: "interactive" });
    this.out = this.ctx.createGain();
    this.out.gain.value = this.volume;
    this.out.connect(this.ctx.destination);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    await this.ctx.audioWorklet.addModule("/voice-worklet.js");
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "cp-capture");
    this.node.port.onmessage = (e) => this.frame(e.data as Float32Array<ArrayBuffer>);
    src.connect(this.node);
    // o worklet precisa estar ligado a uma saída para rodar (sem som: ganho 0)
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctx.destination);
    if (typeof AudioEncoder !== "undefined") {
      try {
        const enc = new AudioEncoder({
          output: (chunk) => {
            const b = new Uint8Array(chunk.byteLength + 1);
            b[0] = OPUS;
            chunk.copyTo(b.subarray(1));
            this.send(b.buffer);
          },
          error: () => { this.encoder = null; },
        });
        enc.configure({ codec: "opus", sampleRate: RATE, numberOfChannels: 1, bitrate: 24000 });
        this.encoder = enc;
      } catch {
        this.encoder = null;
      }
    }
    this.levelsTimer = window.setInterval(() => this.reportLevels(), 120);
  }

  stop() {
    window.clearInterval(this.levelsTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.encoder?.close(); } catch { /* já fechado */ }
    this.encoder = null;
    this.peers.forEach((p) => { try { p.decoder?.close(); } catch { /* ok */ } });
    this.peers.clear();
    this.node?.disconnect();
    this.node = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.setTalking(false);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out) this.out.gain.value = this.deafened ? 0 : v;
  }
  setDeafened(d: boolean) {
    this.deafened = d;
    if (this.out) this.out.gain.value = d ? 0 : this.volume;
  }
  mutePeer(id: number, muted: boolean) {
    if (muted) this.peerMuted.add(id); else this.peerMuted.delete(id);
  }

  private setTalking(t: boolean) {
    if (t !== this.talking) {
      this.talking = t;
      this.onTalking?.(t);
    }
  }

  private frame(samples: Float32Array<ArrayBuffer>) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / samples.length);
    this.myLevel = Math.max(rms * 6, this.myLevel * 0.85);
    // detector de voz: acima do limiar abre, e segura aberto 350 ms depois (não corta o fim das palavras)
    const threshold = 0.004 + (1 - this.sensitivity) * 0.03;
    const now = performance.now();
    let open: boolean;
    if (this.muted) open = false;
    else if (this.mode === "ptt") open = this.pttDown;
    else {
      if (rms > threshold) this.hang = now + 350;
      open = now < this.hang;
    }
    this.setTalking(open);
    if (!open) {
      // um quadro de silêncio no fim fecha o som do outro lado sem estalo
      if (this.sending) this.sending = false;
      return;
    }
    this.sending = true;
    if (this.encoder && this.encoder.state === "configured") {
      const data = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: samples.length, numberOfChannels: 1, timestamp: this.ts, data: samples });
      this.ts += (samples.length / RATE) * 1e6;
      this.encoder.encode(data);
      data.close();
    } else {
      // 48 kHz → 16 kHz (média de 3) em 16 bits
      const n = Math.floor(samples.length / 3);
      const b = new Uint8Array(1 + n * 2);
      b[0] = PCM;
      const v = new DataView(b.buffer);
      for (let i = 0; i < n; i++) {
        const s = (samples[i * 3] + samples[i * 3 + 1] + samples[i * 3 + 2]) / 3;
        v.setInt16(1 + i * 2, Math.max(-1, Math.min(1, s)) * 32767, true);
      }
      this.send(b.buffer);
    }
  }

  /** Um quadro de voz que chegou da sala: [quem, formato, dados…]. */
  receive(buf: ArrayBuffer) {
    if (!this.ctx || this.deafened) return;
    const b = new Uint8Array(buf);
    if (b.length < 3) return;
    const id = b[0];
    if (this.peerMuted.has(id)) return;
    const peer = this.peer(id);
    peer.last = performance.now();
    if (b[1] === OPUS) {
      if (!peer.decoder) return;
      try {
        peer.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: 0, data: b.subarray(2) }));
      } catch { /* quadro estragado */ }
    } else if (b[1] === PCM) {
      const n = (b.length - 2) >> 1;
      const v = new DataView(b.buffer, b.byteOffset + 2, n * 2);
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = v.getInt16(i * 2, true) / 32768;
      this.play(peer, f, 16000);
    }
  }

  private peer(id: number): Peer {
    let p = this.peers.get(id);
    if (p) return p;
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.connect(this.out!);
    p = { decoder: null, next: 0, gain, level: 0, last: 0 };
    const peer = p;
    if (typeof AudioDecoder !== "undefined") {
      try {
        const dec = new AudioDecoder({
          output: (data) => {
            const f = new Float32Array(data.numberOfFrames);
            data.copyTo(f, { planeIndex: 0, format: "f32-planar" });
            const rate = data.sampleRate;
            data.close();
            this.play(peer, f, rate);
          },
          error: () => { peer.decoder = null; },
        });
        dec.configure({ codec: "opus", sampleRate: RATE, numberOfChannels: 1 });
        p.decoder = dec;
      } catch {
        p.decoder = null;
      }
    }
    this.peers.set(id, p);
    return p;
  }

  private play(peer: Peer, f: Float32Array<ArrayBuffer>, rate: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    peer.level = Math.max(Math.sqrt(sum / f.length) * 6, peer.level * 0.8);
    const buf = ctx.createBuffer(1, f.length, rate);
    buf.copyToChannel(f, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(peer.gain);
    // pequena reserva (80 ms) contra a variação da rede; se ficou para trás, recomeça a reserva
    const now = ctx.currentTime;
    if (peer.next < now + 0.02 || peer.next > now + 0.5) peer.next = now + 0.08;
    src.start(peer.next);
    peer.next += buf.duration;
  }

  private reportLevels() {
    const levels = new Map<number, number>();
    const now = performance.now();
    this.peers.forEach((p, id) => {
      if (now - p.last > 300) p.level *= 0.5;
      levels.set(id, Math.min(1, p.level));
    });
    this.onLevels?.(levels, Math.min(1, this.myLevel));
    this.myLevel *= 0.7;
  }
}

/** Microfones do computador (nomes só aparecem depois da permissão do microfone). */
export async function microphones(): Promise<MediaDeviceInfo[]> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  } catch {
    return [];
  }
}
