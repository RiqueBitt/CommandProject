// Idiomas do launcher. O texto no código fica em português (Brasil) e serve de chave; os outros
// idiomas são dicionários "texto em português → tradução" em src/i18n/<idioma>/*.json.
//
//   t("Jogar")                         → "Play" em inglês
//   t("{n} mods ativos", { n: 3 })     → "3 active mods"
//   tr(mensagemDoBackend)              → traduz mensagens do launcher (Rust), também com valores no meio
//
// Inglês é o idioma padrão. Trocar o idioma remonta a interface (App usa a chave do idioma), então
// tudo que chama t() na renderização muda na hora.
import { create } from "zustand";

export type Lang = "en" | "pt-BR";
export const LANGS: { id: Lang; label: string; flag: string }[] = [
  { id: "en", label: "English", flag: "EN" },
  { id: "pt-BR", label: "Português (Brasil)", flag: "BR" },
];
export const DEFAULT_LANG: Lang = "en";
const STORAGE_KEY = "cp-lang";

const isLang = (v: unknown): v is Lang => v === "en" || v === "pt-BR";

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isLang(v)) return v;
  } catch {
    /* sem armazenamento: fica o padrão */
  }
  return DEFAULT_LANG;
}

let current: Lang = initialLang();

// dicionário inglês: todas as partes (uma por área do app) juntas
const enParts = import.meta.glob("../i18n/en/*.json", { eager: true, import: "default" }) as Record<string, Record<string, string>>;
const EN: Record<string, string> = Object.assign({}, ...Object.values(enParts));

// mensagens do backend: "texto com {0} e {1}" → "text with {0} and {1}"
const serverParts = import.meta.glob("../i18n/server/*.json", { eager: true, import: "default" }) as Record<string, Record<string, string>>;
const SERVER: Record<string, string> = Object.assign({}, ...Object.values(serverParts));
interface Pattern { re: RegExp; to: string; slots: string[] }
let patterns: Pattern[] | null = null;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function compiled(): Pattern[] {
  if (patterns) return patterns;
  patterns = [];
  for (const [from, to] of Object.entries(SERVER)) {
    const slots: string[] = [];
    const parts = from.split(/(\{\w*\})/);
    if (parts.length === 1) continue; // sem valores: vai pelo dicionário exato
    const body = parts.map((p) => {
      const m = /^\{(\w*)\}$/.exec(p);
      if (!m) return escapeRe(p);
      slots.push(m[1] || String(slots.length));
      return "([\\s\\S]+?)";
    }).join("");
    patterns.push({ re: new RegExp(`^${body}$`), to, slots });
  }
  // os mais específicos (mais texto fixo) primeiro
  patterns.sort((a, b) => b.re.source.length - a.re.source.length);
  return patterns;
}

const fill = (s: string, vars?: Record<string, string | number | undefined | null>) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars && vars[k] != null ? String(vars[k]) : m)) : s;

/** Texto da interface no idioma atual. `src` é o texto em português (a chave). */
export function t(src: string, vars?: Record<string, string | number | undefined | null>): string {
  if (current === "pt-BR") return fill(src, vars);
  return fill(EN[src] ?? src, vars);
}

/** Traduz uma mensagem que veio pronta (do backend ou de um erro), com valores no meio. */
export function tr(msg: string): string {
  if (current === "pt-BR" || !msg) return msg;
  const exact = EN[msg] ?? SERVER[msg];
  if (exact) return exact;
  for (const p of compiled()) {
    const m = p.re.exec(msg);
    if (!m) continue;
    let out = p.to;
    p.slots.forEach((slot, i) => {
      // os valores também podem ser mensagens (erro dentro de erro)
      out = out.replace(`{${slot}}`, tr(m[i + 1]));
    });
    return out;
  }
  // "contexto: detalhe" — traduz cada parte
  const i = msg.indexOf(": ");
  if (i > 0) {
    const head = msg.slice(0, i);
    const tail = msg.slice(i + 2);
    const th = EN[head] ?? SERVER[head];
    if (th) return `${th}: ${tr(tail)}`;
  }
  return msg;
}

/** Locale para números e datas (toLocaleString etc.). */
export const locale = () => (current === "pt-BR" ? "pt-BR" : "en-US");
export const getLang = () => current;

interface LangState { lang: Lang }
export const useLang = create<LangState>(() => ({ lang: current }));

export function setLang(lang: Lang) {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* ok */
  }
  document.documentElement.lang = lang === "en" ? "en" : "pt-BR";
  useLang.setState({ lang });
}

document.documentElement.lang = current === "en" ? "en" : "pt-BR";
