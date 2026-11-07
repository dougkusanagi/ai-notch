# Atualização adaptativa e paridade com a versão Ubuntu

## Objetivo

Manter os dados de uso atualizados sem estourar os limites de consulta do Claude e do Codex, no Windows e na extensão GNOME (Ubuntu), com o mesmo comportamento nas duas.

## Passos

- [x] Windows: estado, ritmo e espera por serviço (`windows-notch/src/schedule.js`).
- [x] Windows: consulta ao abrir o painel quando o dado tem mais de 60 segundos.
- [x] Windows: consulta logo depois do reset conhecido.
- [x] Windows: contas do mesmo serviço em sequência, com pausa e desvio aleatório.
- [x] Windows: idade do dado no rodapé.
- [x] Decisão registrada em `docs/adr/0009-atualizacao-adaptativa-por-servico.md`.
- [ ] Ubuntu: ler `ai-usage@guepardosys/services` e `providers` e comparar com `windows-notch/src/usage.js`.
- [ ] Ubuntu: levar a política (intervalos, mínimo, 429 por serviço, reset, desvio aleatório) para a extensão, com a mesma tabela de valores.
- [ ] Ubuntu: consultar ao abrir o painel se o dado tem mais de 60 segundos.
- [ ] Ubuntu: mostrar a idade do dado no painel.
- [ ] Ubuntu: testes da política e teste manual numa máquina Ubuntu (GNOME 46–50).
- [ ] Decidir se a lógica pura vira um módulo compartilhado entre as duas versões (ver abaixo).

## Paridade com a versão Ubuntu

- A política vive em uma tabela única (`POLICY`: intervalo e mínimo por serviço, 60 s de dado velho, 15 s após o reset, pausa entre contas). Qualquer ajuste de valor deve ser feito nos dois lados no mesmo commit.
- A extensão usa GJS e libsoup 3, sem módulos Node. Se `schedule.js` ficar sem dependências além de `backoffMs`, ele pode ser copiado ou compartilhado como módulo ES.
- Para a extensão manter o "quase igual", as mensagens de rodapé e os textos de erro devem ser os mesmos.

## Tentativas que falharam

Nenhuma até agora.

## Dúvidas abertas

- Os limites reais dos endpoints não são públicos. Observar 429 reais e ajustar os intervalos.
- Ler `rate_limits` da status line do Claude Code (evita o endpoint, mas exige configurar o Claude Code). Precisa de aprovação.
- Decidir se a extensão GNOME passa a ser um notch flutuante, o que muda o escopo da paridade visual.

## Próximo passo

Ler o código da extensão (`ai-usage@guepardosys/services` e `providers`) e listar as diferenças em relação ao Windows.
