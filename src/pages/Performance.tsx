// Otimizador: o "mod de melhoria" que vem com o launcher. Tudo opcional e reversível, e nada de
// promessa de FPS: o monitor mostra a memória e a CPU do jogo para o jogador comparar de verdade.
import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Icon, Modal, Notice } from "../components/ui";
import { api, confirmDialog } from "../lib/api";
import { errorText, useStore } from "../lib/store";
import { locale, t, tr } from "../lib/i18n";
import type { ConflictReport, CrashDump, PerfReport, PrefValue, ProcessStats } from "../lib/types";
import { MemoryLimit } from "./Settings";
import { OptimizeModal } from "../components/dialogs";

const PRIORITY: Record<string, { label: string; text: string }> = {
  normal: { label: "Normal", text: "Como o Windows decide. Recomendado." },
  above_normal: { label: "Acima do normal", text: "O jogo ganha preferência quando há programas disputando a CPU (navegador, gravação)." },
  high: { label: "Alta", text: "Só se o jogo engasgar com programas em segundo plano: pode deixar o resto do PC lento." },
};

const fmtSize = (b: number) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "—");
const fmtTime = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : t("{n} min", { n: Math.floor(s / 60) }));
const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;

export default function Performance() {
  const { toast, go } = useStore.getState();
  const [rep, setRep] = useState<PerfReport | null | undefined>(undefined);
  const [conf, setConf] = useState<ConflictReport | null>(null);
  const [opt, setOpt] = useState(false);
  const reload = async () => {
    try { setRep(await api.perfReport()); } catch (e) { setRep(null); toast("error", errorText(e)); }
  };
  useEffect(() => {
    void reload();
    void api.conflicts().then(setConf).catch(() => setConf(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page perf-page">
      <header className="perf-hero">
        <div>
          <span className="overline"><Icon name="speed" size={15} /> {t("Otimizador incluso no launcher")}</span>
          <h1>{t("Desempenho e diagnóstico")}</h1>
          <p className="muted">{t("Ferramentas opcionais para o SC2 rodar estável: memória, prioridade, perfis de opções do jogo, análise de travamentos e conflitos de mods. Tudo é reversível e nada muda arquivos do jogo sem cópia de segurança.")}</p>
        </div>
        <Notice kind="info">
          {t("Não prometemos FPS: o ganho depende do seu PC.")} {t("Use o")} <b>{t("monitor")}</b> {t("abaixo para comparar antes e depois de cada mudança, sempre com o mesmo mapa e a mesma partida.")}
        </Notice>
      </header>

      {rep === undefined && <div className="bar indeterminate"><i /></div>}
      {rep === null && <Empty icon="error" title={t("Não deu para ler o estado do jogo")}>{t("Confira a pasta do jogo nas Configurações.")}</Empty>}
      {rep && (
        <>
          <GameStatus rep={rep} conf={conf} onGo={go} />
          <Monitor />
          <section className="card pad col">
            <div className="card-title"><Icon name="memory" /><h3>{t("Memória")}</h3></div>
            <MemoryLimit />
          </section>
          <Priority rep={rep} onChange={(priority) => setRep({ ...rep, priority })} />
          <GameOptions rep={rep} reload={reload} />
          <Crashes rep={rep} reload={reload} />
          <Conflicts conf={conf} onGo={go} />
          <section className="card pad col">
            <div className="card-title"><Icon name="auto_awesome" /><h3>{t("Mais melhorias")}</h3></div>
            <div className="perf-links">
              <button className="perf-link" onClick={() => setOpt(true)}><Icon name="speed" size={26} /><b>{t("Mod de otimização")}</b><span>{t("Limite de FPS (até 240), placa de vídeo dedicada e ajustes do Windows para o jogo. Não remove nada.")}</span></button>
              <button className="perf-link" onClick={() => go("studio")}><Icon name="hd" size={26} /><b>{t("Remaster HD")}</b><span>{t("Gera um mod com texturas maiores, mais nítidas e mais ricas. Usa mais memória de vídeo.")}</span></button>
              <button className="perf-link" onClick={() => go("studio")}><Icon name="auto_fix_high" size={26} /><b>{t("Shaders (ReShade)")}</b><span>{t("Cor e nitidez melhores. Custa um pouco de desempenho; dá para desligar.")}</span></button>
              <button className="perf-link" onClick={() => go("library")}><Icon name="extension" size={26} /><b>{t("Mods ligados ({n})", { n: rep.modsEnabled })}</b><span>{t("Menos mods = carregamento mais rápido e menos chance de conflito.")}</span></button>
            </div>
          </section>
        </>
      )}
      {opt && <OptimizeModal onClose={() => { setOpt(false); void reload(); }} />}
    </div>
  );
}

function GameStatus({ rep, conf, onGo }: { rep: PerfReport; conf: ConflictReport | null; onGo: (p: "library" | "settings") => void }) {
  const recent = rep.dumps.filter((d) => d.modified && Date.now() - new Date(d.modified).getTime() < 7 * 864e5).length;
  const tiles: { icon: string; label: string; value: string; tone: "ok" | "warn" | "err" | ""; detail: string; onClick?: () => void }[] = [
    {
      icon: "verified", label: t("Versão do jogo"), value: rep.version ?? "—",
      tone: rep.latest === true ? "ok" : rep.latest === false ? "warn" : "",
      detail: rep.latest === true ? t("Atualizada (final {version})", { version: rep.knownLatest }) : rep.latest === false ? t("Desatualizada: a final é {version}. Atualize pela Steam.", { version: rep.knownLatest }) : rep.exe ? t("Não deu para ler a versão") : t("Jogo não encontrado"),
      onClick: rep.exe ? undefined : () => onGo("settings"),
    },
    { icon: "extension", label: t("Mods ligados"), value: String(rep.modsEnabled), tone: rep.modsEnabled > 25 ? "warn" : "", detail: rep.modsEnabled > 25 ? t("Muitos mods: o jogo demora mais para abrir") : t("No perfil ativo"), onClick: () => onGo("library") },
    { icon: "report", label: t("Travamentos (7 dias)"), value: String(recent), tone: recent ? "err" : "ok", detail: rep.dumps.length ? t("{n} relatório(s) na pasta do jogo", { n: rep.dumps.length }) : t("Nenhum relatório de travamento") },
    { icon: "call_split", label: t("Conflitos entre mods"), value: conf ? String(conf.betweenMods.length) : "…", tone: conf && conf.betweenMods.length ? "warn" : "ok", detail: conf && conf.betweenMods.length ? t("Arquivos fornecidos por mais de um mod") : t("Nenhum arquivo disputado"), onClick: () => onGo("library") },
  ];
  return (
    <section className="perf-tiles">
      {tiles.map((x) => (
        <button key={x.label} className={`perf-tile ${x.tone}`} onClick={x.onClick} disabled={!x.onClick}>
          <Icon name={x.icon} size={22} />
          <span className="overline">{x.label}</span>
          <b>{x.value}</b>
          <span className="small muted">{x.detail}</span>
        </button>
      ))}
    </section>
  );
}

/** Mede o processo do jogo a cada 3 s enquanto a aba estiver aberta. */
function Monitor() {
  const [stats, setStats] = useState<ProcessStats | null | undefined>(undefined);
  const [hist, setHist] = useState<{ mem: number; virt: number; cpu: number }[]>([]);
  const [on, setOn] = useState(true);
  const peak = useRef(0);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const tick = async () => {
      const s = await api.perfProcess().catch(() => null);
      if (!alive) return;
      setStats(s);
      if (s) {
        peak.current = Math.max(peak.current, s.virtualMb);
        setHist((h) => [...h.slice(-59), { mem: s.memoryMb, virt: s.virtualMb, cpu: s.cpuPercent }]);
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [on]);
  const virtPct = stats ? Math.min(100, (stats.virtualMb / 4096) * 100) : 0;
  return (
    <section className="card pad col">
      <div className="card-title">
        <Icon name="monitor_heart" /><h3>{t("Monitor do jogo")}</h3>
        <button className="btn sm text" onClick={() => setOn((v) => !v)}><Icon name={on ? "pause" : "play_arrow"} size={16} /> {on ? t("Pausar") : t("Retomar")}</button>
      </div>
      {stats === undefined ? <div className="bar indeterminate"><i /></div> : !stats ? (
        <p className="muted small">{t("O jogo não está aberto. Abra uma partida e volte aqui: o monitor mostra memória, espaço de endereços (o limite de 2/4 GB de um jogo de 32 bits) e CPU em tempo real.")}</p>
      ) : (
        <div className="perf-monitor">
          <div className="perf-gauges">
            <div><span className="overline">{t("Memória em uso")}</span><b>{stats.memoryMb.toLocaleString(locale())} MB</b></div>
            <div>
              <span className="overline">{t("Espaço de endereços")}</span><b>{(stats.virtualMb / 1024).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GB</b>
              <span className={`perf-meter ${virtPct > 90 ? "err" : virtPct > 75 ? "warn" : ""}`}><i style={{ width: `${virtPct}%` }} /></span>
              <span className="faint small">{t("pico {size} GB de 4 GB", { size: (peak.current / 1024).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}</span>
            </div>
            <div><span className="overline">CPU</span><b>{stats.cpuPercent.toFixed(0)}%</b><span className="faint small">{t("soma dos núcleos")}</span></div>
            <div><span className="overline">{t("Aberto há")}</span><b>{fmtTime(stats.runSeconds)}</b><span className="faint small">PID {stats.pid}</span></div>
          </div>
          <Spark hist={hist} />
          {virtPct > 90 && <Notice kind="warn">{t("O jogo está perto do limite de memória de um programa de 32 bits. Se travar, ligue o modo 4 GB (acima) ou desligue mods de texturas HD.")}</Notice>}
        </div>
      )}
    </section>
  );
}

function Spark({ hist }: { hist: { mem: number; virt: number; cpu: number }[] }) {
  if (hist.length < 2) return null;
  const w = 600, h = 90;
  const max = Math.max(1024, ...hist.map((x) => x.virt));
  const line = (k: "mem" | "virt") => hist.map((x, i) => `${(i / (hist.length - 1)) * w},${h - (x[k] / max) * (h - 6) - 3}`).join(" ");
  return (
    <svg className="perf-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={t("Memória do jogo nos últimos minutos")}>
      <polyline points={line("virt")} fill="none" stroke="var(--warn)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <polyline points={line("mem")} fill="none" stroke="var(--primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Priority({ rep, onChange }: { rep: PerfReport; onChange: (p: string) => void }) {
  const { run } = useStore.getState();
  return (
    <section className="card pad col">
      <div className="card-title"><Icon name="low_priority" /><h3>{t("Prioridade do processo")}</h3></div>
      <p className="muted small" style={{ marginTop: -6 }}>{t("Aplicada pelo launcher logo que o jogo abre (Windows). Não altera o executável e vale só para essa sessão do jogo.")}</p>
      <div className="mem-choices" role="radiogroup" aria-label={t("Prioridade do jogo")}>
        {rep.priorities.map((p) => (
          <button key={p} role="radio" aria-checked={rep.priority === p} className="mem-choice" onClick={async () => {
            const r = await run("priority", () => api.perfSetPriority(p), t("Prioridade: {level}. Vale a partir do próximo “Jogar”.", { level: PRIORITY[p] ? t(PRIORITY[p].label) : p }));
            if (r) onChange(r);
          }}>
            <b>{PRIORITY[p] ? t(PRIORITY[p].label) : p}</b><span>{PRIORITY[p] ? t(PRIORITY[p].text) : ""}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Opções que o próprio jogo grava (Game.prefs): edição com backup, perfis e restauração. */
function GameOptions({ rep, reload }: { rep: PerfReport; reload: () => Promise<void> }) {
  const { run, toast } = useStore.getState();
  const [edits, setEdits] = useState<Record<string, PrefValue>>({});
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState<null | "profile">(null);
  const [pname, setPname] = useState("");
  const [pdesc, setPdesc] = useState("");
  const [showBackups, setShowBackups] = useState(false);
  const prefs = rep.prefs;
  const opts = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (prefs?.options ?? []).filter((o) => !f || o.path.toLowerCase().includes(f));
  }, [prefs, filter]);
  const dirty = Object.keys(edits).length;

  if (!prefs) {
    return (
      <section className="card pad col">
        <div className="card-title"><Icon name="tune" /><h3>{t("Opções do jogo")}</h3></div>
        <p className="muted small">{t("As opções do SC2 ficam em {path}, que só existe no Windows.", { path: "“%LOCALAPPDATA%\\Gas Powered Games\\Supreme Commander 2\\Game.prefs”" })}</p>
      </section>
    );
  }
  const saveEdits = async () => {
    const r = await run("prefs", () => api.perfPrefsSet(Object.entries(edits)));
    if (!r) return;
    toast("ok", r.changed ? t("{n} opção(ões) alterada(s). Backup: {backup}.", { n: r.changed, backup: r.backup }) : t("Nada mudou."));
    setEdits({});
    await reload();
  };
  const label = (p: string) => p.replace(/^options\./, "").replace(/_/g, " ");

  return (
    <section className="card pad col">
      <div className="card-title">
        <Icon name="tune" /><h3>{t("Opções do jogo e perfis")}</h3>
        <button className="btn sm text" onClick={() => setShowBackups(true)}><Icon name="history" size={16} /> {t("Backups ({n})", { n: rep.backups.length })}</button>
      </div>
      {!prefs.exists ? <p className="muted small">{t("O jogo ainda não gravou as opções. Abra o SC2 uma vez, mude algo em Opções e feche.")}</p>
        : prefs.error ? <Notice kind="warn">{t("O launcher não entendeu o arquivo de opções ({error}) e por isso não vai mexer nele.", { error: tr(prefs.error) })}</Notice> : (
        <>
          <p className="muted small" style={{ marginTop: -6 }}>
            <b>{t("Perfis")}</b> {t("guardam todas as opções gráficas do jogo de uma vez. Ajuste no jogo para desempenho (sombras e efeitos baixos), salve como “Desempenho”; ajuste para qualidade, salve como “Qualidade”; depois troque com um clique antes de jogar. Toda troca faz backup do arquivo antes.")}
          </p>
          <div className="perf-profiles">
            {rep.profiles.map((p) => (
              <div key={p.id} className="perf-profile">
                <Icon name="bookmark" size={20} />
                <div className="grow"><b>{p.name}</b><span className="faint small">{p.description || t("{n} opções", { n: p.values.length })} · {fmtDate(p.createdAt)}</span></div>
                <button className="btn sm" onClick={async () => {
                  const r = await run("prefs", () => api.perfProfileApply(p.id));
                  if (r) { toast("ok", r.changed ? t("Perfil “{name}” aplicado ({n} opções).", { name: p.name, n: r.changed }) + (r.skipped.length ? " " + t("{n} opção(ões) não existem mais e foram ignoradas.", { n: r.skipped.length }) : "") : t("O jogo já está com o perfil “{name}”.", { name: p.name })); await reload(); }
                }}>{t("Aplicar")}</button>
                <button className="btn sm text" aria-label={t("Apagar perfil")} onClick={async () => {
                  if (!(await confirmDialog(t("Apagar o perfil “{name}”? As opções do jogo não mudam.", { name: p.name }), t("Apagar")))) return;
                  await run("prefs", () => api.perfProfileDelete(p.id), t("Perfil apagado."));
                  await reload();
                }}><Icon name="delete" size={16} /></button>
              </div>
            ))}
            <button className="perf-profile add" onClick={() => setSaving("profile")}><Icon name="add" size={20} /><b>{t("Salvar opções atuais como perfil")}</b></button>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <div className="search-bar grow"><Icon name="search" /><input className="input dense" placeholder={t("Filtrar {n} opções (ex.: shadow, fidelity)", { n: prefs.options.length })} value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
            {dirty > 0 && <>
              <button className="btn text" onClick={() => setEdits({})}>{t("Descartar")}</button>
              <button className="btn primary" onClick={() => void saveEdits()}><Icon name="save" size={17} /> {t("Salvar {n} mudança(s)", { n: dirty })}</button>
            </>}
          </div>
          <div className="perf-options">
            {opts.slice(0, 200).map((o) => {
              const v = o.path in edits ? edits[o.path] : o.value;
              const set = (nv: PrefValue) => setEdits((e) => { const n = { ...e }; if (nv === o.value) delete n[o.path]; else n[o.path] = nv; return n; });
              return (
                <label key={o.path} className={`perf-opt ${o.path in edits ? "changed" : ""}`} title={o.path}>
                  <span className="grow">{label(o.path)}</span>
                  {typeof o.value === "boolean" ? <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(e.target.checked)} />
                    : typeof o.value === "number" ? <input className="pinput" style={{ width: 90 }} type="number" value={Number(v)} onChange={(e) => set(Number(e.target.value))} />
                    : <input className="pinput" style={{ width: 180 }} value={String(v)} onChange={(e) => set(e.target.value)} />}
                </label>
              );
            })}
            {!opts.length && <p className="faint small">{t("Nenhuma opção com esse filtro.")}</p>}
          </div>
          <p className="faint small">{t("Arquivo:")} <code>{prefs.path}</code>. {t("Feche o jogo antes de salvar: ele regrava as opções ao sair.")}</p>
        </>
      )}

      {saving === "profile" && (
        <Modal title={t("Salvar perfil de opções")} icon="bookmark" onClose={() => setSaving(null)}>
          <form className="col" style={{ gap: 12 }} onSubmit={async (e) => {
            e.preventDefault();
            const r = await run("prefs", () => api.perfProfileSave(pname, pdesc), (x) => t("Perfil “{name}” salvo com {n} opções.", { name: x.name, n: x.values.length }));
            if (r) { setSaving(null); setPname(""); setPdesc(""); await reload(); }
          }}>
            <p className="muted small">{t("Guarda as opções que estão no jogo agora. Dica: nomes como “Desempenho”, “Qualidade” ou “Gravação”.")}</p>
            <label className="field"><span className="label">{t("Nome")}</span><input className="input" autoFocus value={pname} maxLength={40} onChange={(e) => setPname(e.target.value)} placeholder={t("Desempenho")} /></label>
            <label className="field"><span className="label">{t("Descrição (opcional)")}</span><input className="input" value={pdesc} maxLength={200} onChange={(e) => setPdesc(e.target.value)} placeholder={t("Sombras baixas, sem anti-aliasing")} /></label>
            <footer><button type="button" className="btn text" onClick={() => setSaving(null)}>{t("Cancelar")}</button><button className="btn primary" disabled={!pname.trim()}>{t("Salvar")}</button></footer>
          </form>
        </Modal>
      )}
      {showBackups && (
        <Modal title={t("Backups das opções do jogo")} icon="history" onClose={() => setShowBackups(false)}>
          <div className="col" style={{ gap: 8 }}>
            <p className="muted small">{t("Cópias feitas antes de cada alteração (as 30 mais recentes). Restaurar também guarda o arquivo atual antes.")}</p>
            <button className="btn sm" style={{ alignSelf: "flex-start" }} disabled={!prefs.exists} onClick={async () => { const r = await run("prefs", () => api.perfBackupNow(), (n) => t("Backup criado: {name}", { name: n })); if (r) await reload(); }}><Icon name="add" size={16} /> {t("Fazer backup agora")}</button>
            {rep.backups.length === 0 ? <p className="faint small">{t("Nenhum backup ainda.")}</p> : rep.backups.map((b) => (
              <div key={b.name} className="anim-row">
                <Icon name="description" size={18} />
                <span className="grow small"><b>{fmtDate(b.modified)}</b> <span className="faint">{b.name} · {fmtSize(b.size)}</span></span>
                <button className="btn sm" onClick={async () => {
                  if (!(await confirmDialog(t("Voltar as opções do jogo para {date}?", { date: fmtDate(b.modified) }), t("Restaurar")))) return;
                  const r = await run("prefs", () => api.perfBackupRestore(b.name), t("Opções restauradas."));
                  if (r !== undefined) await reload();
                }}>{t("Restaurar")}</button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}

function Crashes({ rep, reload }: { rep: PerfReport; reload: () => Promise<void> }) {
  const { run } = useStore.getState();
  const [open, setOpen] = useState<CrashDump | null>(null);
  const dumps = rep.dumps;
  const clean = async (names: string[]) => {
    if (!(await confirmDialog(t("Apagar {n} relatório(s) de travamento? Eles só servem para diagnóstico.", { n: names.length }), t("Apagar")))) return;
    await run("dumps", () => api.perfDumpsDelete(names), (n) => t("{n} relatório(s) apagado(s).", { n }));
    await reload();
  };
  // agrupa por módulo culpado: mostra o padrão (ex.: sempre no som)
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of dumps) { const k = d.info?.module ?? t("desconhecido"); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [dumps]);
  return (
    <section className="card pad col">
      <div className="card-title">
        <Icon name="bug_report" /><h3>{t("Travamentos")}</h3>
        {dumps.length > 0 && <button className="btn sm text" onClick={() => void clean(dumps.map((d) => d.name))}><Icon name="delete_sweep" size={16} /> {t("Limpar todos ({size})", { size: fmtSize(dumps.reduce((a, d) => a + d.size, 0)) })}</button>}
      </div>
      {dumps.length === 0 ? <p className="muted small">{t("Nenhum relatório de travamento na pasta do jogo. Quando o jogo fecha com erro, ele grava um arquivo .mdmp que o launcher lê e explica aqui.")}</p> : (
        <>
          {groups.length > 0 && <div className="chips">{groups.map(([m, n]) => <span key={m} className={`chip ${n > 1 ? "warn" : ""}`}>{m}: {n}×</span>)}</div>}
          <div className="perf-dumps">
            {dumps.slice(0, 30).map((d) => (
              <button key={d.name} className="perf-dump" onClick={() => setOpen(d)}>
                <Icon name="report" size={20} />
                <span className="grow">
                  <b>{fmtDate(d.modified)}</b>
                  <span className="small muted">{d.info ? t("{code} em {module}", { code: d.info.codeName, module: d.info.module ?? t("endereço desconhecido") }) : t("Não deu para ler ({error})", { error: tr(d.error ?? "") })}</span>
                </span>
                <span className="faint small">{fmtSize(d.size)}</span>
                <Icon name="chevron_right" size={18} />
              </button>
            ))}
          </div>
        </>
      )}
      {open && (
        <Modal title={t("Relatório de travamento")} icon="bug_report" onClose={() => setOpen(null)}>
          <div className="col" style={{ gap: 10 }}>
            {open.info ? <>
              <Notice kind="warn">{tr(open.info.hint)}</Notice>
              <div className="kv">
                <span>{t("Quando")}</span><b>{fmtDate(open.modified)}</b>
                <span>{t("Erro")}</span><b>{open.info.codeName} ({hex(open.info.code)})</b>
                <span>{t("Onde")}</span><b>{open.info.module ?? t("fora dos módulos carregados")}{open.info.moduleOffset !== null ? ` + ${hex(open.info.moduleOffset)}` : ""}</b>
                <span>{t("Módulos")}</span><b>{t("{n} carregados", { n: open.info.modules })}</b>
                <span>{t("Arquivo")}</span><b className="mono small">{open.name}</b>
              </div>
            </> : <Notice kind="err">{t("Não deu para ler este relatório: {error}", { error: tr(open.error ?? "") })}</Notice>}
            <footer>
              <button className="btn text" onClick={async () => { await clean([open.name]); setOpen(null); }}><Icon name="delete" size={16} /> {t("Apagar")}</button>
              <button className="btn primary" onClick={() => setOpen(null)}>{t("Fechar")}</button>
            </footer>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Conflicts({ conf, onGo }: { conf: ConflictReport | null; onGo: (p: "library") => void }) {
  if (!conf) return null;
  return (
    <section className="card pad col">
      <div className="card-title"><Icon name="call_split" /><h3>{t("Conflitos entre mods")}</h3><button className="btn sm text" onClick={() => onGo("library")}>{t("Abrir biblioteca")} <Icon name="chevron_right" size={16} /></button></div>
      {conf.betweenMods.length === 0 ? <p className="muted small">{t("Nenhum arquivo é fornecido por mais de um mod ligado.")}</p> : (
        <div className="col" style={{ gap: 6 }}>
          {conf.betweenMods.slice(0, 8).map((c, i) => (
            <div key={i} className="perf-conflict">
              <span className="chip err">{c.loserMod ?? c.loser}</span>
              <Icon name="arrow_forward" size={16} />
              <span className="chip ok">{c.winnerMod ?? c.winner}</span>
              <span className="faint small grow">{t("{n} arquivo(s) · ex.: {sample}", { n: c.count, sample: c.samples[0] })}</span>
            </div>
          ))}
          <p className="faint small">{t("O da direita vence (é montado por último). Mude a ordem na biblioteca se o vencedor estiver errado.")}</p>
        </div>
      )}
    </section>
  );
}
