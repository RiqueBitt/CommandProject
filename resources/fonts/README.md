# Fontes do tema "Menu moderno"

Roboto Medium e Bold — a mesma família da interface do launcher. Copyright 2011 The Roboto Project
Authors, licença SIL Open Font License 1.1 (veja `OFL.txt`). Origem:
https://github.com/google/fonts/tree/main/ofl/roboto (instâncias estáticas wght 500 e 700 tiradas da
fonte variável com `fontTools.varLib.instancer`, sem outras mudanças).

As fontes daqui já passaram por `tools/build_fonts.py` (fontTools), que deixa a Roboto no mesmo
formato das fontes originais do jogo, lidas pelo Windows (GDI): tabela `kern` clássica (o jogo pede os
pares de kerning ao GDI), `post` 2.0, cmap Mac + Windows, só os caracteres latinos (português incluso)
e sem tabelas OpenType de layout.

O launcher grava uma cópia com o nome interno das fontes originais do jogo (MagistralTT) para que o
SC2 a encontre. A fonte só ganha a tabela de nomes e os campos de estilo da original.
