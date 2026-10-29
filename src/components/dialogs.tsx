import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { AiMemoryReport, AiOptions, AiPersonality, CheatOptions, ConflictReport, FirstPersonOptions, OptimizeOptions, OptimizeState } from "../lib/types";
import { t, tr } from "../lib/i18n";
import { Field, Icon, Modal, Notice, Switch, TaskProgress } from "./ui";

export function ConflictsModal({ report, onClose }: { report: ConflictReport; onClose: () => void }) {
  return (
    <Modal title={t("Conflitos do perfil")} icon="compare_arrows" onClose={onClose}>
      <p className="muted small">
        {t("O jogo monta os arquivos .scd em ordem alfabética e o último vence. Abaixo, quem sobrescreve quem — confirme sempre numa partida de teste.")}
      </p>
      {report.betweenMods.length === 0 ? <Notice kind="ok">{t("Nenhum mod ativo sobrescreve outro mod.")}</Notice> : report.betweenMods.map((c) => (
        <details key={c.loser + c.winner} className="card pad">
          <summary style={{ cursor: "pointer" }}><b>{c.winnerMod}</b> {t("sobrescreve")} <b>{c.loserMod}</b> {t("em {n} arquivo(s)", { n: c.count })}</summary>
          <div className="mono faint selectable" style={{ marginTop: 8 }}>{c.samples.map((s) => <div key={s}>{s}</div>)}</div>
        </details>
      ))}
      {report.overridesStock.length > 0 && (
        <>
          <h3>{t("Mudanças em arquivos do jogo")}</h3>
          {report.overridesStock.map((c) => (
            <div key={c.loser + c.winner} className="row small">
              <span style={{ flex: 1 }}><b>{c.winnerMod ?? c.winner}</b> {t("altera {n} arquivo(s) de", { n: c.count })} <span className="mono">{c.loser}</span></span>
            </div>
          ))}
        </>
      )}
      <footer><button className="btn primary" onClick={onClose}>{t("Fechar")}</button></footer>
    </Modal>
  );
}

export function InstallLinkModal({ onClose }: { onClose: () => void }) {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.link);
  const [url, setUrl] = useState("");
  const valid = /^https:\/\/\S+$/i.test(url.trim());
  return (
    <Modal title={t("Instalar de um link")} icon="link" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        const m = await run("link", () => api.installFromUrl(url.trim(), true), (m) => t('"{name}" instalado e ativado.', { name: m.name }));
        if (m) {
          await refreshMods();
          onClose();
        }
      }}>
        <Field label={t("Link direto do arquivo")} hint={t("Precisa terminar no arquivo (.zip ou .scd). Links de página (ModDB, Drive “visualizar”) não funcionam — use o botão de download direto.")}>
          <input className="input" placeholder={t("https://…/meu-mod.zip")} value={url} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Notice kind="warn">{t("Este arquivo não passa pela verificação de um hub. Só instale mods de quem você confia.")}</Notice>
        {busy && <TaskProgress task="link" label={t("Baixando…")} />}
        <footer>
          <button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn primary" disabled={!valid || busy}>{t("Baixar e instalar")}</button>
        </footer>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ trapaças

const CHEATS_KEY = "cp-cheats";
const CHEATS_DEFAULT: CheatOptions = { mass: true, energy: true, research: true, unlockAll: false, god: true, buildSpeed: 1, aiToo: false, menu: true, key: "F3", tab: true };
const MENU_KEYS = ["F3", "F4", "F8", "F11", "Insert", "Home"];
const CHEAT_ROWS: { key: "mass" | "energy" | "research" | "unlockAll" | "god" | "aiToo"; icon: string; label: string; hint: string }[] = [
  { key: "mass", icon: "diamond", label: "Massa infinita", hint: "O estoque de massa fica sempre cheio." },
  { key: "energy", icon: "bolt", label: "Energia infinita", hint: "O estoque de energia fica sempre cheio." },
  { key: "research", icon: "science", label: "Pesquisa infinita", hint: "Pontos de pesquisa sem fim para comprar tudo que quiser." },
  { key: "unlockAll", icon: "lock_open", label: "Toda a pesquisa liberada", hint: "Começa a partida com a árvore inteira já pesquisada." },
  { key: "god", icon: "shield", label: "Modo deus", hint: "Suas unidades e prédios não tomam dano e não morrem." },
  { key: "aiToo", icon: "smart_toy", label: "A IA também ganha", hint: "Para um desafio: os oponentes da IA recebem as mesmas trapaças." },
];
const SPEEDS = [1, 2, 5, 10, 25];

export function loadCheats(): CheatOptions {
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
  const any = o.menu || CHEAT_ROWS.some((r) => r.key !== "aiToo" && o[r.key]) || o.buildSpeed > 1;
  return (
    <Modal title={t("Trapaças para jogar sozinho")} icon="auto_fix_high" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        try { localStorage.setItem(CHEATS_KEY, JSON.stringify(o)); } catch { /* ok */ }
        const m = await run("cheats", () => api.buildCheats(o, true), () => installed ? t("Trapaças atualizadas.") : t("Trapaças instaladas e ativadas."));
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
                <div>{t(r.label)}</div>
                <div className="small faint">{t(r.hint)}</div>
              </div>
              <Switch label={t(r.label)} checked={o[r.key]} onChange={(v) => set({ [r.key]: v } as Partial<CheatOptions>)} />
            </div>
          ))}
        </div>
        <Field label={t("Velocidade de construção")} hint={t("Multiplica a velocidade de construção de todas as suas unidades e fábricas.")}>
          <div className="seg" role="group" aria-label={t("Velocidade de construção")}>
            {SPEEDS.map((s) => <button type="button" key={s} className="btn" aria-pressed={o.buildSpeed === s} onClick={() => set({ buildSpeed: s })}>{s === 1 ? t("Normal") : `${s}×`}</button>)}
          </div>
        </Field>
        <div className="row" style={{ gap: 12 }}>
          <Icon name="menu_open" size={20} />
          <div className="grow">
            <div>{t("Menu dentro do jogo")}</div>
            <div className="small faint">{t("Uma tecla abre um menu na partida para ligar e desligar cada trapaça quando quiser. As opções acima viram o estado inicial.")}</div>
          </div>
          <Switch label={t("Menu dentro do jogo")} checked={o.menu} onChange={(v) => set({ menu: v })} />
        </div>
        {o.menu && (
          <div className="row wrap" style={{ gap: 16 }}>
            <Field label={t("Tecla do menu")}>
              <div className="seg" role="group" aria-label={t("Tecla do menu")}>
                {MENU_KEYS.map((k) => <button type="button" key={k} className="btn" aria-pressed={o.key === k} onClick={() => set({ key: k })}>{k}</button>)}
              </div>
            </Field>
            <label className="row" style={{ gap: 8 }}>
              <Switch label={t("Botão CP na tela")} checked={o.tab} onChange={(v) => set({ tab: v })} /> {t('Botão "CP" na borda da tela')}
            </label>
          </div>
        )}
        <Notice kind="info">{t("O mod é montado agora com os arquivos do seu jogo e só vale em partidas com um único jogador humano (escaramuça contra a IA). Em multiplayer ele se desliga sozinho. Desligue o mod na lista quando quiser jogar normal.")}</Notice>
        {busy && <TaskProgress task="cheats" label={t("Montando o mod…")} />}
        <footer>
          <button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn primary" disabled={!any || busy}>{installed ? t("Atualizar trapaças") : t("Instalar e ativar")}</button>
        </footer>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ IA mais esperta

const AI_DEFAULT: AiOptions = {
  level: 1, naval: true, economy: true, commander: true, raids: true, personality: "mixed",
  air: true, micro: true, build: true, counter: true, team: true, adaptive: true, panel: true, panelKey: "F4",
  learn: true,
};
type AiToggle = "naval" | "economy" | "commander" | "raids" | "air" | "micro" | "build" | "counter" | "team" | "adaptive" | "panel" | "learn";
const AI_ROWS: { key: AiToggle; icon: string; label: string; hint: string; needsCommander?: boolean }[] = [
  { key: "commander", icon: "military_tech", label: "Comandante estratégico", hint: "Junta o exército antes de atacar, só ataca com vantagem, escolhe extratores e fábricas, defende as expansões, recua quando perde, manda feridos para casa e embosca no caminho da base." },
  { key: "air", icon: "flight", label: "Aviação estratégica", hint: "Caças pela superioridade aérea e escoltando o exército, bombardeiros em alvos sem antiaéreo, gunships apoiando o ataque.", needsCommander: true },
  { key: "micro", icon: "my_location", label: "Microgestão", hint: "Foco de fogo na unidade inimiga mais fraca, artilharia atrás da linha de frente, ataque em pinça, escolta de experimentais.", needsCommander: true },
  { key: "counter", icon: "radar", label: "Reconhecimento e contra-ataque", hint: "Batedores olham o que você constrói e as fábricas respondem: antiaéreo contra aviões, artilharia contra torres, navios contra frota.", needsCommander: true },
  { key: "build", icon: "domain", label: "Bairros, defesa e base espaçosa", hint: "Bairros em volta da base principal em chão bom (bastiões com torres virados para o inimigo, oficinas com fábricas, retaguarda com energia e pesquisa), prédios com ruas entre eles, torres onde uma expansão é atacada e posto avançado perto da frente.", needsCommander: true },
  { key: "raids", icon: "bolt", label: "Ataques-relâmpago e distração", hint: "Unidades rápidas atacam extratores sem defesa e, durante o ataque principal, um ponto longe dele.", needsCommander: true },
  { key: "team", icon: "groups", label: "IAs aliadas em equipe", hint: "Em 2v2 ou mais, atacam o mesmo alvo juntas e ajudam o aliado atacado.", needsCommander: true },
  { key: "learn", icon: "school", label: "Aprende o seu jeito de jogar", hint: "A IA observa o seu estilo (rush, defensivo, aéreo, naval, saque, economia, experimentais), quando você ataca, por onde passa e o que ataca, e se adapta: emboscada na sua rota, torres onde você costuma bater, guarda contra saques, produção contra o seu exército, contra-ataque depois de você atacar. Jogando sozinho, lembra entre partidas (no Game.prefs do jogo, por mapa).", needsCommander: true },
  { key: "adaptive", icon: "tune", label: "Dificuldade adaptativa", hint: "Se você estiver ganhando fácil, a IA pressiona mais e recebe um reforço pequeno; se estiver perdendo feio, ela segura um pouco.", needsCommander: true },
  { key: "panel", icon: "monitoring", label: "Painel \"o que a IA está pensando\"", hint: "Mostra no jogo o plano de cada IA: personalidade, alvo, exército, aviação e comandante. Só aparece jogando sozinho.", needsCommander: true },
  { key: "naval", icon: "sailing", label: "Navios em mapas com água", hint: "Todo tipo de IA constrói estaleiro quando há mar perto; a IA naval ganha quando a água separa os jogadores; corrige os navios que nunca eram produzidos." },
  { key: "economy", icon: "factory", label: "Economia e mini-bases", hint: "Mais engenheiros, expansões espalhadas pelo mapa mais cedo e em paralelo, mais extratores ao mesmo tempo, pesquisa sem atraso." },
];
const AI_PERSONALITIES: { key: AiPersonality; label: string; hint: string }[] = [
  { key: "mixed", label: "Misturadas", hint: "cada IA da partida sorteia um estilo" },
  { key: "balanced", label: "Equilibrada", hint: "paciente e versátil" },
  { key: "aggressive", label: "Agressiva", hint: "ataca cedo e com menos vantagem" },
  { key: "defensive", label: "Defensiva", hint: "muitas torres, exército grande antes de sair" },
  { key: "raider", label: "Saqueadora", hint: "muitos ataques-relâmpago em extratores" },
  { key: "naval", label: "Naval", hint: "frota sai mais cedo (Illuminate vira equilibrada)" },
  { key: "airborne", label: "Aérea", hint: "aviação mais agressiva" },
];

export function loadAi(): AiOptions {
  try {
    const raw = localStorage.getItem("cp-ai");
    if (raw) return { ...AI_DEFAULT, ...JSON.parse(raw) };
  } catch { /* sem armazenamento: usa o padrão */ }
  return AI_DEFAULT;
}

/** Monta e instala o mod "IA mais esperta". */
export function AiModal({ installed, onClose }: { installed: boolean; onClose: () => void }) {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.ai);
  const [o, setO] = useState<AiOptions>(loadAi);
  const set = (patch: Partial<AiOptions>) => setO((v) => ({ ...v, ...patch }));
  const any = o.naval || o.economy || o.commander;
  return (
    <Modal title={t("IA mais esperta")} icon="psychology" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        try { localStorage.setItem("cp-ai", JSON.stringify(o)); } catch { /* ok */ }
        const r = await run("ai", () => api.buildAi(o, true), (r) => {
          const head = installed ? t("IA atualizada") : t("IA instalada e ativada");
          return r.skipped.length
            ? t("{head}: {n} ajustes ({k} não serviram nesta versão do jogo).", { head, n: r.applied, k: r.skipped.length })
            : t("{head}: {n} ajustes.", { head, n: r.applied });
        });
        if (r) {
          await refreshMods();
          onClose();
        }
      }}>
        <Field label={t("Nível")} hint={t("Vale para todas as dificuldades da escaramuça (Fácil continua mais fácil que Difícil).")}>
          <div className="seg" role="group" aria-label={t("Nível da IA")}>
            <button type="button" className="btn" aria-pressed={o.level === 1} onClick={() => set({ level: 1 })}>{t("Esperta")}</button>
            <button type="button" className="btn" aria-pressed={o.level === 2} onClick={() => set({ level: 2 })}>{t("Brutal")}</button>
          </div>
        </Field>
        <Field label={t("Personalidade")} hint={t(AI_PERSONALITIES.find((p) => p.key === o.personality)?.hint ?? "")}>
          <div className="seg wrap" role="group" aria-label={t("Personalidade da IA")}>
            {AI_PERSONALITIES.map((p) => <button type="button" key={p.key} className="btn" aria-pressed={o.personality === p.key} disabled={!o.commander} onClick={() => set({ personality: p.key })}>{t(p.label)}</button>)}
          </div>
        </Field>
        <div className="col" style={{ gap: 10 }}>
          {AI_ROWS.map((r) => {
            const off = !!r.needsCommander && !o.commander;
            return (
              <div key={r.key} className="row" style={{ gap: 12, opacity: off ? 0.5 : 1 }}>
                <Icon name={r.icon} size={20} />
                <div className="grow">
                  <div>{t(r.label)}</div>
                  <div className="small faint">{t(r.hint)}</div>
                </div>
                <Switch label={t(r.label)} checked={o[r.key]} disabled={off} onChange={(v) => set({ [r.key]: v } as Partial<AiOptions>)} />
              </div>
            );
          })}
        </div>
        {o.commander && o.panel && (
          <Field label={t("Tecla do painel")} hint={t('Também abre pelo botão "IA" na borda esquerda da tela. Use uma tecla diferente da do menu de trapaças.')}>
            <div className="seg" role="group" aria-label={t("Tecla do painel")}>
              {MENU_KEYS.map((k) => <button type="button" key={k} className="btn" aria-pressed={o.panelKey === k} onClick={() => set({ panelKey: k })}>{k}</button>)}
            </div>
          </Field>
        )}
        {o.commander && o.learn && <Notice kind="info">{t("Se você usa as Trapaças, clique em Atualizar trapaças depois desta versão: os dois mods dividem um arquivo do jogo e as trapaças antigas não levam o canal da memória da IA.")}</Notice>}
        {o.commander && o.learn && <AiMemoryCard />}
        <Notice kind="info">{t("O mod é montado agora com os arquivos de IA do seu jogo (incluindo os da expansão). Mexe no comportamento da IA, então todos numa partida multiplayer precisam ter o mesmo mod. Desligue na lista para voltar à IA original.")}</Notice>
        {busy && <TaskProgress task="ai" label={t("Montando a IA…")} />}
        <footer>
          <button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn primary" disabled={!any || busy}>{installed ? t("Atualizar IA") : t("Instalar e ativar")}</button>
        </footer>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ o que a IA aprendeu

const STYLE_LABEL: Record<string, string> = {
  rush: "Rush (ataca cedo)", turtle: "Defensivo (muitas torres)", air: "Aéreo", naval: "Naval",
  raider: "Saqueador", eco: "Econômico (muitas expansões)", tech: "Experimentais",
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** O que a IA guardou sobre o jogador no Game.prefs (só leitura; para esquecer, botão no painel F4 do jogo). */
export function AiMemoryCard() {
  const [report, setReport] = useState<AiMemoryReport | null>(null);
  useEffect(() => { api.aiMemory().then(setReport).catch(() => setReport(null)); }, []);
  if (!report) return null;
  const profile = report.profiles.find((p) => p.current) ?? report.profiles[0];
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}><Icon name="school" size={18} /><strong>{t("O que a IA aprendeu sobre você")}</strong></div>
      {report.error && <div className="small faint">{tr(report.error)}</div>}
      {!report.error && !profile && <div className="small faint">{t('Ainda nada: jogue uma escaramuça sozinho contra a IA com "Aprende o seu jeito de jogar" ligado.')}</div>}
      {profile && (
        <>
          <div className="small faint">{t("Perfil {name}", { name: profile.name })} · {profile.games === 1 ? t("1 partida lembrada") : t("{n} partidas lembradas", { n: profile.games })}{profile.firstAttack ? ` · ${t("primeiro ataque perto de {time}", { time: mmss(profile.firstAttack) })}` : ""}</div>
          <div className="col" style={{ gap: 4 }}>
            {profile.style.filter(([, v]) => v >= 0.05).slice(0, 5).map(([k, v]) => (
              <div key={k} className="row" style={{ gap: 8 }}>
                <span className="small" style={{ width: 190 }}>{STYLE_LABEL[k] ? t(STYLE_LABEL[k]) : k}</span>
                <div className="grow" style={{ height: 6, borderRadius: 3, background: "var(--surface-bright)" }}>
                  <div style={{ width: `${Math.round(v * 100)}%`, height: "100%", borderRadius: 3, background: "var(--primary)" }} />
                </div>
                <span className="small faint" style={{ width: 36, textAlign: "right" }}>{Math.round(v * 100)}%</span>
              </div>
            ))}
          </div>
          {profile.maps.length > 0 && (
            <div className="small faint">{t("Mapas: {list}", { list: profile.maps.slice(0, 4).map((m) => t("{map} ({games}× · {routes} rotas, {hits} pontos que você ataca)", { map: m.map, games: m.games, routes: m.routes, hits: m.hits })).join(" · ") })}</div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ otimização

const fpsLabel = (f: number) => (f === 0 ? t("100 FPS (o do jogo)") : `${f} FPS`);

/** Monta o mod de otimização: limite de FPS no jogo e ajustes do Windows para o executável. */
export function OptimizeModal({ onClose }: { onClose: () => void }) {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.optimize);
  const [st, setSt] = useState<OptimizeState | null>(null);
  const [o, setO] = useState<OptimizeOptions | null>(null);
  useEffect(() => {
    api.optimizeStatus().then((s) => { setSt(s); setO(s.options); }).catch(() => setSt(null));
  }, []);
  const set = (patch: Partial<OptimizeOptions>) => setO((v) => (v ? { ...v, ...patch } : v));
  const win = st?.windows.supported !== false;
  const rows: { key: "gpu" | "fullscreenFix" | "noThrottle" | "largeAddress"; icon: string; label: string; hint: string; win?: boolean; now?: boolean }[] = [
    { key: "gpu", icon: "developer_board", label: t("Usar a placa de vídeo dedicada"), hint: t("Em notebooks e PCs com duas placas (integrada + dedicada), o Windows passa a abrir o jogo sempre na mais forte. É a mesma opção de Configurações → Sistema → Tela → Gráficos."), win: true, now: st?.windows.gpu },
    { key: "fullscreenFix", icon: "fullscreen", label: t('Desligar as "otimizações de tela cheia" do Windows'), hint: t("Jogos DirectX 9 costumam rodar mais lisos e com menos atraso no mouse assim. É a caixa de Propriedades → Compatibilidade do executável."), win: true, now: st?.windows.fullscreenFix },
    { key: "noThrottle", icon: "bolt", label: t("Sem economia de energia no jogo"), hint: t("O Windows não reduz a velocidade do jogo quando acha que ele está em segundo plano (Windows 10/11, principalmente em notebooks)."), win: true, now: st?.noThrottle },
    { key: "largeAddress", icon: "memory", label: t("Modo 4 GB"), hint: t("O jogo (32 bits) passa a poder usar até 4 GB de memória em vez de 2 GB: menos travamentos em mapas grandes e partidas com muitos jogadores."), now: st?.largeAddress },
  ];
  return (
    <Modal title={t("Otimização")} icon="speed" onClose={onClose}>
      {!st || !o ? <div className="bar indeterminate"><i /></div> : (
        <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
          e.preventDefault();
          const r = await run("optimize", () => api.buildOptimize(o, true), () => st.installed ? t("Otimização atualizada.") : t("Otimização instalada e ativada."));
          if (r) {
            setSt(r);
            await refreshMods();
            onClose();
          }
        }}>
          <p className="muted small">{t("Ajustes que deixam o jogo mais leve sem tirar nada dele: nenhuma unidade, efeito ou textura é removida. O ganho depende do seu PC; compare no monitor do Otimizador.")}</p>
          <Field label={t("Limite de FPS nas partidas")} hint={t("O jogo vem travado em 100 FPS. Com monitor de 120/144 Hz ou mais, um limite maior deixa a imagem mais lisa; um limite menor alivia a placa de vídeo e o processador.")}>
            <select className="select" value={o.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>
              {st.fpsChoices.map((f) => <option key={f} value={f}>{fpsLabel(f)}</option>)}
            </select>
          </Field>
          <Field label={t("Limite nas partidas grandes (mais de 8 jogadores)")} hint={t("Com muitas IAs quem pesa é a simulação: menos quadros desenhados sobram processador para ela e a partida fica mais estável.")}>
            <select className="select" value={o.bigFps} onChange={(e) => set({ bigFps: Number(e.target.value) })}>
              <option value={0}>{t("O mesmo das outras partidas")}</option>
              {st.fpsChoices.filter((f) => f > 0).map((f) => <option key={f} value={f}>{f} FPS</option>)}
            </select>
          </Field>
          <Field label={t("Prioridade do jogo")} hint={t("O Windows dá mais tempo de processador ao jogo do que a programas em segundo plano. “Alta” pode deixar o resto do PC lento enquanto joga.")}>
            <div className="seg" role="group" aria-label={t("Prioridade do jogo")}>
              {[["normal", "Normal"], ["above_normal", "Acima do normal"], ["high", "Alta"]].map(([k, l]) => <button type="button" key={k} className="btn" aria-pressed={o.priority === k} onClick={() => set({ priority: k })}>{t(l)}</button>)}
            </div>
          </Field>
          <div className="col" style={{ gap: 10 }}>
            {rows.map((r) => {
              const off = !!r.win && !win;
              return (
                <div key={r.key} className="row" style={{ gap: 12, opacity: off ? 0.5 : 1 }}>
                  <Icon name={r.icon} size={20} />
                  <div className="grow">
                    <div>{r.label} {r.now && <span className="chip ok">{t("ligado")}</span>}</div>
                    <div className="small faint">{off ? t("Só no Windows.") : r.hint}</div>
                  </div>
                  <Switch label={r.label} checked={o[r.key]} disabled={off} onChange={(v) => set({ [r.key]: v } as Partial<OptimizeOptions>)} />
                </div>
              );
            })}
          </div>
          <Notice kind="info">{t("O limite de FPS vai num mod pequeno montado com o arquivo de interface do seu jogo (vale só no seu PC, não muda a simulação). Os ajustes do Windows valem só para o executável do Supreme Commander 2 e podem ser desfeitos aqui.")}</Notice>
          {busy && <TaskProgress task="optimize" label={t("Montando a otimização…")} />}
          <footer>
            {st.installed && win && (st.windows.gpu || st.windows.fullscreenFix || st.noThrottle) && (
              <button type="button" className="btn text" onClick={async () => {
                const r = await run("optimize", () => api.optimizeUndoWindows(), t("Ajustes do Windows desfeitos."));
                if (r) { setSt(r); set({ gpu: false, fullscreenFix: false, noThrottle: false }); }
              }}>{t("Desfazer ajustes do Windows")}</button>
            )}
            <span className="grow" />
            <button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button>
            <button className="btn primary" disabled={busy}>{st.installed ? t("Atualizar otimização") : t("Instalar e ativar")}</button>
          </footer>
        </form>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ primeira pessoa

const FP_KEY = "cp-fp";
/** versão do mod montado por esta versão do launcher (igual a `firstperson::MOD_VERSION`) */
export const FP_VERSION = "1.2.0";
/** a mesma de cp_core::aimod::MOD_VERSION */
export const AI_VERSION = "2.0.0";
export const FP_DEFAULT: FirstPersonOptions = { key: "F5", hud: true, drive: true, firstZoom: 14, thirdZoom: 38 };
const FP_KEYS = ["F5", "F6", "F7", "F8", "F11", "Home", "Insert"];

export function loadFirstPerson(): FirstPersonOptions {
  try {
    const raw = localStorage.getItem(FP_KEY);
    if (raw) return { ...FP_DEFAULT, ...JSON.parse(raw) };
  } catch { /* sem armazenamento: usa o padrão */ }
  return FP_DEFAULT;
}

/** Monta e instala o mod Primeira Pessoa com as opções escolhidas. */
export function FirstPersonModal({ installed, onClose }: { installed: boolean; onClose: () => void }) {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.fp);
  const [o, setO] = useState<FirstPersonOptions>(loadFirstPerson);
  const set = (patch: Partial<FirstPersonOptions>) => setO((v) => ({ ...v, ...patch }));
  const modes: { icon: string; title: string; text: string }[] = [
    { icon: "visibility", title: t("Primeira pessoa"), text: t("Uma unidade selecionada + {key}: a câmera fica na cabeça da unidade (robô, tanque, avião, navio ou construtor), no tamanho do modelo dela, e vira junto quando ela anda. W A S D andam para onde você olha, como num jogo de ação; segure o botão do meio do mouse e mova para olhar em volta (ou use Q/E).", { key: o.key }) },
    { icon: "3d_rotation", title: t("Terceira pessoa"), text: t("{key} de novo: a câmera fica atrás da unidade e a segue pelo terreno; botão do meio + mouse (ou Q/E) giram a vista e a roda do mouse dá zoom.", { key: o.key }) },
    { icon: "groups", title: t("Câmera de comando"), text: t("Várias unidades selecionadas: câmera acima e atrás da formação, acompanhando o grupo, e as ordens vão para todos.") },
    { icon: "construction", title: t("Construtores"), text: t("O menu de construção, o posicionamento dos prédios e as habilidades funcionam em qualquer câmera, como no jogo.") },
  ];
  return (
    <Modal title={t("Primeira Pessoa")} icon="videocam" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        try { localStorage.setItem(FP_KEY, JSON.stringify(o)); } catch { /* ok */ }
        const m = await run("fp", () => api.buildFirstPerson(o, true), () => installed ? t("Primeira Pessoa atualizada.") : t("Primeira Pessoa instalada e ativada."));
        if (m) {
          await refreshMods();
          onClose();
        }
      }}>
        <div className="col" style={{ gap: 10 }}>
          {modes.map((m) => (
            <div key={m.title} className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <Icon name={m.icon} size={20} />
              <div className="grow"><div>{m.title}</div><div className="small faint">{m.text}</div></div>
            </div>
          ))}
        </div>
        <Field label={t("Tecla que troca a câmera")} hint={t("Sem nada selecionado, {key} continua fazendo o que fazia no jogo.", { key: o.key })}>
          <div className="seg" role="group" aria-label={t("Tecla da câmera")}>
            {FP_KEYS.map((k) => <button type="button" key={k} className="btn" aria-pressed={o.key === k} onClick={() => set({ key: k })}>{k}</button>)}
          </div>
        </Field>
        <div className="row" style={{ gap: 12 }}>
          <Icon name="keyboard" size={20} />
          <div className="grow">
            <div>{t("Controle direto pelo teclado")}</div>
            <div className="small faint">{t("Enquanto a câmera está ligada: W A S D andam para onde a câmera olha (a unidade ou o grupo inteiro), botão do meio + mouse ou Q/E olham em volta, F atira no que está sob o mouse, X para, R troca 1ª/3ª pessoa e Esc volta. Desligado, essas teclas mantêm as funções do jogo e você comanda com o botão direito.")}</div>
          </div>
          <Switch label={t("Controle pelo teclado")} checked={o.drive} onChange={(v) => set({ drive: v })} />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Icon name="center_focus_strong" size={20} />
          <div className="grow"><div>{t("Mira e painel na tela")}</div><div className="small faint">{t("Mira no centro em primeira pessoa e um painel com o modo, a unidade, a vida e as teclas.")}</div></div>
          <Switch label={t("Mira e painel")} checked={o.hud} onChange={(v) => set({ hud: v })} />
        </div>
        <Field label={t("Distância em terceira pessoa: {n}", { n: o.thirdZoom })}>
          <input type="range" min={15} max={120} step={1} value={o.thirdZoom} onChange={(e) => set({ thirdZoom: Number(e.target.value) })} aria-label={t("Distância em terceira pessoa")} />
        </Field>
        <Notice kind="info">{t("O mod é montado agora com os arquivos de interface e de simulação do seu jogo. As ordens passam pela simulação como as do próprio jogo (valem em multiplayer, mas todos na partida precisam ter o mod). Desligue na lista para voltar ao normal.")}</Notice>
        {busy && <TaskProgress task="fp" label={t("Montando a primeira pessoa…")} />}
        <footer>
          <button type="button" className="btn text" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn primary" disabled={busy}>{installed ? t("Atualizar") : t("Instalar e ativar")}</button>
        </footer>
      </form>
    </Modal>
  );
}
