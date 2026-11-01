# 0004. Arrasto ao longo da borda, limitado pelo painel aberto

- Status: Aceito
- Data: 2026-11-01

## Contexto

O notch pode cobrir informações da tela. O usuário precisa deslocá-lo, mas o painel aberto não pode vazar para o monitor vizinho.

## Decisão

O notch é arrastado só ao longo da sua borda: na horizontal no topo e na base, na vertical nas laterais. O limite usa a largura do painel aberto (396 px) no topo e na base, e a altura da janela nas laterais. O deslocamento fica em memória durante o arrasto e é gravado ao soltar. `offsets` usa a chave `h:<id>` ou `v:<id>`, ou seja, um deslocamento por eixo e por monitor. Duplo clique centraliza.

## Alternativas

- Arrasto livre em dois eixos: o notch deixaria de parecer preso à borda.
- Limitar pelo notch fechado: o painel aberto vazaria para o monitor vizinho.

## Consequências

- Trocar a borda de um monitor mantém o deslocamento do outro eixo.
- A chave de `offsets` faz parte das preferências salvas.
