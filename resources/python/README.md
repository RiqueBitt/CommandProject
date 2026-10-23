# Python embutido (opcional)

O Estúdio de Mapas usa o SC2 Map Toolkit, que é Python puro (só biblioteca padrão).
No build de release (GitHub Actions) esta pasta recebe o **Python embutido oficial para
Windows** (python-3.12.x-embed-amd64.zip, de python.org), para o usuário não precisar
instalar nada. Em desenvolvimento ela pode ficar vazia: o launcher usa o Python do sistema.
