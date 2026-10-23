import { useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { ConflictReport } from "../lib/types";
import { Field, Modal, Notice, TaskProgress } from "./ui";

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
