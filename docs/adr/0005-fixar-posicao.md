# 0005. Opção de fixar a posição

- Status: Aceito
- Data: 2026-11-01

## Contexto

Com o arrasto, é fácil mover o notch sem querer.

## Decisão

A preferência `locked` desativa o arrasto e o duplo clique para centralizar, e tira o cursor de "mão". A ação "Centralizar no monitor" do menu continua funcionando, porque é um gesto deliberado. A trava vale para todos os monitores.

## Alternativas

- Exigir uma tecla modificadora para arrastar: mais difícil de descobrir.
- Travar por monitor: mais complexidade sem necessidade clara.

## Consequências

- O main process também ignora mensagens de arrasto quando travado, não só o renderer.
