// Avisos do Lua 5.0 no editor da Forja (src/lib/forjaApi.ts): pegam as armadilhas e deixam em paz
// comentários, textos e o código certo.
import { apiAt, lintLua50, SNIPPETS, syntaxError } from "../src/lib/forjaApi.ts";

let fails = 0;
function check(cond: boolean, msg: string) {
  console.log((cond ? "ok   " : "FAIL ") + msg);
  if (!cond) fails++;
}

const bad = lintLua50("local n = #lista\nlocal r = a % 2\nfor w in string.gmatch(s, '%a+') do end\nif a != b then end\nlocal x = s:sub(1, 2)");
check(bad.some((i) => i.line === 1 && i.message.includes("#")), "# vira aviso");
check(bad.some((i) => i.line === 2 && i.message.includes("math.mod")), "% vira aviso");
check(bad.some((i) => i.line === 3 && i.message.includes("gfind")), "gmatch vira aviso");
check(bad.some((i) => i.line === 4 && i.message.includes("~=")), "!= vira aviso");
check(bad.some((i) => i.line === 5 && i.severity === "warning"), "s:sub vira alerta");
const ok = lintLua50("-- #comentário com % e gmatch\nlocal s = string.format('%d:%02d # x', a, b)\nlocal t = [[ # % ]]\nlocal n = table.getn(t)\nlocal r = math.mod(a, 2)\npanel:Button('x')");
check(ok.length === 0, `código certo, comentários e textos sem aviso (${JSON.stringify(ok)})`);
const miss = syntaxError("function a()\n  if x then\n    y()\n  end\n");
check(!!miss && miss.message.includes("end"), `falta de end vira erro de sintaxe (${miss?.message})`);
check(syntaxError("local x = (1 + 2\n") !== null, "parêntese sem fechar");
check(syntaxError("local s = 'oi\n") !== null, "texto sem fechar");
check(SNIPPETS.every((sn) => syntaxError(sn.code) === null && lintLua50(sn.code).filter((i) => i.severity === "error").length === 0), "trechos prontos sem erro");
check(apiAt("Forja.UI.Notify")?.sig.startsWith("Forja.UI.Notify(") === true, "ajuda da API");

console.log(fails ? `\n${fails} falha(s)` : "\ntudo certo");
process.exit(fails ? 1 : 0);
