import { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { CheatOptions, ConflictReport } from "../lib/types";
import { Field, Icon, Modal, Notice, Switch, TaskProgress } from "./ui";

export function ConflictsModal({ report, onClose }: { report: ConflictReport; onClose: () => void }) {
  return (
    <Modal title="Conflitos do perfil" icon="compare_arrows" onClose={onClose}>
      <p className="muted small">
        O jogo monta os arquivos .scd em ordem alfabética e o último vence. Abaixo, quem sobrescreve quem — confirme sempre numa partida de teste.
      </p>
      {report.betweenMods.length === 0 ? <Notice kind="ok">Nenhum mod ativo sobrescreve outro mod.</Notice> : report.betweenMods.map((c) => (
        <details key={c.loser + c.winner} className="card pad">
          <summary style={{ cursor: "pointer" }}><b>{c.winnerMod}</b> sobrescreve <b>{c.loserMod}</b> em {c.count} arquivo(s)</summary>
          <div className="mono faint selectable" style={{ marginTop: 8 }}>{c.samples.map((s) => <div key={s}>{s}</div>)}</div>
        </details>
      ))}
      {report.overridesStock.length > 0 && (
        <>
          <h3>Mudanças em arquivos do jogo</h3>
          {report.overridesStock.map((c) => (
            <div key={c.loser + c.winner} className="row small">
              <span style={{ flex: 1 }}><b>{c.winnerMod ?? c.winner}</b> altera {c.count} arquivo(s) de <span className="mono">{c.loser}</span></span>
            </div>
          ))}
        </>
      )}
      <footer><button className="btn primary" onClick={onClose}>Fechar</button></footer>
    </Modal>
  );
}

export function InstallLinkModal({ onClose }: { onClose: () => void }) {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.link);
  const [url, setUrl] = useState("");
  const valid = /^https:\/\/\S+$/i.test(url.trim());
  return (
    <Modal title="Instalar de um link" icon="link" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        const m = await run("link", () => api.installFromUrl(url.trim(), true), (m) => `"${m.name}" instalado e ativado.`);
        if (m) {
          await refreshMods();
          onClose();
        }
      }}>
        <Field label="Link direto do arquivo" hint="Precisa terminar no arquivo (.zip ou .scd). Links de página (ModDB, Drive “visualizar”) não funcionam — use o botão de download direto.">
          <input className="input" placeholder="https://…/meu-mod.zip" value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Notice kind="warn">Este arquivo não passa pela verificação de um hub. Só instale mods de quem você confia.</Notice>
        {busy && <TaskProgress task="link" label="Baixando…" />}
        <footer>
          <button type="button" className="btn text" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!valid || busy}>Baixar e instalar</button>
        </footer>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ trapaças

const CHEATS_KEY = "cp-cheats";
const CHEATS_DEFAULT: CheatOptions = { mass: true, energy: true, research: true, unlockAll: false, god: true, buildSpeed: 1, aiToo: false };
const CHEAT_ROWS: { key: "mass" | "energy" | "research" | "unlockAll" | "god" | "aiToo"; icon: string; label: string; hint: string }[] = [
  { key: "mass", icon: "diamond", label: "Massa infinita", hint: "O estoque de massa fica sempre cheio." },
  { key: "energy", icon: "bolt", label: "Energia infinita", hint: "O estoque de energia fica sempre cheio." },
  { key: "research", icon: "science", label: "Pesquisa infinita", hint: "Pontos de pesquisa sem fim para comprar tudo que quiser." },
  { key: "unlockAll", icon: "lock_open", label: "Toda a pesquisa liberada", hint: "Começa a partida com a árvore inteira já pesquisada." },
  { key: "god", icon: "shield", label: "Modo deus", hint: "Suas unidades e prédios não tomam dano e não morrem." },
  { key: "aiToo", icon: "smart_toy", label: "A IA também ganha", hint: "Para um desafio: os oponentes da IA recebem as mesmas trapaças." },
];
const SPEEDS = [1, 2, 5, 10, 25];

function loadCheats(): CheatOptions {
  try {
    const raw = localStorage.getItem(CHEATS_KEY);
    if (raw) return { ...CHEATS_DEFAULT, ...JSON.parse(raw) };
  } catch { /* sem armazenamento: usa o padrão */ }
  return CHEATS_DEFAULT;
}

/** Monta e instala o mod de trapaças com as opções escolhidas. */
export function CheatsModal({ installed, onClose }: { installed: boolean; onClose: () => void }) {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.cheats);
  const [o, setO] = useState<CheatOptions>(loadCheats);
  const set = (patch: Partial<CheatOptions>) => setO((v) => ({ ...v, ...patch }));
  const any = CHEAT_ROWS.some((r) => r.key !== "aiToo" && o[r.key]) || o.buildSpeed > 1;
  return (
    <Modal title="Trapaças para jogar sozinho" icon="auto_fix_high" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        try { localStorage.setItem(CHEATS_KEY, JSON.stringify(o)); } catch { /* ok */ }
        const m = await run("cheats", () => api.buildCheats(o, true), () => installed ? "Trapaças atualizadas." : "Trapaças instaladas e ativadas.");
        if (m) {
          await refreshMods();
          onClose();
        }
      }}>
        <div className="col" style={{ gap: 10 }}>
          {CHEAT_ROWS.map((r) => (
            <div key={r.key} className="row" style={{ gap: 12 }}>
              <Icon name={r.icon} size={20} />
              <div className="grow">
                <div>{r.label}</div>
                <div className="small faint">{r.hint}</div>
              </div>
              <Switch label={r.label} checked={o[r.key]} onChange={(v) => set({ [r.key]: v } as Partial<CheatOptions>)} />
            </div>
          ))}
        </div>
        <Field label="Velocidade de construção" hint="Multiplica a velocidade de construção de todas as suas unidades e fábricas.">
          <div className="seg" role="group" aria-label="Velocidade de construção">
            {SPEEDS.map((s) => <button type="button" key={s} className="btn" aria-pressed={o.buildSpeed === s} onClick={() => set({ buildSpeed: s })}>{s === 1 ? "Normal" : `${s}×`}</button>)}
          </div>
        </Field>
        <Notice kind="info">O mod é montado agora com os arquivos do seu jogo e só vale em partidas com um único jogador humano (escaramuça contra a IA). Em multiplayer ele se desliga sozinho. Desligue o mod na lista quando quiser jogar normal.</Notice>
        {busy && <TaskProgress task="cheats" label="Montando o mod…" />}
        <footer>
          <button type="button" className="btn text" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!any || busy}>{installed ? "Atualizar trapaças" : "Instalar e ativar"}</button>
        </footer>
      </form>
    </Modal>
  );
}
