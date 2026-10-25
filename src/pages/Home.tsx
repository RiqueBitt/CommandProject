import { useEffect, useRef, useState } from "react";
import { ConflictsModal, InstallLinkModal } from "../components/dialogs";
import { Empty, Field, Icon, Menu, MenuItem, Modal, ModThumb, Notice, Switch, TaskProgress } from "../components/ui";
import { api, confirmDialog, openUrl, pickFile } from "../lib/api";
import { fmtDate, plural, useStore } from "../lib/store";
import { CATEGORY_LABEL, type ConflictReport, type ModView, type ShaderStatus, type UpdateInfo } from "../lib/types";
import { EnhancementsCard, HomeShowcase } from "./HomeExtras";
import { CATEGORY_ICON } from "./Library";

export default function Home() {
  const d = useStore((s) => s.dashboard);
  const settings = useStore((s) => s.settings);
  const mods = useStore((s) => s.mods);
  const busy = useStore((s) => s.busy);
  const { run, refresh, go } = useStore.getState();
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [updates, setUpdates] = useState<UpdateInfo[]>([]);
  const [menu, setMenu] = useState(false);
  const [conflicts, setConflicts] = useState<ConflictReport | null>(null);
  const [link, setLink] = useState(false);
  const [rename, setRename] = useState(false);
  const [shaders, setShaders] = useState<ShaderStatus | null>(null);
  useEffect(() => { api.shadersStatus().then(setShaders).catch(() => setShaders(null)); }, []);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [homeTab, setHomeTab] = useState<"content" | "mods">(() => {
    try { return localStorage.getItem("cp.homeTab") === "mods" ? "mods" : "content"; } catch { return "content"; }
  });
  const chooseTab = (t: "content" | "mods") => {
    setHomeTab(t);
    try { localStorage.setItem("cp.homeTab", t); } catch { /* sem armazenamento: só não lembra a aba */ }
  };

  useEffect(() => {
    if (!settings?.checkModUpdates || settings.offline || (!settings.hubUrls.length && !settings.serverUrl)) return;
    (async () => {
      try {
        await api.hubFetch();
        setUpdates(await api.hubUpdates());
      } catch {
        /* hub fora do ar não atrapalha a tela inicial */
      }
    })();
  }, [settings?.checkModUpdates, settings?.hubUrls.length, settings?.serverUrl, settings?.offline]);

  if (!d) return <div className="page muted">Carregando…</div>;

  const pending = d.pending;
  const changes = pending.add.length + pending.replace.length + pending.remove.length + pending.restore.length;
  const working = busy.apply || busy.purge || busy.launch;
  const active = mods.filter((m) => m.enabled);
  const count = (cat: string) => active.filter((m) => m.manifest.category === cat).length;

  const chooseFolder = async () => {
    const dir = await pickFile([], true);
    if (!dir) return;
    await run("game", () => api.setGamePath(dir), (g) => (g ? "Jogo encontrado." : "Pasta salva."));
    await refresh();
  };
  const play = async () => {
    const r = await run("launch", () => api.launchGame());
    if (r) {
      useStore.getState().toast("ok", settings?.launchMode === "direct" || d.game?.store === "gog" ? "Abrindo o jogo…" : "Abrindo pela Steam…");
      setFingerprint(null);
      await refresh();
    }
  };
  const apply = async () => {
    await run("apply", () => api.applyActive(), (p) => (p.warnings.length ? `Perfil aplicado com ${plural(p.warnings.length, "aviso", "avisos")}.` : "Perfil aplicado na pasta do jogo."));
    setFingerprint(null);
    await refresh();
  };
  const purge = async () => {
    if (!(await confirmDialog("Remover da pasta do jogo todos os mods colocados pelo launcher e restaurar os arquivos originais?"))) return;
    await run("purge", () => api.purge(), "A pasta do jogo voltou ao original.");
    setFingerprint(null);
    await refresh();
  };
  const share = async () => {
    const code = await run("code", () => api.exportSyncCode());
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      useStore.getState().toast("ok", "Código do perfil copiado. Seu amigo cola em Multiplayer → Códigos.");
    } catch {
      useStore.getState().toast("error", "Não deu para copiar o código. Tente de novo com a janela em foco.");
    }
  };

  if (!d.game) {
    return (
      <div className="scroll">
        <div className="page">
          <h1>Supreme Commander 2</h1>
          <div className="card pad col" style={{ maxWidth: 720 }}>
            <Empty icon="travel_explore" title="Onde está o jogo?"
              action={<div className="row"><button className="btn primary" onClick={chooseFolder}><Icon name="folder_open" /> Escolher pasta</button><button className="btn text" disabled={busy.game} onClick={async () => {
                const g = await run("game", () => api.setGamePath(null), (x) => (x ? "Jogo encontrado." : "Ainda não achei o jogo nas pastas da Steam e da GOG. Use \"Escolher pasta\"."));
                if (g !== undefined) await refresh();
              }}><Icon name="refresh" /> {busy.game ? "Procurando…" : "Procurar de novo"}</button></div>}>
              Procuramos nas bibliotecas da Steam e na GOG. Se o jogo está em outra pasta, aponte para ela — pode ser a pasta do jogo, a gamedata ou a bin.
            </Empty>
          </div>
          <Notice kind="info">
            Ainda não tem o jogo? Ele está à venda na <a href="#" onClick={(e) => { e.preventDefault(); openUrl("https://store.steampowered.com/app/40100/Supreme_Commander_2/"); }}>Steam</a> e na GOG. O launcher não distribui arquivos do jogo.
          </Notice>
        </div>
      </div>
    );
  }

  const shaderName = shaders?.packInstalled && shaders.preset ? shaders.presets.find((p) => p.id === shaders.preset)?.name : null;
  const contentCard = (
    <div className={settings?.showcase ? "card content-inline" : "content-card"}>
      <div className="tablines" role="tablist" aria-label="Tela inicial">
        <button role="tab" className="tabline" aria-selected={homeTab === "content"} onClick={() => chooseTab("content")}>Conteúdo</button>
        <button role="tab" className="tabline" aria-selected={homeTab === "mods"} onClick={() => chooseTab("mods")}>Mods <span className="tab-count">{active.length + (shaderName ? 1 : 0)}</span></button>
      </div>
      {homeTab === "content" ? (
        <div role="tabpanel">
          <button className="content-line" onClick={() => chooseTab("mods")}><Icon name="extension" /> {plural(active.length, "mod ativo", "mods ativos")}<Icon name="chevron_right" className="go" /></button>
          <button className="content-line" onClick={() => go("library")}><Icon name="map" /> {plural(count("maps"), "mapa", "mapas")} e {plural(count("ui"), "mod de interface", "mods de interface")}<Icon name="chevron_right" className="go" /></button>
          <button className="content-line" onClick={() => go("library")}><Icon name="auto_awesome" /> {shaderName ? `Shaders: ${shaderName}` : "Shaders: deixar o jogo mais bonito"}<Icon name="chevron_right" className="go" /></button>
          <button className="content-line" onClick={() => go("hub")}><Icon name="download" /> Baixar mais mods<Icon name="chevron_right" className="go" /></button>
          <button className="content-line" onClick={() => setLink(true)}><Icon name="link" /> Instalar de um link<Icon name="chevron_right" className="go" /></button>
        </div>
      ) : (
        <ActiveMods mods={active} shaderName={shaderName ?? null} />
      )}
    </div>
  );

  return (
    <>
      <HomeShowcase />
      <div className={`scroll ${settings?.showcase ? "home-scroll" : ""}`}>
        <div className="page home-body">
          <div className="head">
            <div className="grow">
              <h1>{d.activeProfileName}</h1>
              <div className="meta-row">
                <div className="meta">
                  <Icon name="sports_esports" />
                  <div><div className="overline">{d.game.store === "steam" ? "Steam" : d.game.store === "gog" ? "GOG" : "Pasta escolhida"}</div><div className="v">{d.gameRunning ? "Jogo aberto" : "Supreme Commander 2"}</div></div>
                </div>
                <div className="meta">
                  <Icon name="extension" />
                  <div><div className="overline">Mods ativos</div><div className="v">{d.enabledMods} de {d.installedMods}</div></div>
                </div>
                <div className="meta">
                  <Icon name="history" />
                  <div><div className="overline">Última aplicação</div><div className="v">{fmtDate(d.deployedAt)}</div></div>
                </div>
                <div className="meta">
                  <Icon name="fingerprint" />
                  <div>
                    <div className="overline">Assinatura</div>
                    {fingerprint ? <div className="v selectable">{fingerprint}</div> : (
                      <button className="btn text sm" style={{ height: 22, padding: "0 6px", marginLeft: -6 }} disabled={busy.fp}
                        onClick={async () => setFingerprint((await run("fp", () => api.fingerprint()))?.code ?? null)}>{busy.fp ? "Calculando…" : "Calcular"}</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="icon-actions">
              <button className="btn icon-btn" title="Renomear perfil" aria-label="Renomear perfil" onClick={() => setRename(true)}><Icon name="edit" /></button>
              <button className="btn icon-btn" title="Conflitos" aria-label="Conflitos" disabled={busy.conflicts} onClick={async () => setConflicts((await run("conflicts", () => api.conflicts())) ?? null)}><Icon name={busy.conflicts ? "hourglass_top" : "compare_arrows"} /></button>
              <button className="btn icon-btn" title="Abrir a pasta do jogo" aria-label="Abrir a pasta do jogo" onClick={() => void run("open", () => api.openPath(d.game!.gamedata))}><Icon name="folder" /></button>
              <button className="btn icon-btn" title="Copiar código do perfil" aria-label="Copiar código do perfil" disabled={busy.code} onClick={share}><Icon name={busy.code ? "hourglass_top" : "share"} /></button>
            </div>
          </div>

          {working && <div className="card pad" style={{ maxWidth: 720 }}><TaskProgress task={busy.purge ? "purge" : "apply"} label="Preparando os arquivos do jogo…" /></div>}
          {d.gameRunning && <Notice kind="warn">Feche o jogo para aplicar mudanças: o SC2 só lê os arquivos .scd quando abre.</Notice>}
          <CrashNotice />

          <div className={settings?.showcase ? "home-col" : "grid"}>
            <EnhancementsCard />
            {settings?.showcase && contentCard}
            <section className="card pad">
              <div className="card-title"><Icon name="checklist" style={{ color: "var(--primary)" }} /><h3>Antes de jogar</h3></div>
              {changes === 0 && pending.warnings.length === 0 ? (
                <p className="muted">A pasta do jogo já está exatamente como o perfil pede.</p>
              ) : (
                <div className="col" style={{ gap: 6 }}>
                  {pending.add.map((f) => <div key={"a" + f} className="row small"><Icon name="add_circle" size={18} style={{ color: "var(--primary)" }} /> instalar <b>{f}</b></div>)}
                  {pending.replace.map((f) => <div key={"r" + f} className="row small"><Icon name="swap_horiz" size={18} style={{ color: "var(--warn)" }} /> substituir <b>{f}</b><span className="faint">(o original fica guardado)</span></div>)}
                  {pending.remove.map((f) => <div key={"d" + f} className="row small"><Icon name="remove_circle" size={18} style={{ color: "var(--danger)" }} /> remover <b>{f}</b></div>)}
                  {pending.restore.map((f) => <div key={"o" + f} className="row small"><Icon name="restore" size={18} style={{ color: "#7fb6f0" }} /> restaurar o original de <b>{f}</b></div>)}
                  {pending.warnings.map((w) => <Notice key={w} kind="warn">{w}</Notice>)}
                </div>
              )}
            </section>

            {updates.length > 0 && (
              <section className="card pad">
                <div className="card-title"><Icon name="system_update" style={{ color: "var(--primary)" }} /><h3>Atualizações de mods</h3><button className="btn sm text" onClick={() => go("hub")}>Abrir hub</button></div>
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
              <section className="card pad">
                <div className="card-title"><Icon name="inventory_2" style={{ color: "var(--warn)" }} /><h3>Mods instalados à mão</h3></div>
                <p className="muted small" style={{ marginBottom: 10 }}>Estes arquivos já estavam na pasta do jogo. Gerencie-os para ligar, desligar e sincronizar com amigos.</p>
                <div className="col">
                  {d.unmanagedFiles.map((f) => (
                    <div key={f} className="row">
                      <span className="mono" style={{ flex: 1 }}>{f}</span>
                      <button className="btn sm tonal" disabled={busy["adopt:" + f]} onClick={async () => {
                        await run("adopt:" + f, () => api.adoptUnmanaged(f), (m) => `"${m.name}" agora está na biblioteca.`);
                        await refresh();
                      }}>Gerenciar</button>
                      <button className="btn sm text" title="É um arquivo do jogo" onClick={async () => {
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
      </div>

      {!settings?.showcase && contentCard}

      <div className="launch-wrap">
        {!working && settings?.applyBeforeLaunch && changes > 0 && <span className="launch-note">aplica {plural(changes, "alteração", "alterações")} antes de abrir</span>}
        <div className={`launch-pill ${working ? "busy" : ""}`}>
          <button className="main-btn" onClick={play} disabled={working || d.gameRunning}>
            {busy.launch ? "Abrindo…" : busy.apply ? "Aplicando…" : busy.purge ? "Restaurando…" : d.gameRunning ? "Em jogo" : "Jogar"}
          </button>
          <span className="inset left"><Icon name={working ? "autorenew" : "play_arrow"} /></span>
          <button ref={menuBtn} className="inset right" aria-label="Mais opções" onClick={() => setMenu((m) => !m)}><Icon name="settings" /></button>
        </div>
      </div>
      {menu && (
        <Menu anchor={menuBtn.current} onClose={() => setMenu(false)}>
          <MenuItem icon="published_with_changes" onClick={apply} disabled={working || !changes || d.gameRunning}>Aplicar sem jogar</MenuItem>
          <MenuItem icon="restore" onClick={purge} disabled={working || d.gameRunning}>Voltar ao original</MenuItem>
          <hr />
          <MenuItem icon="groups" onClick={() => go("bigmatch")}>Partida grande (mais de 8 jogadores)</MenuItem>
          <MenuItem icon="extension" onClick={() => go("library")}>Mods do perfil</MenuItem>
          <MenuItem icon="share" onClick={share}>Copiar código do perfil</MenuItem>
          <MenuItem icon="tune" onClick={() => go("settings")}>Opções de jogo</MenuItem>
        </Menu>
      )}
      {conflicts && <ConflictsModal report={conflicts} onClose={() => setConflicts(null)} />}
      {link && <InstallLinkModal onClose={() => setLink(false)} />}
      {rename && <RenameProfile onClose={() => setRename(false)} />}
    </>
  );
}

/** O jogo travou ao abrir: mostra os mods ligados e deixa desligar com um clique. */
function CrashNotice() {
  const crash = useStore((s) => s.crash);
  const busy = useStore((s) => s.busy);
  const { run, refresh } = useStore.getState();
  if (!crash) return null;
  // mods gerados no launcher primeiro: são os que mexem em arquivos do motor (fontes, texturas)
  const order = (id: string) => (id === "menu-moderno" ? 0 : id === "texturas-hd" ? 1 : 2);
  const mods = [...crash.mods].sort((a, b) => order(a[0]) - order(b[0]));
  return (
    <Notice kind="err">
      <b>O jogo fechou com erro</b> (relatório {crash.dump}).
      {mods.length ? " Se começou depois de ligar um mod, desligue-o e tente de novo:" : " Nenhum mod estava ligado: tente verificar os arquivos do jogo na Steam."}
      {mods.length > 0 && (
        <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
          {mods.slice(0, 6).map(([id, name]) => (
            <button key={id} className="btn sm" disabled={busy["mod:" + id]} onClick={async () => {
              const ok = await run("mod:" + id, () => api.setModEnabled(id, false), `${name} desligado.`);
              if (ok !== undefined) {
                useStore.setState((s) => ({ crash: s.crash && { ...s.crash, mods: s.crash.mods.filter((m) => m[0] !== id) } }));
                await refresh();
              }
            }}><Icon name="toggle_off" /> Desligar {name}</button>
          ))}
          <button className="btn text sm" onClick={() => useStore.setState({ crash: null })}>Dispensar</button>
        </div>
      )}
    </Notice>
  );
}

/** Aba "Mods" da tela inicial: o que está ligado no perfil, com atalho para desligar. */
function ActiveMods({ mods, shaderName }: { mods: ModView[]; shaderName: string | null }) {
  const { run, refresh, go } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const sorted = [...mods].sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.manifest.name.localeCompare(b.manifest.name));
  if (!sorted.length && !shaderName) {
    return (
      <div role="tabpanel" className="mods-empty">
        <Icon name="extension_off" />
        <span>Nenhum mod ligado neste perfil.</span>
        <button className="btn sm tonal" onClick={() => go("hub")}><Icon name="download" /> Baixar mods</button>
      </div>
    );
  }
  return (
    <div role="tabpanel" className="mods-tab">
      <div className="mods-list">
        {shaderName && (
          <button className="mod-line" onClick={() => go("library")}>
            <span className="mod-ico builtin"><Icon name="auto_awesome" /></span>
            <span className="grow"><b>Shaders</b><span className="faint"> {shaderName}</span><span className="sub">ReShade · só visual</span></span>
            <Icon name="chevron_right" className="go" />
          </button>
        )}
        {sorted.map((m) => (
          <div key={m.manifest.id} className="mod-line">
            <button className="mod-open" onClick={() => go("library")} aria-label={`Abrir ${m.manifest.name} na biblioteca`}>
              <ModThumb name={m.manifest.name} icon={m.icon} size={30} />
              <span className="grow">
                <b>{m.manifest.name}</b><span className="faint"> {m.manifest.version}</span>
                <span className="sub"><Icon name={CATEGORY_ICON[m.manifest.category]} size={13} /> {CATEGORY_LABEL[m.manifest.category]}{m.manifest.multiplayer === "local" ? " · só visual" : ""}</span>
              </span>
            </button>
            <Switch checked label={`Desligar ${m.manifest.name}`} disabled={busy["mod:" + m.manifest.id]} onChange={async () => {
              await run("mod:" + m.manifest.id, () => api.setModEnabled(m.manifest.id, false), `${m.manifest.name} desligado. Vale na próxima vez que abrir o jogo.`);
              await refresh();
            }} />
          </div>
        ))}
      </div>
      <button className="content-line" onClick={() => go("library")}><Icon name="library_books" /> Ver todos na biblioteca<Icon name="chevron_right" className="go" /></button>
    </div>
  );
}

function RenameProfile({ onClose }: { onClose: () => void }) {
  const profiles = useStore((s) => s.profiles);
  const { run, refresh, go } = useStore.getState();
  const current = profiles?.profiles.find((p) => p.id === profiles.active);
  const [name, setName] = useState(current?.name ?? "");
  if (!current) return null;
  return (
    <Modal title="Perfil" icon="edit" onClose={onClose}>
      <form className="col" style={{ gap: 14 }} onSubmit={async (e) => {
        e.preventDefault();
        const r = await run("rename", () => api.renameProfile(current.id, name.trim()), "Perfil renomeado.");
        if (r) { await refresh(); onClose(); }
      }}>
        <Field label="Nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <footer>
          <button type="button" className="btn danger" disabled={(profiles?.profiles.length ?? 0) <= 1} onClick={async () => {
            if (!(await confirmDialog(`Apagar o perfil "${current.name}"? Os mods continuam na biblioteca.`))) return;
            const r = await run("del", () => api.deleteProfile(current.id), "Perfil apagado.");
            if (r) { await refresh(); go("me"); onClose(); }
          }}><Icon name="delete" /> Apagar perfil</button>
          <span className="spacer" />
          <button type="button" className="btn text" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!name.trim() || name === current.name}>Salvar</button>
        </footer>
      </form>
    </Modal>
  );
}
