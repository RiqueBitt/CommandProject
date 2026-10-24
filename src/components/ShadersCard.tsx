import { useEffect, useRef, useState } from "react";
import { api, confirmDialog, openUrl } from "../lib/api";
import { useStore } from "../lib/store";
import type { ShaderStatus } from "../lib/types";
import { Compare, Icon, Menu, MenuItem, Notice, TaskProgress } from "./ui";

const PREVIEW: Record<string, string> = { Natural: "natural", Vivido: "vivido", Cinematico: "cinematico" };

export default function ShadersCard() {
  const { run } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const [st, setSt] = useState<ShaderStatus | null | undefined>(undefined);
  const [pick, setPick] = useState("Vivido");
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.shadersStatus().then((s) => {
      setSt(s);
      if (s?.preset) setPick(s.preset);
    }).catch(() => setSt(null));
  }, []);

  const update = (s: ShaderStatus | undefined) => {
    if (!s) return;
    setSt(s);
    if (s.preset) setPick(s.preset);
  };
  const working = busy.shaders || busy.reshade;
  const active = st?.packInstalled ? st.preset ?? null : null;
  const chosen = st?.presets.find((p) => p.id === pick);

  const choose = async (id: string | null) => {
    if (id) setPick(id);
    if (!st?.reshade) return; // sem ReShade: só escolhe; ativa ao instalar
    const name = st.presets.find((p) => p.id === id)?.name;
    update(await run("shaders", () => api.shadersApply(id), id ? `Shaders: ${name} ativado. Vale na próxima vez que abrir o jogo.` : "Shaders desligados."));
  };

  return (
    <section className="card shaders-card" aria-labelledby="shaders-title">
      <div className="shaders-media">
        <Compare before="shaders/original.jpg" after={`shaders/${PREVIEW[pick] ?? "vivido"}.jpg`} beforeLabel="Original" afterLabel={chosen?.name ?? "Vívido"} />
        <p className="faint small">Cena de teste renderizada com estes mesmos shaders, fora do jogo.</p>
      </div>
      <div className="shaders-body">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="grow">
            <div className="overline">Mod em destaque</div>
            <h2 id="shaders-title" className="shaders-title">Shaders do CommandProject</h2>
          </div>
          {st?.packInstalled && (
            <>
              <button ref={menuBtn} className="btn text icon-btn" aria-label="Mais opções" onClick={() => setMenu(true)}><Icon name="more_vert" /></button>
              {menu && (
                <Menu anchor={menuBtn.current} placement="below" onClose={() => setMenu(false)}>
                  <MenuItem icon="restart_alt" onClick={async () => { setMenu(false); update(await run("shaders", () => api.shadersReset(), "Presets de volta ao padrão.")); }}>Restaurar os presets</MenuItem>
                  <MenuItem icon="folder_open" onClick={() => { setMenu(false); void run("open", () => api.openPath(st.binDir)); }}>Abrir a pasta do jogo</MenuItem>
                  <hr />
                  <MenuItem icon="delete" onClick={async () => {
                    setMenu(false);
                    if (!(await confirmDialog("Remover os shaders do CommandProject? O ReShade continua instalado."))) return;
                    update(await run("shaders", () => api.shadersRemove(false), "Shaders removidos."));
                  }}>Remover shaders</MenuItem>
                  <MenuItem icon="delete_forever" onClick={async () => {
                    setMenu(false);
                    if (!(await confirmDialog("Remover os shaders e o ReShade da pasta do jogo? O jogo volta a rodar sem nenhum pós-processamento."))) return;
                    update(await run("shaders", () => api.shadersRemove(true), "Shaders e ReShade removidos."));
                  }}>Remover shaders e ReShade</MenuItem>
                </Menu>
              )}
            </>
          )}
        </div>
        <p className="muted">
          Anti-serrilhado, nitidez, relevo no terreno, brilho em explosões e cores mais vivas, via <b>ReShade</b>.
          É só visual: roda na sua máquina e <b>não dessincroniza o multiplayer</b>.
        </p>

        <div className="chips">
          {st?.reshade ? <span className="chip ok"><Icon name="check" /> ReShade {st.reshadeVersion ?? "instalado"}</span> : <span className="chip">ReShade não instalado</span>}
          {active && <span className="chip ok"><Icon name="auto_awesome" /> Ativo: {st?.presets.find((p) => p.id === active)?.name}</span>}
          {st?.packInstalled && !active && <span className="chip warn">Desligado</span>}
          {st?.updateAvailable && <span className="chip info">Atualização do pacote</span>}
        </div>

        <div className="preset-grid" role="radiogroup" aria-label="Preset">
          {(st?.presets ?? []).map((p) => (
            <button key={p.id} role="radio" aria-checked={pick === p.id} className="preset" disabled={working} onClick={() => void choose(p.id)}>
              <img src={`shaders/${PREVIEW[p.id]}.jpg`} alt="" />
              <span className="nm">{p.name}{active === p.id && <Icon name="check_circle" size={16} />}{p.customized && <span className="chip">ajustado</span>}</span>
              <span className="ds">{p.description}</span>
            </button>
          ))}
        </div>

        {st === null && <Notice kind="info">Configure a pasta do jogo em Configurações para instalar os shaders.</Notice>}
        {st?.foreignDll && <Notice kind="err">Já existe um <b>d3d9.dll</b> de outro programa na pasta do jogo. Remova-o para usar os shaders.</Notice>}

        {st && !st.foreignDll && (
          working ? <TaskProgress task={busy.reshade ? "reshade" : "shaders"} label="Trabalhando…" /> : !st.reshade ? (
            <div className="col" style={{ gap: 8 }}>
              <div className="row wrap">
                <button className="btn primary" onClick={async () => update(await run("reshade", () => api.shadersInstallReshade(pick), `ReShade instalado e shaders ${chosen?.name ?? ""} ativados.`))}>
                  <Icon name="download" /> Instalar ReShade e ativar
                </button>
                <button className="btn text" onClick={() => void openUrl("https://reshade.me")}><Icon name="open_in_new" /> reshade.me</button>
                <button className="btn text" onClick={async () => {
                  const s = await run("shaders", () => api.shadersStatus());
                  if (s?.reshade) update(await run("shaders", () => api.shadersApply(pick), `ReShade encontrado. Shaders ${chosen?.name ?? ""} ativados.`));
                  else useStore.getState().toast("info", "Ainda não achei o ReShade na pasta bin do jogo. No instalador, escolha SupremeCommander2.exe e DirectX 9.");
                }}><Icon name="fact_check" /> Já instalei, verificar</button>
              </div>
              <p className="faint small">Baixa o instalador oficial (gratuito) do site do ReShade, confere a assinatura digital e instala para DirectX 9. Se o Windows pedir permissão, aceite. Também dá para instalar pelo site: escolha <b>SupremeCommander2.exe</b>, <b>DirectX 9</b>, pule a escolha de efeitos e clique em "Já instalei".</p>
            </div>
          ) : (
            <div className="row wrap">
              {active !== pick || !st.packInstalled ? (
                <button className="btn primary" onClick={() => void choose(pick)}><Icon name="auto_awesome" /> Ativar {chosen?.name}</button>
              ) : (
                <button className="btn" onClick={() => void choose(null)}><Icon name="visibility_off" /> Desligar</button>
              )}
              <span className="faint small">No jogo: <span className="kbd">{st.toggleKey}</span> liga/desliga, <span className="kbd">{st.menuKey}</span> abre o menu para ajustar.</span>
            </div>
          )
        )}
      </div>
    </section>
  );
}
