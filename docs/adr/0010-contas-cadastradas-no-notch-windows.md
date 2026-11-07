# 0010. Contas cadastradas pelo usuário no notch do Windows

- Status: Aceito
- Data: 2026-11-05

## Contexto

O notch do Windows detectava sozinho os diretórios `.claude*` e `.codex*` na pasta do usuário, sem permitir nome, cor, ordem ou ocultar contas. A extensão GNOME já usa contas cadastradas (nome, diretório, iniciais, cor, visibilidade, mensagem após reset).

## Decisão

- As contas ficam em `prefs.json` (`accounts`), sem credenciais. Tokens continuam só em memória.
- Na primeira execução com esta versão, a lista é criada a partir dos perfis detectados. Depois disso a detecção automática não roda mais: contas novas entram pelo cadastro.
- Contas ocultas não são consultadas, para poupar o limite de consultas.
- A mensagem após o reset usa o CLI da conta (`claude` ou `codex`), com o prompt pela entrada padrão e sem chaves de API herdadas do ambiente. A tentativa é registrada em `prefs.json` (`resetAttempts`), no máximo uma a cada 5 minutos por conta.
- O intervalo de consulta configurável da extensão GNOME não foi levado ao Windows: vale a política por serviço do ADR 0009.

## Alternativas

- Manter a detecção automática junto com o cadastro: duplicaria contas e confundiria ordem e ocultação.

## Consequências

- Quem já usa o app mantém as contas detectadas, mas um perfil criado depois precisa ser adicionado à mão.
- O envio da mensagem em atalhos `.cmd` (npm) passa pelo `cmd.exe`, com argumentos fixos entre aspas; o texto do usuário nunca entra na linha de comando.
