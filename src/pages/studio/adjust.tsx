import type { ColorAdjust } from "../../lib/types";

export const IDENTITY: ColorAdjust = { hue: 0, saturation: 1, brightness: 1, contrast: 1, tint: null, tintStrength: 0 };

export function ColorSliders({ value, onChange }: { value: ColorAdjust; onChange: (v: ColorAdjust) => void }) {
  const tintHex = value.tint ? "#" + value.tint.map((c) => c.toString(16).padStart(2, "0")).join("") : "#5aa9e6";
  const row = (label: string, key: "hue" | "saturation" | "brightness" | "contrast", min: number, max: number, step: number, fmt: (v: number) => string) => (
    <label className="range">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value[key]} onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })} />
      <output>{fmt(value[key])}</output>
    </label>
  );
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="col" style={{ gap: 12 }}>
      {row("Matiz", "hue", -180, 180, 1, (v) => `${v}°`)}
      {row("Saturação", "saturation", 0, 2, 0.01, pct)}
      {row("Brilho", "brightness", 0.3, 1.8, 0.01, pct)}
      {row("Contraste", "contrast", 0.5, 1.8, 0.01, pct)}
      <label className="range">
        <span>Tingir</span>
        <input type="range" min={0} max={1} step={0.01} value={value.tintStrength} onChange={(e) => onChange({ ...value, tintStrength: Number(e.target.value), tint: value.tint ?? [90, 169, 230] })} />
        <input type="color" value={tintHex} aria-label="Cor do tingimento" style={{ width: 54, height: 28, border: 0, background: "none" }}
          onChange={(e) => {
            const h = e.target.value;
            onChange({ ...value, tint: [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number], tintStrength: value.tintStrength || 0.5 });
          }} />
      </label>
      <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange(IDENTITY)}>Zerar ajustes</button>
    </div>
  );
}
