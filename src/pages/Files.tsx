// Gerenciamento local de arquivos: onde o launcher guarda tudo, quanto espaço cada coisa usa,
// cópias de segurança (automáticas e manuais), restauração sem sobrescrever, lixeira de projetos
// e conferência dos arquivos dos projetos. Nada sai do computador.
import { useEffect, useState } from "react";
import { Empty, Icon, Modal, Notice } from "../components/ui";
import { api, confirmDialog, pickFile, pickSave } from "../lib/api";
import { locale, t, tr } from "../lib/i18n";
import { errorText, fmtBytes, load, useStore } from "../lib/store";
import { KIND_META, useTabs } from "../lib/tabs";
import type { BackupEntry, StorageReport, TrashItem } from "../lib/types";

const COLORS: Record<string, string> = { creations: "#7bd88f", "creations-trash": "#6f7682", "project-backups": "#5aa9e6", library: "#c78bff", "unit-packs": "#ffd166", projects: "#ff9f43", backups: "#f2555a", quarantine: "#e5534b", cache: "#9be7ff", other: "#a4abb6" };
const when = (iso: string) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" }) : "—");

export default function Files() {
  const settings = useStore((s) => s.settings);
  const busy = useStore((s) => s.busy);
  const { run, toast } = useStore.getState();
  const [rep, setRep] = useState<StorageReport | null>(null);
  const [backups, setBackups] = useState<BackupEntry[] | null>(null);
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [restore, setRestore] = useState<BackupEntry | null>(null);
  const [check, setCheck] = useState<{ ok: number; repaired: string[]; broken: string[] } | null>(null);

  const reload = async () => {
    setRep((await load(() => api.storageReport())) ?? null);
    setBackups((await load(() => api.backupsList())) ?? []);
    setTrash((await load(() => api.trashList())) ?? []);
  };
  useEffect(() => { void reload(); }, []);

  const backupNow = async () => {
    const b = await run("backup", () => api.backupCreate(null), (x) => t("Cópia feita: {n} projeto(s), {size}.", { n: x.projects, size: fmtBytes(x.size) }));
    if (b) void reload();
  };
  const backupTo = async () => {
    const dest = await pickSave(`CommandProject-projetos-${new Date().toISOString().slice(0, 10)}.zip`, [{ name: t("Cópia de segurança"), extensions: ["zip"] }]);
    if (!dest) return;
    await run("backup", async () => {
      try { return await api.backupCreate(dest); } catch (e) {
        if (!String(e).includes("EXISTE")) throw e;
        if (!(await confirmDialog(t("O arquivo já existe:\n{path}\n\nSubstituir?", { path: dest }), t("Substituir")))) throw new Error(t("Cópia cancelada: o arquivo existente foi mantido."));
        return api.backupCreate(dest, true);
      }
    }, (x) => t("Cópia salva em {path} ({n} projeto(s)).", { path: dest, n: x.projects }));
  };
  const restoreFromFile = async () => {
    const p = await pickFile([{ name: t("Cópia de segurança"), extensions: ["zip"] }]);
    if (!p) return;
    try { setRestore(await api.backupInspect(p)); } catch (e) { toast("error", errorText(e)); }
  };
  const doRestore = async (b: BackupEntry) => {
    const r = await run("restore", () => api.backupRestore(b.path), (x) => t("{n} projeto(s) restaurado(s) como cópias novas.", { n: x.restored.length }) + (x.skipped.length ? " " + t("{n} não deram.", { n: x.skipped.length }) : ""));
    setRestore(null);
    if (r?.skipped.length) toast("error", t("Não restaurados: {list}", { list: r.skipped.slice(0, 3).join("; ") }));
    void reload();
  };
  const setAuto = async (days: number) => {
    if (!settings) return;
    const s = await run("settings", () => api.saveSettings({ ...settings, autoBackupDays: days }), days ? t("Cópia automática a cada {n} dia(s).", { n: days }) : t("Cópia automática desligada."));
    if (s) useStore.setState({ settings: s });
  };
  const checkProjects = async () => {
    const list = (await load(() => api.creations())) ?? [];
    let ok = 0;
    const repaired: string[] = [], broken: string[] = [];
    for (const m of list) {
      try {
        const l = await api.creationLoad(m.id);
        if (l.repaired) repaired.push(t("{name} (recuperado do {from})", { name: m.name, from: tr(l.repaired) })); else ok++;
      } catch (e) { broken.push(`${m.name}: ${errorText(e)}`); }
    }
    setCheck({ ok, repaired, broken });
  };

  return (
    <div className="page files-page">
      <header className="page-head">
        <div>
          <span className="overline"><Icon name="folder_open" size={15} /> {t("Arquivos locais")}</span>
          <h1 className="page-title">{t("Gerenciamento local de arquivos")}</h1>
          <p className="muted">{t("Configurações, projetos, mapas, tropas, texturas e ícones ficam em arquivos no seu computador. Sem banco de dados e sem nuvem.")}</p>
        </div>
      </header>

      <section className="card pad">
        <div className="card-title"><Icon name="storage" /><h3>{t("Espaço usado")}</h3>
          {rep && <button className="btn sm" onClick={() => void api.openPath(rep.dataDir)}><Icon name="folder_open" size={16} /> {t("Abrir a pasta de dados")}</button>}</div>
        {!rep ? <div className="bar indeterminate"><i /></div> : <>
          <p className="faint small mono selectable" style={{ marginBottom: 10 }}>{rep.dataDir}</p>
          <div className="storage-bar">{rep.items.filter((i) => i.bytes > 0).map((i) => (
            <span key={i.key} title={`${tr(i.label)}: ${fmtBytes(i.bytes)}`} style={{ flexGrow: Math.max(1, i.bytes), background: COLORS[i.key] ?? "#888" }} />
          ))}</div>
          <div className="storage-legend">{rep.items.map((i) => (
            <button key={i.key} className="storage-row" onClick={() => i.key !== "other" && void api.openPath(i.path)} disabled={i.key === "other"} title={i.key !== "other" ? t("Abrir a pasta") : undefined}>
              <i style={{ background: COLORS[i.key] ?? "#888" }} /><span className="grow">{tr(i.label)}</span><b>{fmtBytes(i.bytes)}</b>
            </button>
          ))}<div className="storage-row total"><i /><span className="grow">{t("Total")}</span><b>{fmtBytes(rep.total)}</b></div></div>
        </>}
      </section>

      <section className="card pad">
        <div className="card-title"><Icon name="backup" /><h3>{t("Cópias de segurança dos projetos")}</h3></div>
        <p className="muted small" style={{ marginBottom: 12 }}>{t("Uma cópia guarda todos os projetos (mapas, tropas, modelos, texturas e ícones) e as configurações num .zip comum. Restaurar cria projetos novos: os atuais nunca são substituídos.")}</p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button className="btn primary" disabled={busy.backup} onClick={() => void backupNow()}><Icon name="backup" size={18} /> {busy.backup ? t("Copiando…") : t("Fazer cópia agora")}</button>
          <button className="btn" disabled={busy.backup} onClick={() => void backupTo()}><Icon name="save_alt" size={18} /> {t("Salvar cópia em…")}</button>
          <button className="btn" onClick={() => void restoreFromFile()}><Icon name="settings_backup_restore" size={18} /> {t("Restaurar de um arquivo…")}</button>
          <span className="grow" />
          <label className="row small" style={{ gap: 8 }}>{t("Cópia automática")}
            <select className="select dense" value={settings?.autoBackupDays ?? 7} onChange={(e) => void setAuto(Number(e.target.value))}>
              <option value={0}>{t("desligada")}</option><option value={1}>{t("todo dia")}</option><option value={3}>{t("a cada 3 dias")}</option><option value={7}>{t("toda semana")}</option><option value={14}>{t("a cada 2 semanas")}</option><option value={30}>{t("todo mês")}</option>
            </select>
          </label>
        </div>
        {backups === null ? <div className="bar indeterminate"><i /></div> : backups.length === 0 ? <p className="faint small">{t("Nenhuma cópia ainda.")}</p> : (
          <div className="file-list">{backups.map((b) => (
            <div key={b.path} className="file-row">
              <Icon name={b.auto ? "schedule" : "inventory_2"} size={20} />
              <span className="grow"><b>{when(b.createdAt)}</b> <small className="faint">{b.auto ? t("automática") : t("manual")} · {t("{n} projeto(s)", { n: b.projects })} · {fmtBytes(b.size)}</small></span>
              <button className="btn sm text" onClick={() => void api.openPath(b.path, true)} title={t("Mostrar na pasta")}><Icon name="folder_open" size={16} /></button>
              <button className="btn sm" onClick={() => setRestore(b)}><Icon name="settings_backup_restore" size={16} /> {t("Restaurar")}</button>
            </div>
          ))}</div>
        )}
        <p className="faint small" style={{ marginTop: 8 }}>{t("As 5 cópias automáticas mais recentes ficam guardadas; as que você faz pelo botão nunca são apagadas pelo launcher.")}</p>
      </section>

      <div className="files-grid">
        <section className="card pad">
          <div className="card-title"><Icon name="delete_outline" /><h3>{t("Lixeira de projetos")}</h3></div>
          {trash === null ? <div className="bar indeterminate"><i /></div> : trash.length === 0 ? <Empty icon="delete_outline" title={t("Lixeira vazia")}>{t("Projetos apagados vêm para cá e podem voltar.")}</Empty> : (
            <div className="file-list">{trash.map((it) => (
              <div key={it.entry} className="file-row">
                <Icon name={KIND_META[it.kind].icon} size={20} style={{ color: KIND_META[it.kind].color }} />
                <span className="grow"><b>{it.name}</b> <small className="faint">{t("apagado {when}", { when: when(it.deletedAt) })} · {fmtBytes(it.size)}</small></span>
                <button className="btn sm" onClick={async () => {
                  const m = await run("trash", () => api.trashRestore(it.entry), (x) => t('"{name}" voltou para os projetos.', { name: x.name }));
                  if (m) { void reload(); useTabs.getState().open(m); }
                }}><Icon name="restore_from_trash" size={16} /> {t("Restaurar")}</button>
              </div>
            ))}</div>
          )}
        </section>

        <section className="card pad">
          <div className="card-title"><Icon name="verified" /><h3>{t("Conferir os projetos")}</h3></div>
          <p className="muted small" style={{ marginBottom: 10 }}>{t("Abre cada projeto e confere se os arquivos estão inteiros. Um arquivo danificado é recuperado do salvamento automático ou da versão anterior (o danificado fica guardado).")}</p>
          <button className="btn" onClick={() => void checkProjects()}><Icon name="fact_check" size={18} /> {t("Conferir agora")}</button>
          {check && <div className="col" style={{ gap: 6, marginTop: 10 }}>
            <Notice kind={check.broken.length ? "err" : check.repaired.length ? "warn" : "ok"}>{t("{n} projeto(s) em ordem", { n: check.ok })}{check.repaired.length ? t(", {n} recuperado(s)", { n: check.repaired.length }) : ""}{check.broken.length ? t(", {n} com problema", { n: check.broken.length }) : ""}.</Notice>
            {[...check.repaired, ...check.broken].map((line, i) => <span key={i} className={`check-item ${i < check.repaired.length ? "warn" : "err"}`}>{line}</span>)}
          </div>}
          <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button className="btn sm" onClick={() => useStore.getState().goCreate("all")}><Icon name="draw" size={16} /> {t("Ver projetos")}</button>
            <button className="btn sm" onClick={() => useStore.getState().go("library")}><Icon name="extension" size={16} /> {t("Mods instalados")}</button>
          </div>
        </section>
      </div>

      {restore && (
        <Modal title={t("Restaurar cópia de segurança")} icon="settings_backup_restore" onClose={() => setRestore(null)}>
          <div className="col" style={{ gap: 12 }}>
            <p>{t("Cópia de {when} com {n} projeto(s) ({size}).", { when: when(restore.createdAt), n: restore.projects, size: fmtBytes(restore.size) })}</p>
            <Notice kind="info">{t("Os projetos voltam como")} <b>{t("cópias novas")}</b>. {t("Nenhum projeto atual é apagado ou substituído. As configurações atuais também ficam como estão.")}</Notice>
            <footer>
              <button className="btn text" onClick={() => setRestore(null)}>{t("Cancelar")}</button>
              <button className="btn primary" disabled={busy.restore} onClick={async () => { if (await confirmDialog(t("Restaurar {n} projeto(s) como cópias novas?", { n: restore.projects }), t("Restaurar"))) void doRestore(restore); }}>
                <Icon name="settings_backup_restore" size={18} /> {busy.restore ? t("Restaurando…") : t("Restaurar")}
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
