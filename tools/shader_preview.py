#!/usr/bin/env python3
"""Executa os shaders do CommandProject fora do jogo, para testes e prévias.

Compila o .fx com o compilador do próprio ReShade (fxc, gerando GLSL) e roda as técnicas
num contexto OpenGL 4.5 sem janela (EGL), imitando o runtime do ReShade: texturas
declaradas no .fx, passes com RenderTarget e cópia do back buffer para a textura COLOR
depois de cada passe que desenha nele.

Uso:
  python tools/shader_preview.py ENTRADA.png SAIDA.png [--preset presets/Vivido.ini] [--fxc caminho/fxc]

Requer: pip install moderngl numpy pillow, e o fxc do ReShade (tools/fxc.cpp do repositório
crosire/reshade, compilado com os arquivos source/effect_*.cpp).
"""
from __future__ import annotations

import argparse
import configparser
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

import moderngl
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
FX = HERE.parent / "resources" / "shaders" / "CommandProject.fx"


def parse_fx(src: str):
    """Extrai uniforms (com padrões), texturas, samplers e técnicas/passes do .fx."""
    uniforms = {}
    for m in re.finditer(r"uniform\s+(float3|float)\s+(\w+)\s*<.*?>\s*=\s*([^;]+);", src, re.S):
        kind, name, val = m.groups()
        nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", val.replace("float3", ""))]
        uniforms[name] = (kind, nums)
    textures = {}
    for m in re.finditer(r"texture\s+(\w+)\s*(?::\s*COLOR\s*;|\{([^}]*)\})", src):
        name, body = m.group(1), m.group(2)
        if body is None:
            textures[name] = {"backbuffer": True}
            continue
        w = re.search(r"Width\s*=\s*BUFFER_WIDTH\s*/\s*(\d+)", body)
        fmt = re.search(r"Format\s*=\s*(\w+)", body).group(1)
        textures[name] = {"div": int(w.group(1)) if w else 1, "format": fmt}
    samplers = {m.group(1): m.group(2) for m in re.finditer(r"sampler\s+(\w+)\s*\{\s*Texture\s*=\s*(\w+);", src)}
    techniques = {}
    for m in re.finditer(r"technique\s+(\w+)\s*<.*?>\s*\{(.*?)\n\}", src, re.S):
        passes = []
        for p in re.finditer(r"pass\s*\w*\s*\{([^}]*)\}", m.group(2)):
            body = p.group(1)
            ps = re.search(r"PixelShader\s*=\s*(\w+)", body).group(1)
            rt = re.search(r"RenderTarget\s*=\s*(\w+)", body)
            passes.append((ps, rt.group(1) if rt else None))
        techniques[m.group(1)] = passes
    return uniforms, textures, samplers, techniques


def read_preset(path: Path | None, uniforms):
    """Lê um preset do ReShade: lista de técnicas + valores dos uniforms."""
    values = {k: v[1] for k, v in uniforms.items()}
    order = ["CP_Suavizar", "CP_Detalhe", "CP_Brilho", "CP_Cor"]
    if path is None:
        return order, values
    cp = configparser.ConfigParser(strict=False)
    cp.optionxform = str
    text = path.read_text(encoding="utf-8")
    cp.read_string("[__top__]\n" + text)
    techs = cp["__top__"].get("Techniques", "")
    order = [t.split("@")[0] for t in techs.split(",") if t.strip()]
    if cp.has_section("CommandProject.fx"):
        for k, v in cp["CommandProject.fx"].items():
            if k in values:
                values[k] = [float(x) for x in v.split(",")]
    return order, values


def std140(uniform_order, uniforms, values):
    buf = bytearray()
    for name in uniform_order:
        kind, _ = uniforms[name]
        vals = values[name]
        if kind == "float3":
            while len(buf) % 16:
                buf += b"\0"
            buf += struct.pack("3f", *vals)
        else:
            buf += struct.pack("f", vals[0])
    while len(buf) % 16:
        buf += b"\0"
    return bytes(buf)


def run(inp: Path, out: Path, preset: Path | None, fxc: str):
    img = np.asarray(Image.open(inp).convert("RGBA"))
    h, w = img.shape[:2]
    src = FX.read_text(encoding="utf-8")
    uniforms, textures, samplers, techniques = parse_fx(src)
    order, values = read_preset(preset, uniforms)

    defs = ["-D", f"BUFFER_WIDTH={w}", "-D", f"BUFFER_HEIGHT={h}",
            "-D", f"BUFFER_RCP_WIDTH={1.0 / w:.10f}", "-D", f"BUFFER_RCP_HEIGHT={1.0 / h:.10f}"]
    with tempfile.TemporaryDirectory() as tmp:
        glsl_path = Path(tmp) / "fx.glsl"
        r = subprocess.run([fxc, "--glsl", *defs, "-Fo", str(glsl_path), str(FX)], capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit("fxc falhou:\n" + r.stdout + r.stderr)
        glsl = glsl_path.read_text()

    uniform_order = re.findall(r"^\s*(?:float|vec3)\s+V_x(\w+);", glsl.split("uniform _Globals {")[1].split("};")[0], re.M)
    bindings = {m.group(2): int(m.group(1)) for m in re.finditer(r"layout\(binding = (\d+)\) uniform sampler2D V_x(\w+);", glsl)}

    # D3D tem v=0 no topo; no OpenGL a linha 0 da textura fica embaixo. Invertendo o Y do
    # vértice, uv=0 cai na linha 0 da memória em todas as texturas e nada sai espelhado.
    glsl = glsl.replace("gl_Position = position;", "gl_Position = position * vec4(1.0, -1.0, 1.0, 1.0);")
    header, body = glsl.split("\n", 1)

    def stage(define):
        return f"{header}\n#define {define}\n{body}"

    ctx = moderngl.create_standalone_context(backend="egl", require=430)
    ubo = ctx.buffer(std140(uniform_order, uniforms, values))

    gl_tex = {}
    for name, t in textures.items():
        if t.get("backbuffer"):
            tex = ctx.texture((w, h), 4, img.tobytes())
        else:
            tw, th = max(1, w // t["div"]), max(1, h // t["div"])
            comps = 1 if t["format"].startswith("R16") else 4
            tex = ctx.texture((tw, th), comps, dtype="f2")
        tex.filter = (moderngl.LINEAR, moderngl.LINEAR)
        tex.repeat_x = tex.repeat_y = False
        gl_tex[name] = tex
    backbuffer = next(n for n, t in textures.items() if t.get("backbuffer"))
    scratch = ctx.texture((w, h), 4)
    vao_cache = {}

    def program(ps):
        if ps not in vao_cache:
            prog = ctx.program(vertex_shader=stage("E_xCP_VS"), fragment_shader=stage(f"E_x{ps}"))
            vao_cache[ps] = ctx.vertex_array(prog, [])
        return vao_cache[ps]

    for tech in order:
        for ps, rt in techniques[tech]:
            vao = program(ps)
            target = gl_tex[rt] if rt else scratch
            fbo = ctx.framebuffer(color_attachments=[target])
            fbo.use()
            ctx.viewport = (0, 0, *target.size)
            for sampler, binding in bindings.items():
                gl_tex[samplers[sampler]].use(location=binding)
            ubo.bind_to_uniform_block(0)
            vao.render(moderngl.TRIANGLES, vertices=3)
            if rt is None:  # como no ReShade: o resultado vira o novo back buffer
                gl_tex[backbuffer].write(scratch.read())
            fbo.release()

    data = np.frombuffer(gl_tex[backbuffer].read(), dtype=np.uint8).reshape(h, w, 4)
    Image.fromarray(data[:, :, :3]).save(out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("input", type=Path)
    ap.add_argument("output", type=Path)
    ap.add_argument("--preset", type=Path)
    ap.add_argument("--fxc", default="fxc")
    a = ap.parse_args()
    run(a.input, a.output, a.preset, a.fxc)
