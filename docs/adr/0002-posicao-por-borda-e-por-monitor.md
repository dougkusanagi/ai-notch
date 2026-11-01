# 0002. Posição por borda, escolhida por monitor

- Status: Aceito
- Data: 2026-11-01

## Contexto

O notch só ficava no topo. Há quem queira vê-lo na base, junto da barra de tarefas, ou nas laterais, e em lugares diferentes em cada monitor.

## Decisão

Cada monitor tem uma borda: topo, base, esquerda ou direita. Na base, a forma é espelhada e o painel abre para cima. Nas laterais, o notch fechado vira uma pílula vertical e o painel abre para dentro da tela. `prefs.json` guarda `edge` (padrão) e `edges` (por monitor). O CSS usa `body[data-edge]` e o renderer recebe a borda do próprio monitor.

## Alternativas

- Uma borda global: mais simples, mas não atende quem tem monitores com usos diferentes.
- Girar a janela inteira com `transform`: espelharia o texto e quebraria o layout.

## Consequências

- Todo ajuste visual do notch precisa ser conferido nas quatro bordas.
- Os cantos côncavos são o desenho do topo transposto ou espelhado, e dependem de transformações CSS.
