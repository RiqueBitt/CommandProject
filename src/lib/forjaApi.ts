// A API da Forja (carregador de mods) para o editor: autocompletar, ajuda ao passar o mouse e os
// avisos das armadilhas do Lua 5.0 do jogo. Os textos seguem a wiki da Forja.

export interface ApiEntry { label: string; sig: string; info: string; kind: "function" | "variable" | "namespace" }

const f = (label: string, sig: string, info: string): ApiEntry => ({ label, sig, info, kind: "function" });
const v = (label: string, sig: string, info: string): ApiEntry => ({ label, sig, info, kind: "variable" });

export const FORJA_API: ApiEntry[] = [
  // o próprio mod
  v("mod.Id", "mod.Id", "Id do mod (o nome da pasta forja/<id>/)."),
  v("mod.Name", "mod.Name", "Nome do mod (mod.json)."),
  v("mod.Version", "mod.Version", "Versão do mod (mod.json)."),
  f("mod.Option", "mod.Option(key, default)", "Valor da opção escolhida no launcher (Forja > mod), ou o padrão."),
  f("mod.Log", "mod.Log(text)", "Escreve no log do jogo com o nome do mod."),
  f("mod.Warn", "mod.Warn(text)", "Aviso no log do jogo com o nome do mod."),
  f("mod.Require", "mod.Require('lib/arquivo')", "Roda um arquivo .lua do mod uma vez e devolve o que ele retornar."),
  f("mod.Export", "mod.Export(api)", "Compartilha uma tabela com outros mods (eles pegam com Forja.Use)."),
  // eventos
  f("Forja.On", "Forja.On(evento, fn, prioridade?)", "Escuta um evento. Prioridade maior roda antes. Devolve um handle para Forja.Off.\nEventos: SessionStart, UnitCreated, UnitBuilt, UnitKilled, UnitDestroyed, UnitDamaged, UnitCaptured, UnitStartBuild, UIReady."),
  f("Forja.Once", "Forja.Once(evento, fn, prioridade?)", "Como Forja.On, mas roda só na primeira vez."),
  f("Forja.Off", "Forja.Off(handle)", "Para de escutar (handle de Forja.On)."),
  f("Forja.Emit", "Forja.Emit(evento, ...)", "Dispara um evento (os seus ou de outros mods). Devolve true se alguém devolveu Forja.Stop."),
  v("Forja.Stop", "return Forja.Stop", "Devolva num handler para os de prioridade menor não rodarem."),
  f("Forja.HasListeners", "Forja.HasListeners(evento)", "true se alguém escuta o evento."),
  // tempo
  f("Forja.After", "Forja.After(segundos, fn)", "Roda fn uma vez depois de um tempo. Devolve um handle para Forja.Cancel."),
  f("Forja.Every", "Forja.Every(segundos, fn)", "Roda fn de tempos em tempos até ela devolver false."),
  f("Forja.Cancel", "Forja.Cancel(handle)", "Cancela um Forja.After ou Forja.Every."),
  // mods
  f("Forja.Get", "Forja.Get(id)", "O mod com esse id (ou nil)."),
  f("Forja.IsLoaded", "Forja.IsLoaded(id)", "true se o mod carregou sem erro."),
  f("Forja.Mods", "Forja.Mods()", "Lista dos mods, na ordem de carga."),
  f("Forja.Use", "Forja.Use(id)", "A API que outro mod compartilhou com mod.Export (nil se ele não carregou)."),
  f("Forja.Errors", "Forja.Errors()", "Erros dos mods até agora (mod, lado, texto)."),
  f("Forja.Copy", "Forja.Copy(tabela)", "Cópia profunda de uma tabela."),
  f("Forja.Log", "Forja.Log(text)", "Escreve no log do jogo."),
  v("Forja.Side", "Forja.Side", "'sim', 'ui' ou 'blueprints': onde o código está rodando."),
  v("Forja.Version", "Forja.Version", "Versão da Forja."),
  // simulação
  f("Forja.Sim.OnCommand", "Forja.Sim.OnCommand(nome, fn(data, units))", "Recebe um comando mandado pela interface com Forja.UI.SendToSim."),
  f("Forja.Sim.SendToUI", "Forja.Sim.SendToUI(nome, data)", "Manda uma mensagem para a interface (Forja.UI.OnSim)."),
  f("Forja.Sim.CommandSource", "Forja.Sim.CommandSource()", "Exército de quem mandou o comando atual."),
  f("Forja.Sim.Brains", "Forja.Sim.Brains()", "Os cérebros (ArmyBrains) da partida."),
  f("Forja.Sim.HumanCount", "Forja.Sim.HumanCount()", "Quantos jogadores humanos há na partida."),
  f("Forja.Sim.IsSinglePlayer", "Forja.Sim.IsSinglePlayer()", "true numa partida com um só humano."),
  // interface
  f("Forja.UI.OnSim", "Forja.UI.OnSim(nome, fn(data))", "Recebe mensagens da simulação (Forja.Sim.SendToUI)."),
  f("Forja.UI.SendToSim", "Forja.UI.SendToSim(nome, data, comSeleção?)", "Manda um comando para a simulação (vale em todos os jogadores)."),
  f("Forja.UI.Notify", "Forja.UI.Notify(texto, segundos?, cor?)", "Mostra um aviso no meio da tela."),
  f("Forja.UI.AddKey", "Forja.UI.AddKey('F7', rótulo, fn)", "Tecla de atalho do mod."),
  f("Forja.UI.AddMenuItem", "Forja.UI.AddMenuItem(rótulo, fn, valorFn?)", "Item no painel da Forja (F8)."),
  f("Forja.UI.Panel", "Forja.UI.Panel({ title, subtitle })", "Painel do mod: panel:Button(rótulo, fn, valorFn), panel:Text(t), panel:Toggle(), panel:Refresh()."),
  f("Forja.UI.TogglePanel", "Forja.UI.TogglePanel()", "Abre ou fecha o painel da Forja."),
  v("Forja.UI.Colors", "Forja.UI.Colors.Ok | Warn | Err | Muted", "Cores do painel."),
  // blueprints
  f("Forja.BP.EachUnit", "Forja.BP.EachUnit(categoria|nil, fn(bp, id))", "Para cada unidade (de uma categoria, ou todas)."),
  f("Forja.BP.Unit", "Forja.BP.Unit(id)", "Blueprint de uma unidade."),
  f("Forja.BP.Weapon", "Forja.BP.Weapon(id)", "Blueprint de uma arma."),
  f("Forja.BP.Projectile", "Forja.BP.Projectile(id)", "Blueprint de um projétil."),
  f("Forja.BP.Units", "Forja.BP.Units()", "Tabela id → blueprint de todas as unidades."),
  f("Forja.BP.Get", "Forja.BP.Get(bp, 'Defense.MaxHealth')", "Valor por caminho (nil se não existir)."),
  f("Forja.BP.Set", "Forja.BP.Set(bp, 'Economy.BuildTime', valor)", "Muda um valor por caminho (cria o caminho)."),
  f("Forja.BP.Scale", "Forja.BP.Scale(bp, caminho, fator)", "Multiplica um número por caminho."),
  f("Forja.BP.Patch", "Forja.BP.Patch(id, { ... })", "Mistura uma tabela na blueprint da unidade."),
  f("Forja.BP.Merge", "Forja.BP.Merge(alvo, patch)", "Mistura uma tabela em outra (profundo)."),
  f("Forja.BP.Clone", "Forja.BP.Clone(id, novoId, patch?)", "Unidade nova copiando outra."),
  f("Forja.BP.HasCategory", "Forja.BP.HasCategory(bp, 'LAND')", "true se a unidade tem a categoria."),
  f("Forja.BP.AddCategory", "Forja.BP.AddCategory(bp, cat)", "Acrescenta uma categoria."),
  f("Forja.BP.RemoveCategory", "Forja.BP.RemoveCategory(bp, cat)", "Tira uma categoria."),
  f("Forja.BP.Modify", "Forja.BP.Modify(fn(BP))", "Roda fn quando os blueprints estão prontos."),
  // Lua do jogo
  f("table.getn", "table.getn(t)", "Tamanho de uma lista (o Lua 5.0 do jogo não tem #)."),
  f("math.mod", "math.mod(a, b)", "Resto da divisão (o Lua 5.0 do jogo não tem %)."),
  f("string.gfind", "string.gfind(s, padrão)", "Itera achados (no Lua 5.0 não existe gmatch)."),
  f("LOG", "LOG(texto)", "Escreve no log do jogo."),
  f("WARN", "WARN(texto)", "Aviso no log do jogo."),
  f("ForkThread", "ForkThread(fn, ...)", "Roda fn numa thread (pode usar WaitSeconds)."),
  f("WaitSeconds", "WaitSeconds(s)", "Espera (só dentro de uma thread)."),
  f("GetGameTimeSeconds", "GetGameTimeSeconds()", "Tempo de jogo em segundos."),
  f("GetFocusArmy", "GetFocusArmy()", "Exército do jogador (interface)."),
  f("EntityCategoryContains", "EntityCategoryContains(categorias.X, unidade)", "true se a unidade é da categoria."),
];

const byLabel = new Map(FORJA_API.map((e) => [e.label, e]));

/** A entrada da API para a palavra (com pontos) sob o cursor. */
export function apiAt(word: string): ApiEntry | undefined {
  return byLabel.get(word);
}

export interface LuaIssue { line: number; from: number; to: number; message: string; severity: "warning" | "error" }

/** Tira comentários e textos (mantendo as posições) para os avisos não pegarem nada dentro deles. */
function blank(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      const long = /^--\[(=*)\[/.exec(src.slice(i, i + 12));
      const end = long ? src.indexOf(`]${long[1]}]`, i) : src.indexOf("\n", i);
      const stop = end < 0 ? src.length : long ? end + long[1].length + 2 : end;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += c + " ".repeat(Math.max(0, Math.min(j, src.length) - i - 1)) + (j < src.length ? c : "");
      i = j + 1;
    } else if (c === "[" && /^\[(=*)\[/.test(src.slice(i, i + 10))) {
      const eq = /^\[(=*)\[/.exec(src.slice(i))![1];
      const end = src.indexOf(`]${eq}]`, i);
      const stop = end < 0 ? src.length : end + eq.length + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const RULES: { re: RegExp; message: string; severity?: "warning" | "error" }[] = [
  { re: /#\s*[\w({]/g, message: "O Lua 5.0 do jogo não tem o operador #: use table.getn(t) ou string.len(s).", severity: "error" },
  { re: /[\w)\]]\s*%\s*[\w(]/g, message: "O Lua 5.0 do jogo não tem o operador %: use math.mod(a, b).", severity: "error" },
  { re: /\bgmatch\b/g, message: "gmatch não existe no Lua 5.0: use string.gfind.", severity: "error" },
  { re: /\bgoto\b|::\w+::/g, message: "goto não existe no Lua 5.0.", severity: "error" },
  { re: /\/\//g, message: "// não existe no Lua 5.0: use math.floor(a / b).", severity: "error" },
  { re: /\bselect\s*\(/g, message: "select não existe no Lua 5.0: use arg / table.getn(arg) nas funções com ...", severity: "error" },
  { re: /\btable\.unpack\b/g, message: "table.unpack não existe no Lua 5.0: use unpack(t).", severity: "error" },
  { re: /\b(?:utf8|bit32)\./g, message: "Essa biblioteca não existe no Lua 5.0 do jogo.", severity: "error" },
  { re: /\w\s*:\s*(?:len|sub|upper|lower|find|gsub|rep|format|byte)\s*\(\s*\)?/g, message: "Se for um texto, o Lua 5.0 não tem métodos de string (s:sub): use string.sub(s, ...).", severity: "warning" },
  { re: /\bcontinue\b/g, message: "continue não existe no Lua: use um if em volta do resto do laço.", severity: "error" },
  { re: /!=/g, message: "Em Lua, diferente é ~=.", severity: "error" },
];

/** Avisos das armadilhas do Lua 5.0 do jogo (linha a linha, sem comentários e textos). */
export function lintLua50(src: string): LuaIssue[] {
  const clean = blank(src);
  const issues: LuaIssue[] = [];
  let offset = 0;
  clean.split("\n").forEach((line, n) => {
    for (const r of RULES) {
      r.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = r.re.exec(line))) {
        issues.push({ line: n + 1, from: offset + m.index, to: offset + m.index + Math.max(1, m[0].length), message: r.message, severity: r.severity ?? "warning" });
        if (!r.re.global) break;
      }
    }
    offset += line.length + 1;
  });
  return issues;
}
