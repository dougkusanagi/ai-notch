# 0009. Atualização adaptativa, com ritmo e espera por serviço

- Status: Aceito
- Data: 2026-11-01

## Contexto

O notch consultava todos os serviços a cada 5 minutos, com uma única espera depois de um 429. Os dados ficavam velhos entre consultas, e um 429 do Claude também freava o Codex. Os endpoints de uso não são documentados. Relatos de usuários indicam que o do Claude limita com rigor, com 429 após consultas a cada 30–60 segundos, e que o do Codex tolera mais.

## Decisão

Cada serviço tem estado próprio: intervalo, intervalo mínimo e espera por 429.

- Claude: intervalo de 6 minutos e mínimo de 60 segundos.
- Codex: intervalo de 2 minutos e mínimo de 30 segundos.
- Desvio aleatório de ±10% no intervalo.
- Uma verificação a cada 15 segundos decide quais serviços estão na hora.
- Reset conhecido: o serviço é consultado 15 segundos depois do reset de qualquer janela, se ainda não foi visto.
- Ao abrir o painel, só consulta o serviço cujo dado tem mais de 60 segundos.
- Contas do mesmo serviço são consultadas em sequência, com pausa média de 2 segundos (±50%).
- A espera por 429 continua de 5, 10, 20, 40 e até 60 minutos, ou o `Retry-After` se for maior, agora por serviço.
- A consulta manual ignora o intervalo mínimo, mas nunca a espera por 429.
- O rodapé mostra a idade do dado mais antigo ("Atualizado há 3 min"). A dica do rodapé mostra a última consulta de cada serviço.

A lógica fica em `src/schedule.js`, em funções puras com testes.

## Alternativas

- Ler os dados de `rate_limits` da status line do Claude Code: evita o endpoint, mas exige configurar um comando no Claude Code e não cobre contas fora dele. Fica para uma decisão futura.
- Intervalo fixo menor (por exemplo, 1 minuto): aumenta o risco de 429 no Claude.

## Consequências

- O Codex fica mais atualizado e o Claude continua conservador.
- Os números de intervalo vêm de relatos de terceiros e podem precisar de ajuste.
- A versão Ubuntu precisa adotar a mesma política; está no plano `docs/plans/atualizacao-adaptativa.md`.
