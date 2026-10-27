// Recursos do launcher: tudo o que o CommandProject já traz (Partida grande, Climas, Remaster HD,
// Menu moderno, IA esperta…). Não aparecem na aba Mods e só entram no jogo quando você joga pelo
// launcher — abrindo pela Steam o jogo fica original.
import CpModsHub from "../components/CpModsHub";
import MenuThemeCard from "../components/MenuThemeCard";
import StartScreenCard from "../components/StartScreenCard";
import ShadersCard from "../components/ShadersCard";
import { Icon, Notice } from "../components/ui";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";

export default function Features() {
  const settings = useStore((s) => s.settings);
  const go = useStore((s) => s.go);
  return (
    <div className="scroll"><div className="page">
      <h1 className="page-title">{t("Recursos do launcher")}</h1>
      <p className="muted" style={{ marginTop: -6 }}>{t("Tudo isto já vem com o CommandProject: é só ligar. Seus mods e as Trapaças ficam na aba Mods.")}</p>
      {settings && !settings.modsOnlyLauncher && (
        <Notice kind="info">{t("Com \"Mods só pelo launcher\" desligado, os recursos ligados continuam no jogo mesmo abrindo pela Steam.")} <a href="#" onClick={(e) => { e.preventDefault(); useStore.getState().openSettings("jogo"); }}>{t("Abrir configurações")}</a></Notice>
      )}
      <CpModsHub />
      <div id="start-screen"><StartScreenCard /></div>
      <div id="menu-theme"><MenuThemeCard /></div>
      <ShadersCard />
      <p className="faint small"><Icon name="extension" size={15} /> {t("Procurando seus mods ou as Trapaças?")} <a href="#" onClick={(e) => { e.preventDefault(); go("library"); }}>{t("Abrir Mods")}</a></p>
    </div></div>
  );
}
