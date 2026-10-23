import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { useEffect, useRef } from "react";

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

export default function LuaEditor({ value, onChange, onSave, readOnly = false }: { value: string; onChange?: (v: string) => void; onSave?: () => void; readOnly?: boolean }) {
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
          return { from: w.from, options: MOHO_WORDS.map((label) => ({ label, type: "function" })) };
        }] }),
        StreamLanguage.define(lua), syntaxHighlighting(highlight), theme,
        EditorState.readOnly.of(readOnly),
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => { cb.current.onSave?.(); return true; } },
          indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap,
        ]),
        EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange?.(u.state.doc.toString())),
      ],
    });
    view.current = new EditorView({ state, parent: host.current! });
    return () => view.current?.destroy();
    // o editor é recriado quando o arquivo muda (key no componente pai)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  return <div className="cm-host" ref={host} />;
}
