# 0006. Menu de contexto e painel fixado enquanto o menu está aberto

- Status: Aceito
- Data: 2026-11-01

## Contexto

As ações de posição e monitores precisam estar à mão. O menu nativo "⋯" fechava o painel quando o mouse saía do notch para o menu.

## Decisão

O botão direito sobre o notch abre o mesmo menu nativo da bandeja e do botão "⋯", gerado por um único `menuTemplate`. Enquanto esse menu está aberto, o main process avisa o renderer (`pin`), que mantém o painel expandido. Ao fechar o menu, o painel recolhe se o mouse estiver fora.

## Alternativas

- Menu HTML dentro da janela: a janela é transparente e tem área limitada.
- Ignorar o `mouseleave`: o painel nunca fecharia.

## Consequências

- Uma só lista de ações para os três pontos de entrada.
- O estado `pinned` precisa ser liberado no callback de fechamento do menu.
