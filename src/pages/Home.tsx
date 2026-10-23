import { CircleSlash, FolderSearch, Minus, Plus, RefreshCw, Repeat, Rocket, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Notice, TaskProgress } from "../components/ui";
import { api, confirmDialog, pickFile } from "../lib/api";
import { fmtDate, plural, useStore } from "../lib/store";
import type { UpdateInfo } from "../lib/types";

export default function Home() {
  const d = useStore((s) => s.dashboard);
  const settings = useStore((s) => s.settings);
  const { run, refresh, go } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [updates, setUpdates] = useState<UpdateInfo[]>([]);

  useEffect(() => {
    if (!settings?.checkModUpdates || !settings.hubUrls.length) return;
    (async () => {
      try {
        await api.hubFetch();
        setUpdates(await api.hubUpdates());
      } catch {
        /* hub fora do ar não deve atrapalhar a tela inicial */
      }
    })();
  }, [settings?.checkModUpdates, settings?.hubUrls.length]);

  if (!d) return <div className="page muted">Carregando…</div>;

  const pending = d.pending;
  const changes = pending.add.length + pending.replace.length + pending.remove.length + pending.restore.length;
  const anyBusy = busy.apply || busy.purge || busy.launch;

  const chooseFolder = async () => {
    const dir = await pickFile([], true);
    if (!dir) return;
    await run("game", () => api.setGamePath(dir), (g) => (g ? "Jogo encontrado." : "Pasta salva."));
    await refresh();
  };

  const play = async () => {
    const r = await run("launch", () => api.launchGame());
    if (r) {
      useStore.getState().toast("ok", d.game?.store === "gog" || settings?.launchMode === "direct" ? "Abrindo o jogo…" : "Abrindo pela Steam…");
      setFingerprint(null);
      await refresh();
    }
  };

  const apply = async () => {
    await run("apply", () => api.applyActive(), (p) => (p.warnings.length ? `Perfil aplicado com ${p.warnings.length} aviso(s).` : "Perfil aplicado na pasta do jogo."));
    setFingerprint(null);
    await refresh();
  };

  const purge = async () => {
    if (!(await confirmDialog("Remover da pasta do jogo todos os mods colocados pelo launcher e restaurar os arquivos originais?"))) return;
    await run("purge", () => api.purge(), "A pasta do jogo voltou ao original.");
    setFingerprint(null);
    await refresh();
  };

  if (!d.game) {
    return (
      <div className="page">
        <section className="hero chamfer">
          <div>
            <div className="eyebrow"><span className="dot err" /> Instalação não encontrada</div>
            <h1>Onde está o Supreme Commander 2?</h1>
            <p className="muted" style={{ maxWidth: "60ch" }}>
              Procuramos nas bibliotecas da Steam e na GOG. Se o jogo está em outra pasta, aponte para ela — pode ser a pasta do jogo, a <b>gamedata</b> ou a <b>bin</b>.
            </p>
          </div>
          <div className="launch">
            <button className="btn primary" onClick={chooseFolder} disabled={busy.game}><FolderSearch size={17} /> Escolher pasta</button>
            <button className="btn ghost" onClick={() => run("game", () => api.setGamePath(null)).then(refresh)}><RefreshCw size={15} /> Procurar de novo</button>
          </div>
        </section>
        <Notice kind="info">
          Ainda não tem o jogo? Ele está à venda na <a href="https://store.steampowered.com/app/40100/Supreme_Commander_2/" target="_blank" rel="noreferrer">Steam</a> e na GOG. O launcher não distribui arquivos do jogo.
        </Notice>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="hero chamfer">
        <svg className="hero-mark" viewBox="0 0 100 100" aria-hidden>
          <polygon points="32,24 68,24 74,30 74,37 62,37 59,34 37,34 34,37 34,63 37,66 59,66 62,63 74,63 74,70 68,76 32,76 24,68 24,32" fill="#f2b33d" />
        </svg>
        <div>
          <div className="eyebrow">
            <span className={`dot ${d.gameRunning ? "warn" : changes ? "warn" : "ok"}`} />
            {d.gameRunning ? "O jogo está aberto" : changes ? "Perfil com alterações para aplicar" : "Pasta do jogo igual ao perfil"}
          </div>
          <h1>{d.activeProfileName}</h1>
          <p className="muted">
            {d.game.store === "steam" ? "Steam" : d.game.store === "gog" ? "GOG" : "Pasta escolhida"}: <span className="selectable">{d.game.root}</span>
          </p>
          <div className="readout">
            <div><b>{d.enabledMods}</b><span>mods ativos</span></div>
            <div><b>{d.installedMods}</b><span>na biblioteca</span></div>
            <div>
              {fingerprint ? <b className="selectable">{fingerprint}</b> : (
                <button className="btn sm" onClick={async () => setFingerprint((await run("fp", () => api.fingerprint()))?.code ?? null)} disabled={busy.fp}>
                  {busy.fp ? "Calculando…" : "Calcular"}
                </button>
              )}
              <span>assinatura da pasta</span>
            </div>
            <div><b style={{ fontSize: 17, paddingTop: 4 }}>{fmtDate(d.deployedAt)}</b><span>última aplicação</span></div>
          </div>
        </div>
        <div className="launch">
          <button className="play" onClick={play} disabled={anyBusy || d.gameRunning}>
            <Rocket size={26} />
            <span>Jogar<small>{settings?.applyBeforeLaunch && changes ? `aplica ${plural(changes, "alteração", "alterações")} antes` : settings?.launchMode === "direct" ? "abre o executável" : "abre pela Steam"}</small></span>
          </button>
          <div className="row">
            <button className="btn sm" onClick={apply} disabled={anyBusy || !changes || d.gameRunning}><Wand2 size={15} /> Aplicar sem jogar</button>
            <button className="btn sm ghost" onClick={purge} disabled={anyBusy || d.gameRunning}><CircleSlash size={15} /> Voltar ao original</button>
          </div>
        </div>
      </section>

      {(busy.apply || busy.purge || busy.launch) && (
        <div className="panel pad"><TaskProgress task={busy.purge ? "purge" : "apply"} label="Preparando os arquivos do jogo…" /></div>
      )}
      {d.gameRunning && <Notice kind="warn">Feche o jogo para aplicar mudanças: o SC2 só lê os arquivos .scd quando abre.</Notice>}

      <div className="grid-2">
        <section className="panel pad">
          <div className="section-title"><h2>Antes de jogar</h2></div>
          {changes === 0 && pending.warnings.length === 0 ? (
            <p className="muted">Os arquivos do jogo já estão exatamente como o perfil pede.</p>
          ) : (
            <div className="change-list">
              <ul>
                {pending.add.map((f) => <li key={"a" + f}><Plus size={15} color="var(--mass)" /> instalar <b>{f}</b></li>)}
                {pending.replace.map((f) => <li key={"r" + f}><Repeat size={15} color="var(--energy)" /> substituir <b>{f}</b> <span className="faint">(o original fica guardado)</span></li>)}
                {pending.remove.map((f) => <li key={"d" + f}><Minus size={15} color="var(--cybran)" /> remover <b>{f}</b></li>)}
                {pending.restore.map((f) => <li key={"o" + f}><Repeat size={15} color="var(--uef)" /> restaurar original de <b>{f}</b></li>)}
              </ul>
              {pending.warnings.map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
            </div>
          )}
        </section>

        {updates.length > 0 && (
          <section className="panel pad">
            <div className="section-title"><h2>Atualizações</h2><button className="btn sm" onClick={() => go("hub")}>Abrir hub</button></div>
            <div className="col">
              {updates.map((u) => (
                <div key={u.id} className="row">
                  <span style={{ flex: 1 }}><b>{u.name}</b> <span className="muted">{u.installed} → {u.latest}</span></span>
                  <button className="btn sm primary" disabled={busy["hub:" + u.id]} onClick={async () => {
                    await run("hub:" + u.id, () => api.hubInstall(u.indexUrl, u.id), `${u.name} atualizado para ${u.latest}.`);
                    setUpdates((x) => x.filter((y) => y.id !== u.id));
                    await refresh();
                  }}>Atualizar</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {d.unmanagedFiles.length > 0 && (
          <section className="panel pad">
            <div className="section-title"><h2>Mods instalados à mão</h2></div>
            <p className="muted small" style={{ marginBottom: 12 }}>
              Estes arquivos já estavam na pasta do jogo. Gerencie-os para poder ligar, desligar e sincronizar com amigos.
            </p>
            <div className="col">
              {d.unmanagedFiles.map((f) => (
                <div key={f} className="row">
                  <span className="mono" style={{ flex: 1 }}>{f}</span>
                  <button className="btn sm" disabled={busy["adopt:" + f]} onClick={async () => {
                    await run("adopt:" + f, () => api.adoptUnmanaged(f), (m) => `"${m.name}" agora está na biblioteca.`);
                    await refresh();
                  }}>Gerenciar</button>
                  <button className="btn sm ghost" title="É um arquivo do jogo" onClick={async () => {
                    await run("kind:" + f, () => api.setBaselineKind(f, "stock"), `${f} marcado como arquivo do jogo.`);
                    await refresh();
                  }}>É do jogo</button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
