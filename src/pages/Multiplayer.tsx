import { Check, ClipboardPaste, Copy, Fingerprint as FpIcon, Link2 } from "lucide-react";
import { useState } from "react";
import { Field, Notice } from "../components/ui";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { HubIndex, SyncItem, SyncPayload } from "../lib/types";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn sm" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    }}>{done ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}</button>
  );
}

export default function Multiplayer() {
  const profiles = useStore((s) => s.profiles);
  const d = useStore((s) => s.dashboard);
  const busy = useStore((s) => s.busy);
  const { run, refresh, refreshMods } = useStore.getState();
  const [fp, setFp] = useState<string | null>(null);
  const [profile, setProfile] = useState<string>(profiles?.active ?? "");
  const [code, setCode] = useState<string | null>(null);
  const [incoming, setIncoming] = useState("");
  const [inspect, setInspect] = useState<{ payload: SyncPayload; items: SyncItem[] } | null>(null);
  const [hubs, setHubs] = useState<HubIndex[] | null>(null);

  const check = async () => {
    const r = await run("inspect", () => api.inspectSyncCode(incoming));
    setInspect(r ?? null);
    if (r?.items.some((i) => i.state !== "ok" && i.hubId)) {
      const h = await run("hubs", () => api.hubFetch());
      setHubs(h?.indexes ?? []);
    }
  };

  const installFromHub = async (item: SyncItem) => {
    const idx = hubs?.find((h) => h.mods.some((m) => m.id === item.hubId && m.versions.some((v) => v.version === item.version)));
    if (!idx) {
      useStore.getState().toast("error", `${item.name} ${item.version} não está nos hubs configurados. Peça o arquivo ao seu amigo.`);
      return;
    }
    await run("hub:" + item.hubId, () => api.hubInstall(idx.sourceUrl, item.hubId!, item.version, false), `${item.name} ${item.version} instalado.`);
    await refreshMods();
    setInspect(await api.inspectSyncCode(incoming));
  };

  const allOk = inspect?.items.every((i) => i.state === "ok");

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <h1>Multiplayer</h1>
          <p>
            As partidas continuam pelos lobbies da Steam. O SC2 só deixa jogar junto quem tem os arquivos idênticos —
            aqui você confere isso antes e copia o perfil de um amigo em segundos.
          </p>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel pad col">
          <div className="section-title"><FpIcon size={18} color="var(--energy)" /><h2>Assinatura da sua pasta</h2></div>
          <p className="muted small">Mesma assinatura = mesmos arquivos = partida sem dessincronizar. Confira com todos antes de criar o lobby.</p>
          {fp ? (
            <div className="code-box"><span style={{ flex: 1 }}>{fp}</span><CopyButton text={fp} /></div>
          ) : (
            <button className="btn primary" style={{ alignSelf: "flex-start" }} disabled={busy.fp} onClick={async () => setFp((await run("fp", () => api.fingerprint()))?.code ?? null)}>
              {busy.fp ? "Calculando (a primeira vez demora)…" : "Calcular assinatura"}
            </button>
          )}
          {d && !d.inSync && <Notice kind="warn">Seu perfil ativo tem alterações não aplicadas — aplique antes de comparar.</Notice>}
        </section>

        <section className="panel pad col">
          <div className="section-title"><Link2 size={18} color="var(--energy)" /><h2>Compartilhar um perfil</h2></div>
          <Field label="Perfil">
            <select className="select" value={profile} onChange={(e) => { setProfile(e.target.value); setCode(null); }}>
              {profiles?.profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {code ? (
            <>
              <textarea className="textarea mono" readOnly rows={3} value={code} onFocus={(e) => e.target.select()} aria-label="Código do perfil" />
              <div className="row"><CopyButton text={code} /><span className="faint small">Mande no chat do lobby ou no Discord.</span></div>
            </>
          ) : (
            <button className="btn" style={{ alignSelf: "flex-start" }} disabled={busy.code} onClick={async () => setCode((await run("code", () => api.exportSyncCode(profile))) ?? null)}>Gerar código</button>
          )}
        </section>
      </div>

      <section className="panel pad col">
        <div className="section-title"><ClipboardPaste size={18} color="var(--energy)" /><h2>Usar o perfil de um amigo</h2></div>
        <div className="row" style={{ alignItems: "stretch" }}>
          <textarea className="textarea mono" style={{ flex: 1 }} rows={2} placeholder="Cole aqui o código CP1-…" value={incoming}
            onChange={(e) => { setIncoming(e.target.value); setInspect(null); }} aria-label="Código recebido" />
          <button className="btn" disabled={!incoming.trim().startsWith("CP1-") || busy.inspect} onClick={check}>Conferir</button>
        </div>
        {inspect && (
          <>
            <p><b>{inspect.payload.profile}</b> <span className="muted">— {inspect.items.length} mod(s)</span></p>
            <div className="list">
              {inspect.items.map((i) => (
                <div key={i.id} className="list-row" style={{ background: "var(--abyss-2)" }}>
                  <span className={`dot ${i.state === "ok" ? "ok" : i.state === "different" ? "warn" : "err"}`} />
                  <div className="grow">
                    <div className="title">{i.name} <span className="faint" style={{ fontWeight: 400 }}>{i.version}</span></div>
                    <div className="sub">
                      {i.state === "ok" ? "Você tem exatamente esta versão." : i.state === "different" ? `Você tem a ${i.installedVersion} com arquivos diferentes.` : "Você não tem este mod."}
                    </div>
                  </div>
                  {i.state !== "ok" && i.hubId && <button className="btn sm" disabled={busy["hub:" + i.hubId]} onClick={() => installFromHub(i)}>Baixar do hub</button>}
                  {i.state !== "ok" && !i.hubId && i.url && <a className="btn sm ghost" href={i.url} target="_blank" rel="noreferrer">Onde baixar</a>}
                </div>
              ))}
            </div>
            {!allOk && <Notice kind="warn">Instale os mods que faltam antes de jogar — sem eles a partida não vai abrir ou vai dessincronizar.</Notice>}
            <div className="row">
              <button className="btn primary" disabled={busy.applycode} onClick={async () => {
                const r = await run("applycode", () => api.applySyncCode(incoming), "Perfil criado e ativado. Aplique na tela Comando ou clique em Jogar.");
                if (r) await refresh();
              }}>Usar este perfil</button>
              {inspect.payload.fingerprint && <span className="faint small">Depois de aplicar, sua assinatura deve bater com a do seu amigo.</span>}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
