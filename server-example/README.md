# Exemplo de pasta do hub

Copie `hub/` para o servidor e aponte `CP_HUB_DIR` para ela. Para publicar um mod:

```
hub/mods/<id-do-mod>/mod.json              nome, resumo, autores, categoria
hub/mods/<id-do-mod>/icon.png              opcional
hub/mods/<id-do-mod>/<versão>/pacote.zip   (ou um único .scd)
hub/mods/<id-do-mod>/<versão>/version.json changelog, DLC, multiplayer (opcional)
```

O servidor calcula SHA-256 e tamanho sozinho e relê a pasta a cada ~5 minutos.
Para conferir antes de subir: `cp hub-build hub/` mostra o índice e os avisos.
A versão 1.0.0 do exemplo está sem pacote de propósito — ela aparece como aviso.
