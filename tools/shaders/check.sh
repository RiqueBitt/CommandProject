#!/usr/bin/env bash
# Valida os shaders com o compilador do próprio ReShade (versão fixa) e gera o HLSL de cada
# passe para Shader Model 3 (DirectX 9), em várias resoluções. O CI compila esses arquivos
# depois com o fxc.exe da Microsoft no Windows (tools/shaders/check_dx9.ps1).
#
# Uso: tools/shaders/check.sh [PASTA_DE_SAIDA]   (padrão: target/shaders)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/target/shaders}"
FX="$ROOT/resources/shaders/CommandProject.fx"
RESHADE_COMMIT="7bf9de8b33bcc76c3177007e65d73c72dd0f34c0"   # crosire/reshade (BSD-3-Clause)
WORK="$ROOT/target/reshade-fxc"
FXC="$WORK/fxc"

if [[ ! -x "$FXC" ]]; then
  echo "== compilando o fxc do ReShade ($RESHADE_COMMIT)"
  rm -rf "$WORK" && mkdir -p "$WORK/src"
  git -C "$WORK/src" init -q
  git -C "$WORK/src" fetch -q --depth 1 https://github.com/crosire/reshade "$RESHADE_COMMIT"
  git -C "$WORK/src" checkout -q FETCH_HEAD
  cat > "$WORK/version.h" <<'EOF'
#pragma once
#define VERSION_MAJOR 6
#define VERSION_MINOR 5
#define VERSION_REVISION 1
#define VERSION_BUILD 0
#define VERSION_STRING_PRODUCT "6.5.1 (fxc)"
#define VERSION_STRING_FILE "6.5.1"
EOF
  # só os geradores HLSL e GLSL; DXBC/DXIL/SPIR-V exigem bibliotecas do Windows ou submódulos
  cat > "$WORK/stubs.cpp" <<'EOF'
#include "effect_codegen.hpp"
namespace reshadefx {
codegen *create_codegen_dxbc(unsigned int, bool, bool, int) { return nullptr; }
codegen *create_codegen_dxil(unsigned int, bool, bool, int) { return nullptr; }
codegen *create_codegen_spirv(bool, bool, bool, bool, bool) { return nullptr; }
}
EOF
  S="$WORK/src/source"
  g++ -std=c++20 -O1 -w -I "$S" -I "$WORK" -o "$FXC" "$WORK/src/tools/fxc.cpp" \
    "$S/effect_lexer.cpp" "$S/effect_preprocessor.cpp" "$S/effect_parser_exp.cpp" "$S/effect_parser_stmt.cpp" \
    "$S/effect_expression.cpp" "$S/effect_symbol_table.cpp" "$S/effect_codegen_hlsl.cpp" "$S/effect_codegen_glsl.cpp" \
    "$WORK/stubs.cpp"
fi

rm -rf "$OUT" && mkdir -p "$OUT"
mapfile -t ENTRIES < <(grep -oE '(VertexShader|PixelShader)\s*=\s*\w+' "$FX" | sed -E 's/.*=\s*//' | sort -u)
echo "== ${#ENTRIES[@]} pontos de entrada: ${ENTRIES[*]}"

for res in 1920x1080 2560x1440 1366x768 3840x2160; do
  w="${res%x*}"; h="${res#*x}"
  defs=(-D "BUFFER_WIDTH=$w" -D "BUFFER_HEIGHT=$h" -D "BUFFER_RCP_WIDTH=$(awk "BEGIN{printf \"%.10f\", 1/$w}")" -D "BUFFER_RCP_HEIGHT=$(awk "BEGIN{printf \"%.10f\", 1/$h}")")
  "$FXC" --glsl "${defs[@]}" -Fo "$OUT/$res.glsl" "$FX"
  for e in "${ENTRIES[@]}"; do
    "$FXC" --hlsl --shader-model 30 "${defs[@]}" -E "E__$e" -Fo "$OUT/${res}__$e.hlsl" "$FX"
  done
done
echo "== ok: $(ls "$OUT"/*.hlsl | wc -l) arquivos HLSL (SM3) e $(ls "$OUT"/*.glsl | wc -l) GLSL em $OUT"
