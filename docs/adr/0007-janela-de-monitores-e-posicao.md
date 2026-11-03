# 0007. Janela "Monitores e posição"

- Status: Aceito
- Data: 2026-11-01

## Contexto

Com posição por monitor ([0002](0002-posicao-por-borda-e-por-monitor.md)) e seleção por caixas ([0001](0001-selecao-de-monitores-por-caixas.md)), submenus ficaram difíceis de usar.

## Decisão

O item "Monitores e posição…" abre uma janela própria com um cartão por monitor: caixa de exibição, miniatura com o notch na borda escolhida, botões Topo, Base, Esquerda e Direita, e "Centralizar neste monitor". A caixa "Fixar posição" fica no rodapé. A janela tem preload e CSP próprios, segue o tema do sistema e usa as mesmas preferências do notch (`settings:get` e `settings:set`).

## Alternativas

- Submenus aninhados: foram a primeira versão e ficaram confusos com vários monitores.
- Mapa visual do arranjo dos monitores: mais difícil de manter e pouco ganho para 2 ou 3 monitores.

## Consequências

- Três arquivos novos: `settings.html`, `settings.css` e `settings.js`.
- A janela relê os monitores ao receber foco, para refletir mudanças de conexão.
