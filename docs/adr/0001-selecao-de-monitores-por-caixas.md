# 0001. Seleção de monitores por caixas, com opção de ocultar

- Status: Aceito
- Data: 2026-11-01

## Contexto

O notch do Windows aparecia só no monitor principal. Quem usa vários monitores quer escolher onde ele aparece, inclusive em todos, e poder tirá-lo da tela sem sair do app.

## Decisão

Cada monitor tem uma caixa "Mostrar o notch aqui". Cada monitor marcado recebe uma janela própria. Sem nenhum marcado, o notch fica oculto. `prefs.json` guarda `displays`: `null` (só o principal, padrão), lista de ids ou lista vazia (oculto). Se os monitores marcados forem desconectados, o app volta para o principal. O ícone da bandeja continua disponível, e o clique esquerdo nele mostra o notch de novo no principal.

## Alternativas

- Menu com "principal / um monitor / todos": menos flexível e não permite escolher um subconjunto.
- Não permitir ocultar: obriga o usuário a sair do app para tirar o notch da tela.

## Consequências

- Uma janela transparente por monitor, com a mesma página.
- O formato `displays` passa a fazer parte das preferências salvas; mudá-lo exige migração.
- O ícone da bandeja é a rota de recuperação e não pode ser removido.
