// O jogo fechou com erro: o relatório do Windows (.mdmp), os mods ligados (com um clique para
// desligar) e, na partida grande, o que o log do jogo diz (onde parou e o que tentar).
import { api } from "../lib/api";
import { t, tr } from "../lib/i18n";
import { useStore } from "../lib/store";
import { Icon, Notice } from "./ui";

export default function CrashNotice() {
  const crash = useStore((s) => s.crash);
  const busy = useStore((s) => s.busy);
  const { run, refresh } = useStore.getState();
  if (!crash) return null;
  // mods gerados no launcher primeiro: são os que mexem em arquivos do motor (fontes, texturas)
  const order = (id: string) => (id === "menu-moderno" ? 0 : id === "texturas-hd" ? 1 : 2);
  // na partida grande o mod dela é obrigatório: desligar não ajuda
  const mods = [...crash.mods].filter(([id]) => !(crash.log && id === "cp-partida-grande")).sort((a, b) => order(a[0]) - order(b[0]));
  const log = crash.log;
  const lines = log ? [...log.problems, ...log.tail.filter((l) => !log.problems.includes(l))] : [];
  const dismiss = () => useStore.setState({ crash: null });
  return (
    <Notice kind="err">
      <b>{log && !crash.dump ? t("O jogo fechou no meio da partida grande") : t("O jogo fechou com erro")}</b>
      {crash.dump ? " " + t("(relatório {name}).", { name: crash.dump }) : "."}
      {log && (
        <>
          {log.started && log.players != null && (
            <span className="muted"> {log.size ? t("{n} jogadores num mapa de {size}.", { n: log.players, size: log.size }) : t("{n} jogadores.", { n: log.players })}</span>
          )}
          {log.hints.length > 0 && (
            <ul className="crash-hints">
              {log.hints.map((h) => <li key={h}>{tr(h)}</li>)}
            </ul>
          )}
          {lines.length > 0 && (
            <details className="crash-log">
              <summary>{t("O que o jogo escreveu antes de fechar")}</summary>
              <pre>{lines.join("\n")}</pre>
            </details>
          )}
        </>
      )}
      {!log && (mods.length ? " " + t("Se começou depois de ligar um mod, desligue-o e tente de novo:") : " " + t("Nenhum mod estava ligado: tente verificar os arquivos do jogo na Steam."))}
      <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
        {!log && mods.slice(0, 6).map(([id, name]) => (
          <button key={id} className="btn sm" disabled={busy["mod:" + id]} onClick={async () => {
            const ok = await run("mod:" + id, () => api.setModEnabled(id, false), t("{name} desligado.", { name }));
            if (ok !== undefined) {
              useStore.setState((s) => ({ crash: s.crash && { ...s.crash, mods: s.crash.mods.filter((m) => m[0] !== id) } }));
              await refresh();
            }
          }}><Icon name="toggle_off" /> {t("Desligar {name}", { name })}</button>
        ))}
        {crash.logPath && (
          <button className="btn sm" onClick={() => void api.openPath(crash.logPath!, true)}><Icon name="description" /> {t("Mostrar o log")}</button>
        )}
        <button className="btn text sm" onClick={dismiss}>{t("Dispensar")}</button>
      </div>
    </Notice>
  );
}
