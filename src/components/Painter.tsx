import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { Icon } from "./ui";

type Tool = "brush" | "eraser" | "fill" | "picker";
const SWATCHES = ["#ffffff", "#000000", "#a3e635", "#3b8de0", "#f2555a", "#f5b84b", "#8b5cf6", "#14b8a6", "#9ca3af", "#4b5563", "#7c2d12", "#1e3a8a", "#065f46", "#be185d", "#facc15", "#0ea5e9"];

function hexToRgba(hex: string, a: number): [number, number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(Math.round(a * 255)) as [number, number, number, number];
}

/** Editor de pintura para texturas (pincel, borracha, balde, conta-gotas, desfazer). */
export default function Painter({ src, onSave, onCancel, saving }: { src: string; onSave: (png: string) => void; onCancel: () => void; saving?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#a3e635");
  const [size, setSize] = useState(6);
  const [alpha, setAlpha] = useState(1);
  const [tolerance, setTolerance] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [dims, setDims] = useState<[number, number]>([0, 0]);
  const undo = useRef<ImageData[]>([]);
  const redo = useRef<ImageData[]>([]);
  const last = useRef<[number, number] | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const c = canvas.current!;
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d", { willReadFrequently: true })!.drawImage(img, 0, 0);
      setDims([img.width, img.height]);
      const availW = (c.parentElement?.clientWidth ?? 640) - 40;
      const fit = Math.min(availW / img.width, 520 / img.height);
      setZoom(fit >= 1 ? Math.min(8, Math.floor(fit)) : 2 ** Math.floor(Math.log2(fit)));
      undo.current = [];
      redo.current = [];
    };
    img.src = src;
  }, [src]);

  const ctx = () => canvas.current!.getContext("2d", { willReadFrequently: true })!;
  const snapshot = () => {
    undo.current.push(ctx().getImageData(0, 0, dims[0], dims[1]));
    if (undo.current.length > 30) undo.current.shift();
    redo.current = [];
    force((n) => n + 1);
  };
  const doUndo = useCallback(() => {
    const prev = undo.current.pop();
    if (!prev) return;
    redo.current.push(ctx().getImageData(0, 0, dims[0], dims[1]));
    ctx().putImageData(prev, 0, 0);
    force((n) => n + 1);
  }, [dims]);
  const doRedo = useCallback(() => {
    const next = redo.current.pop();
    if (!next) return;
    undo.current.push(ctx().getImageData(0, 0, dims[0], dims[1]));
    ctx().putImageData(next, 0, 0);
    force((n) => n + 1);
  }, [dims]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      if (e.key.toLowerCase() === "y") { e.preventDefault(); doRedo(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [doUndo, doRedo]);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * dims[0]), Math.floor(((e.clientY - r.top) / r.height) * dims[1])];
  };

  const stamp = (x: number, y: number) => {
    const c = ctx();
    c.save();
    c.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    c.globalAlpha = alpha;
    c.fillStyle = color;
    c.beginPath();
    if (size <= 1) c.rect(x, y, 1, 1);
    else c.arc(x + 0.5, y + 0.5, size / 2, 0, Math.PI * 2);
    c.fill();
    c.restore();
  };
  const line = (a: [number, number], b: [number, number]) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.max(1, size / 4)));
    for (let i = 1; i <= steps; i++) stamp(Math.round(a[0] + ((b[0] - a[0]) * i) / steps), Math.round(a[1] + ((b[1] - a[1]) * i) / steps));
  };

  const fill = (x: number, y: number) => {
    const [w, h] = dims;
    const img = ctx().getImageData(0, 0, w, h);
    const d = img.data;
    const at = (i: number) => [d[i], d[i + 1], d[i + 2], d[i + 3]];
    const target = at((y * w + x) * 4);
    const rep = hexToRgba(color, alpha);
    const near = (i: number) => Math.abs(d[i] - target[0]) + Math.abs(d[i + 1] - target[1]) + Math.abs(d[i + 2] - target[2]) + Math.abs(d[i + 3] - target[3]) <= tolerance * 4;
    if (target.every((v, k) => v === rep[k])) return;
    const seen = new Uint8Array(w * h);
    const stack = [x, y];
    while (stack.length) {
      const py = stack.pop()!;
      const px = stack.pop()!;
      let lx = px;
      while (lx >= 0 && !seen[py * w + lx] && near((py * w + lx) * 4)) lx--;
      lx++;
      let up = false;
      let down = false;
      for (let cx = lx; cx < w && !seen[py * w + cx] && near((py * w + cx) * 4); cx++) {
        const i = (py * w + cx) * 4;
        seen[py * w + cx] = 1;
        d[i] = rep[0]; d[i + 1] = rep[1]; d[i + 2] = rep[2]; d[i + 3] = rep[3];
        if (py > 0) {
          const ok = !seen[(py - 1) * w + cx] && near(((py - 1) * w + cx) * 4);
          if (ok && !up) { stack.push(cx, py - 1); up = true; } else if (!ok) up = false;
        }
        if (py < h - 1) {
          const ok = !seen[(py + 1) * w + cx] && near(((py + 1) * w + cx) * 4);
          if (ok && !down) { stack.push(cx, py + 1); down = true; } else if (!ok) down = false;
        }
      }
    }
    ctx().putImageData(img, 0, 0);
  };

  const onDown = (e: React.PointerEvent) => {
    const p = pos(e);
    if (tool === "picker") {
      const [r, g, b] = ctx().getImageData(p[0], p[1], 1, 1).data;
      setColor("#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join(""));
      setTool("brush");
      return;
    }
    snapshot();
    if (tool === "fill") return fill(p[0], p[1]);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    last.current = p;
    stamp(p[0], p[1]);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!last.current) return;
    const p = pos(e);
    line(last.current, p);
    last.current = p;
  };
  const onUp = () => { last.current = null; };

  const tools: { id: Tool; icon: string; label: string }[] = [
    { id: "brush", icon: "brush", label: t("Pincel (B)") },
    { id: "eraser", icon: "layers_clear", label: t("Borracha (E)") },
    { id: "fill", icon: "format_color_fill", label: t("Balde de tinta (G)") },
    { id: "picker", icon: "colorize", label: t("Conta-gotas (I)") },
  ];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || (e.target as HTMLElement).tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      const map: Record<string, Tool> = { b: "brush", e: "eraser", g: "fill", i: "picker" };
      if (map[k]) setTool(map[k]);
      if (k === "[") setSize((s) => Math.max(1, s - 1));
      if (k === "]") setSize((s) => Math.min(128, s + 1));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="paint">
      <div className="tools" role="toolbar" aria-label={t("Ferramentas de pintura")}>
        {tools.map((t) => (
          <button key={t.id} className="btn icon-btn" style={{ borderRadius: 8 }} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => setTool(t.id)}><Icon name={t.icon} /></button>
        ))}
        <hr className="sep" />
        <button className="btn icon-btn" style={{ borderRadius: 8 }} title={t("Desfazer (Ctrl+Z)")} aria-label={t("Desfazer")} disabled={!undo.current.length} onClick={doUndo}><Icon name="undo" /></button>
        <button className="btn icon-btn" style={{ borderRadius: 8 }} title={t("Refazer (Ctrl+Y)")} aria-label={t("Refazer")} disabled={!redo.current.length} onClick={doRedo}><Icon name="redo" /></button>
        <hr className="sep" />
        <button className="btn icon-btn" style={{ borderRadius: 8 }} title={t("Aproximar")} aria-label={t("Aproximar")} onClick={() => setZoom((z) => Math.min(16, z * 2))}><Icon name="zoom_in" /></button>
        <button className="btn icon-btn" style={{ borderRadius: 8 }} title={t("Afastar")} aria-label={t("Afastar")} onClick={() => setZoom((z) => Math.max(0.25, z / 2))}><Icon name="zoom_out" /></button>
      </div>
      <div className="canvas-wrap checker">
        <canvas ref={canvas} style={{ width: dims[0] * zoom, height: dims[1] * zoom }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      </div>
      <div className="props">
        <div className="overline">{t("Cor")}</div>
        <div className="row">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t("Cor")} style={{ width: 48, height: 36, border: 0, background: "none", padding: 0 }} />
          <span className="mono">{color}</span>
        </div>
        <div className="swatches">{SWATCHES.map((c) => <button key={c} style={{ background: c }} aria-label={c} onClick={() => setColor(c)} />)}</div>
        <label className="range" style={{ gridTemplateColumns: "70px 1fr 40px" }}><span>{t("Tamanho")}</span><input type="range" min={1} max={96} value={size} onChange={(e) => setSize(Number(e.target.value))} /><output>{size}</output></label>
        <label className="range" style={{ gridTemplateColumns: "70px 1fr 40px" }}><span>{t("Opacidade")}</span><input type="range" min={0.05} max={1} step={0.05} value={alpha} onChange={(e) => setAlpha(Number(e.target.value))} /><output>{Math.round(alpha * 100)}%</output></label>
        {tool === "fill" && <label className="range" style={{ gridTemplateColumns: "70px 1fr 40px" }}><span>{t("Tolerância")}</span><input type="range" min={0} max={128} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} /><output>{tolerance}</output></label>}
        <p className="small faint">{t("{w}×{h} px, zoom {z}×. Atalhos: B, E, G, I, [ e ], Ctrl+Z.", { w: dims[0], h: dims[1], z: zoom })}</p>
        <span className="spacer" />
        <button className="btn primary" disabled={saving} onClick={() => onSave(canvas.current!.toDataURL("image/png"))}><Icon name="save" /> {saving ? t("Salvando…") : t("Salvar na textura")}</button>
        <button className="btn text" onClick={onCancel}>{t("Cancelar")}</button>
      </div>
    </div>
  );
}
