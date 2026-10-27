// Novidades: aparece uma vez depois de atualizar o launcher (e pela busca, "Novidades").
import { useEffect, useState } from "react";
import { CHANGELOG, newer, releasesSince } from "../lib/changelog";
import { t } from "../lib/i18n";
import { useStore, type Page } from "../lib/store";
import { Icon, Modal } from "./ui";

const SEEN = "cp-news-seen";

export default function NewsModal() {
  const version = useStore((s) => s.info?.version);
  const open = useStore((s) => s.showNews);
  const go = useStore((s) => s.go);
  const [since, setSince] = useState<string | null>(null);

  // depois de atualizar: mostra o que mudou desde a última versão vista (na primeira instalação, não)
  useEffect(() => {
    if (!version) return;
    let seen: string | null = null;
    try { seen = localStorage.getItem(SEEN); } catch { /* ok */ }
    if (seen && newer(version, seen) && releasesSince(seen, version).length) {
      setSince(seen);
      useStore.setState({ showNews: true });
    }
    try { localStorage.setItem(SEEN, version); } catch { /* ok */ }
  }, [version]);

  if (!open || !version) return null;
  const list = since ? releasesSince(since, version) : CHANGELOG.filter((r) => !newer(r.version, version)).slice(0, 1);
  const close = () => { setSince(null); useStore.setState({ showNews: false }); };
  return (
    <Modal title={t("Novidades")} icon="new_releases" onClose={close} wide>
      <div className="news">
        <div className="news-banner">
          <i className="news-logo" aria-hidden />
          <div>
            <span className="overline">CommandProject {version}</span>
            <h3>{list[0] ? t(list[0].title) : t("Novidades")}</h3>
          </div>
        </div>
        {list.map((r, ri) => (
          <section key={r.version} className="col" style={{ gap: 8 }}>
            {ri > 0 && <h4 className="overline">{r.version} · {t(r.title)}</h4>}
            <div className="news-grid">
              {r.items.map((it) => (
                <button key={it.title} type="button" className="news-item" disabled={!it.page} onClick={() => { if (it.page) { close(); go(it.page as Page); } }}>
                  <Icon name={it.icon} size={22} />
                  <span><b>{t(it.title)}</b><span className="small muted">{t(it.text)}</span></span>
                  {it.page && <Icon name="chevron_right" size={18} className="go" />}
                </button>
              ))}
            </div>
          </section>
        ))}
        <footer><button className="btn primary" onClick={close}>{t("Vamos lá")}</button></footer>
      </div>
    </Modal>
  );
}
