# Shaders do CommandProject

Pós-processamento para o Supreme Commander 2, feito para o [ReShade](https://reshade.me)
(DirectX 9). Um arquivo só (`CommandProject.fx`), sem depender de outros pacotes de shaders.

| Técnica | O que faz |
|---|---|
| `CP_Suavizar` | anti-serrilhado guiado pela direção da borda (estilo FXAA) |
| `CP_Detalhe` | nitidez adaptativa (forte onde está borrado, fraca onde já há contraste) + clareza (contraste local nos meios-tons) |
| `CP_Brilho` | bloom em espaço linear, cadeia de 5 níveis (downsample/upsample), limiar suave e média de Karis contra cintilação |
| `CP_Cor` | exposição, balanço de branco, sombras, meios-tons, contraste em curva S, vibração, saturação, vinheta e dithering |

Presets em `presets/`: **Natural**, **Vívido**, **Cinemático** e **Desligado**.

Tudo roda só na sua máquina: não altera a simulação do jogo e **não dessincroniza o multiplayer**.
Como o ReShade trabalha na imagem final, a interface também recebe os efeitos; os valores padrão
foram escolhidos para os textos continuarem legíveis.

## Pelo launcher

*Mods → Shaders do CommandProject*: escolha o preset e clique em **Instalar ReShade e ativar**.
O launcher baixa o instalador oficial em reshade.me, confere a assinatura digital pelo Windows,
instala para DirectX 9 em modo silencioso e copia os shaders e presets para a pasta `bin` do jogo.

No jogo: **Scroll Lock** liga/desliga os efeitos e **Home** abre o menu do ReShade, onde dá para
ajustar cada valor. Ajustes feitos ali ficam no preset e não são sobrescritos em atualizações
(o launcher mostra "ajustado"; *Restaurar os presets* volta ao padrão).

Pela linha de comando: `cp reshade`, `cp shaders vivido`, `cp shaders off`, `cp shaders remove`.

## Manualmente

1. Instale o ReShade escolhendo `bin\SupremeCommander2.exe` e **DirectX 9**.
2. Copie `CommandProject.fx` para `bin\reshade-shaders\Shaders\` e um dos presets para `bin\`.
3. No jogo, aperte **Home** e selecione o preset.

## Testes

- `tools/shaders/check.sh` compila o `.fx` com o compilador do próprio ReShade (versão fixa) e gera
  o HLSL de cada passe para Shader Model 3 em quatro resoluções. No CI, cada um é compilado com o
  `fxc.exe` da Microsoft (`vs_3_0`/`ps_3_0`), o mesmo compilador que o ReShade usa no DirectX 9.
- `tools/shader_preview.py` executa os shaders fora do jogo (OpenGL, imitando o runtime do ReShade)
  e gera prévias; `tools/make_test_scene.py` cria a cena de teste usada nas imagens do launcher.

Licença: MIT (veja `LICENSE` na raiz do projeto).
