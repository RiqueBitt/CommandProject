import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { linter, lintGutter } from "@codemirror/lint";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { apiAt, FORJA_API, lintLua50 } from "../lib/forjaApi";
import { SIM_FUNCTIONS, SIM_TABLES, simHelp } from "../lib/sc2Globals";

const theme = EditorView.theme(
  {
    "&": { backgroundColor: "#0a1620", color: "#dce6ee", fontSize: "13.5px", height: "100%" },
    ".cm-content": { fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace', caretColor: "#f2b33d" },
    ".cm-gutters": { backgroundColor: "#0a1620", color: "#4e6880", border: "none" },
    ".cm-activeLine": { backgroundColor: "#11243500" },
    ".cm-activeLineGutter": { backgroundColor: "#13283a", color: "#8aa2b6" },
    "&.cm-focused .cm-cursor": { borderLeftColor: "#f2b33d" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "#2a4a66 !important" },
    ".cm-matchingBracket": { backgroundColor: "#2a4a66", outline: "1px solid #5aa9e6" },
    ".cm-panels": { backgroundColor: "#13283a", color: "#e4ecf3" },
    ".cm-searchMatch": { backgroundColor: "#f2b33d33" },
    ".cm-tooltip": { backgroundColor: "#13283a", border: "1px solid #26425b" },
    ".cm-forja-tip": { padding: "8px 10px", maxWidth: "420px", fontSize: "12.5px" },
    ".cm-forja-tip code": { color: "#7cc4ff" },
    ".cm-forja-tip p": { margin: "4px 0 0", color: "#c6d4df", whiteSpace: "pre-line" },
    ".cm-diagnostic": { padding: "4px 8px" },
    ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy #e5534b" },
    ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy #f2b33d" },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "#f2b33d" },
  { tag: [t.string, t.special(t.string)], color: "#9fd88a" },
  { tag: t.comment, color: "#5f7a91", fontStyle: "italic" },
  { tag: t.number, color: "#ffb38a" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7cc4ff" },
  { tag: [t.bool, t.null, t.atom], color: "#e5534b" },
  { tag: t.variableName, color: "#dce6ee" },
  { tag: t.operator, color: "#8aa2b6" },
  { tag: t.bracket, color: "#8aa2b6" },
]);

/** Palavras do Lua do SC2 (Moho) para o autocompletar básico. */
const MOHO_WORDS = [
  "import", "LOG", "WARN", "SPEW", "ForkThread", "KillThread", "WaitSeconds", "WaitTicks", "Class", "table.getn", "table.insert",
  "GetFocusArmy", "GetArmyBrain", "GetUnitBlueprintByName", "LOC", "UIUtil", "LayoutHelpers", "Bitmap", "Group", "Text", "Button",
  "Prefs", "GameMain", "GetGameTimeSeconds", "IsDestroyed", "EntityCategoryContains", "categories",
];

/** Ajuda da API da Forja ao passar o mouse (palavra com pontos sob o cursor). */
const forjaHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let a = pos - line.from;
  let b = a;
  while (a > 0 && /[\w.]/.test(text[a - 1])) a--;
  while (b < text.length && /[\w.]/.test(text[b])) b++;
  // do começo até a palavra sob o cursor (Forja.UI.Notify com o mouse em "UI" mostra Forja.UI…)
  const word = text.slice(a, b);
  const parts = word.split(".");
  let entry;
  for (let n = parts.length; n > 0 && !entry; n--) entry = apiAt(parts.slice(0, n).join("."));
  if (!entry) {
    // funções e tabelas do próprio jogo (lista do supcom2reversal)
    const help = simHelp(parts[0]);
    if (help) entry = { label: parts[0], sig: SIM_TABLES.includes(parts[0]) ? parts[0] : `${parts[0]}(…)`, info: help, kind: "function" as const };
  }
  if (!entry) return null;
  const e = entry;
  return {
    pos: line.from + a,
    end: line.from + b,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-forja-tip";
      const sig = document.createElement("code");
      sig.textContent = e.sig;
      const info = document.createElement("p");
      info.textContent = e.info;
      dom.append(sig, info);
      return { dom };
    },
  };
});

const lua50 = linter((view) => lintLua50(view.state.doc.toString()).map((i) => ({ from: i.from, to: i.to, severity: i.severity, message: i.message })), { delay: 400 });

/** Comandos do editor para quem está em volta (inserir trecho, ir para uma linha). */
export interface EditorApi { insert: (text: string) => void; goto: (line: number) => void }

export default function LuaEditor({ value, onChange, onSave, readOnly = false, forja = false, apiRef, line }: {
  value: string; onChange?: (v: string) => void; onSave?: () => void; readOnly?: boolean;
  /** API da Forja no autocompletar, ajuda e avisos do Lua 5.0 */ forja?: boolean;
  apiRef?: React.MutableRefObject<EditorApi | null>;
  /** linha para abrir (ao vir de um erro ou da busca) */ line?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onSave });
  cb.current = { onChange, onSave };

  useEffect(() => {
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(),
        closeBrackets(), highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
        autocompletion({ override: [(ctx) => {
          const w = ctx.matchBefore(/[\w.]+/);
          if (!w || (w.from === w.to && !ctx.explicit)) return null;
          const api = forja ? FORJA_API.map((e) => ({ label: e.label, type: e.kind, detail: e.sig.startsWith(e.label) ? e.sig.slice(e.label.length) : e.sig, info: e.info, boost: 1 })) : [];
          const known = new Set(api.map((a) => a.label));
          const engine = [
            ...MOHO_WORDS.map((label) => ({ label, type: "function" })),
            ...SIM_FUNCTIONS.map((label) => ({ label, type: "function", detail: "SC2" })),
            ...SIM_TABLES.map((label) => ({ label, type: "namespace", detail: "SC2" })),
          ].filter((o) => !known.has(o.label) && (known.add(o.label), true));
          return { from: w.from, options: [...api, ...engine] };
        }] }),
        ...(forja ? [forjaHover, lua50, lintGutter()] : []),
        StreamLanguage.define(lua), syntaxHighlighting(highlight), theme,
        EditorState.readOnly.of(readOnly),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => { cb.current.onSave?.(); return true; } },
          indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap,
        ]),
        EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange?.(u.state.doc.toString())),
      ],
    });
    const v = new EditorView({ state, parent: host.current! });
    view.current = v;
    const goto = (n: number) => {
      const ln = v.state.doc.line(Math.max(1, Math.min(v.state.doc.lines, n)));
      v.dispatch({ selection: { anchor: ln.from }, effects: EditorView.scrollIntoView(ln.from, { y: "center" }) });
      v.focus();
    };
    if (apiRef) apiRef.current = {
      insert: (text) => {
        const at = v.state.selection.main;
        // no começo de uma linha nova, com a indentação da linha atual
        const cur = v.state.doc.lineAt(at.from);
        const indent = /^\s*/.exec(cur.text)?.[0] ?? "";
        const block = (cur.text.trim() ? "\n" : "") + text.split("\n").map((l, i) => (i === 0 || !l ? l : indent + l)).join("\n");
        const pos = cur.text.trim() ? cur.to : at.from;
        v.dispatch({ changes: { from: pos, insert: (cur.text.trim() ? "" : "") + block }, selection: { anchor: pos + block.length } });
        v.focus();
      },
      goto,
    };
    if (line) requestAnimationFrame(() => goto(line));
    return () => { v.destroy(); if (apiRef) apiRef.current = null; };
    // o editor é recriado quando o arquivo muda (key no componente pai)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, forja]);

  return <div className="cm-host" ref={host} />;
}
