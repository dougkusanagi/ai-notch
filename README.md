# AI Usage para GNOME Shell

Extensão nativa em GJS para acompanhar **limites reais de assinatura** de N contas Codex/OpenAI e Claude, com um indicador na barra superior, entre Atividades e a data/hora, com um anel por conta, que abre os detalhes ao clicar e mostra todas as janelas, resets e ajustes. Mesmo visual do [app para Windows](windows-notch/README.md). Superfícies sólidas, sem blur (seguro para o compositor), tema claro/escuro e ajustes que seguem a cor de destaque do sistema.

## Instalação

Requisitos: GNOME Shell 46–50, GLib (`glib-compile-schemas`), libsoup 3 e `make`. Para o leitor de Keyring direto do Codex, instale libsecret com introspecção (`gir1.2-secret-1` no Ubuntu/Debian). `gjs`, Node e `zip` são necessários apenas para testes/empacotamento.

```sh
make install
```

O destino é `~/.local/share/gnome-shell/extensions/ai-usage@guepardosys/`.
Na primeira instalação em **Wayland**, encerre a sessão e entre novamente para o Shell descobrir a extensão. Depois:

```sh
make enable
```

Em Xorg, também é possível recarregar o Shell com Alt+F2 → `r`. Clique no indicador AI Usage, à esquerda da data/hora (ou navegue pela barra com Ctrl+Alt+Tab e use Enter), e abra **Ajustes** (engrenagem) → **Adicionar conta**. O indicador ocupa apenas a barra superior. O painel de detalhes aparece ao clicar; Esc ou um clique fora fecham o painel e retornam dos Ajustes para Detalhes.

O ícone de envio ao lado do switch abre uma ajuda sobre a mensagem após reset e dá acesso a **Editar prompt**. O switch pequeno no cabeçalho de cada conta ativa **Mensagem após reset** (desligado por padrão). A extensão envia pelo CLI autenticado do perfil assim que uma consulta confirmar a janela de 5h disponível, inclusive ao ativar numa janela já disponível. Em **Editar conta**, o prompt padrão `Responda apenas: OK.` pode ser alterado (até 2000 caracteres). Uma consulta é agendada no horário do reset conhecido; durante suspensão ou com a extensão desligada, o envio aguarda a próxima consulta ao voltar.

A mensagem inicia a próxima janela e consome um pouco da assinatura. O CLI `codex` ou `claude` deve estar instalado no PATH da sessão GNOME ou em um dos diretórios de usuário reconhecidos: `~/.local/bin`, `~/.bun/bin`, `~/.npm-global/bin`, `~/.volta/bin` e `~/.local/share/pnpm`. Cada envio usa sessão nova, diretório temporário e o perfil cadastrado; saída e credenciais não são registradas; um trecho limitado da saída é analisado somente em memória para identificar falhas de login, modelo, versão ou limite de uso. Uma tentativa por janela fica salva em GSettings para impedir duplicações, inclusive após reiniciar. Se o CLI falhar, a conta mostra a causa e aguarda a próxima janela para tentar novamente. A tentativa tem limite de 2 minutos e é cancelada ao desabilitar a extensão ou alterar contas.

**Ajustes** (engrenagem) → **Adicionar conta**. Nenhuma conta fictícia é incluída.

## Perfis e autenticação

Autentique cada conta no respectivo CLI, antes de adicioná-la:

```sh
CODEX_HOME="$HOME/.codex" codex login
CODEX_HOME="$HOME/.codex-work" codex login
CLAUDE_CONFIG_DIR="$HOME/.claude" claude
CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude
```

No Claude Code, use `/login` quando necessário. Cadastre cada diretório separadamente. O editor mostra um comando de login selecionável com botão de copiar abaixo do diretório e o atualiza ao digitar ou trocar o serviço. O campo perfil aceita `~/diretório` ou caminho absoluto, sem interpretação de comandos ou variáveis de shell. API keys de faturamento por tokens não expõem os limites de assinatura.

- Codex: lê `auth.json` existente; se não existir, consulta o formato **direto/legado** do Codex Auth via libsecret. O backend recente de Keyring gerenciado/encriptado do Codex ainda não é suportado. A falha é explicada na conta; não há extração genérica de segredos.
- Claude: lê `.credentials.json` existente no diretório configurado, padrão Linux do Claude Code.
- A extensão não salva, copia nem imprime credenciais. Configuração no GSettings contém somente metadados e aparência. Credenciais permanecem em memória pelo tempo da consulta.
- Tokens expirados devem ser renovados pelo CLI correspondente; a extensão não manipula refresh tokens rotativos.

As [descobertas e fontes](docs/RESEARCH.md) explicam os endpoints internos, que podem mudar ou restringir clientes externos. Em 30/09/2026, ambos os providers foram exercitados com os perfis locais autenticados: Codex retornou 5h e semanal; Claude retornou 5h, semanal e limites adicionais. Nenhum token foi registrado.

## Uso

O painel usa barras finas de 5 px e controles compactos, como a versão Windows. No rodapé do painel aberto, os ícones de sol, lua e monitor selecionam Claro, Escuro e Sistema; a escolha fica salva.

**Detalhes** mostra, por conta, nome, provider e plano, percentual restante, reset com dia/hora na mesma linha de cada janela e todas as janelas disponíveis; o subtítulo informa a última consulta bem-sucedida. A janela de aproximadamente 5h tem prioridade na top bar; na ausência dela, a semanal principal é usada..

Uma janela de 5h sem uso ou já vencida mostra **aguardando mensagem**, sem horário na barra superior. O próximo reset aparece após o provedor confirmar o início da janela por uma mensagem; não é calculado localmente.

O ícone de envio ao lado do switch abre uma ajuda sobre a mensagem após reset e dá acesso a **Editar prompt**. O switch pequeno no cabeçalho de cada conta ativa **Mensagem após reset** (desligado por padrão). A extensão envia pelo CLI autenticado do perfil assim que uma consulta confirmar a janela de 5h disponível, inclusive ao ativar numa janela já disponível. Em **Editar conta**, o prompt padrão `Responda apenas: OK.` pode ser alterado (até 2000 caracteres). Uma consulta é agendada no horário do reset conhecido; durante suspensão ou com a extensão desligada, o envio aguarda a próxima consulta ao voltar.

A mensagem inicia a próxima janela e consome um pouco da assinatura. O CLI `codex` ou `claude` deve estar instalado no PATH da sessão GNOME ou em um dos diretórios de usuário reconhecidos: `~/.local/bin`, `~/.bun/bin`, `~/.npm-global/bin`, `~/.volta/bin` e `~/.local/share/pnpm`. Cada envio usa sessão nova, diretório temporário e o perfil cadastrado; saída e credenciais não são registradas; um trecho limitado da saída é analisado somente em memória para identificar falhas de login, modelo, versão ou limite de uso. Uma tentativa por janela fica salva em GSettings para impedir duplicações, inclusive após reiniciar. Se o CLI falhar, a conta mostra a causa e aguarda a próxima janela para tentar novamente. A tentativa tem limite de 2 minutos e é cancelada ao desabilitar a extensão ou alterar contas.

**Ajustes** (engrenagem) contém tema Auto/Claro/Escuro (padrão Auto, acompanha o GNOME em tempo real), formato do reset 24h/12h/relativo, barras coloridas, intervalo de 1–60 minutos e as contas. Cada conta pode ser reordenada pelas setas (acessível por teclado, sem drag-and-drop), ocultada da barra ou editada; o editor tem pré-visualização ao vivo, paleta, hex, iniciais automáticas até a primeira edição manual e **Remover** com confirmação. Fechar o popup sempre volta para Detalhes.

O indicador compacto mostra um anel por conta (Claude à esquerda, Codex à direita; com mais de uma conta do mesmo serviço, o anel leva as iniciais). Nas janelas abertas, a barra enche da esquerda para a direita e muda de cor conforme o que resta: verde acima de 40%, âmbar até 15% e vermelho abaixo disso. Com barras coloridas desligadas, o preenchimento é monocromático. Falhas são independentes. Se já houve uma consulta bem-sucedida nesta sessão, os últimos dados continuam visíveis com o aviso **Dados desatualizados**, a idade da consulta e `!` no indicador. Sem dados anteriores, a conta mostra `--` e a causa. Esses dados ficam somente em memória e são descartados ao trocar o provider/diretório ou desabilitar a extensão. Em HTTP 429, novas consultas (inclusive manuais) respeitam o Retry-After do provedor e uma espera progressiva de 5, 10, 20, 40 e até 60 minutos; o maior prazo prevalece. Durante essa pausa, dados anteriores permanecem visíveis sem aviso de erro. A próxima tentativa ocorre ao final do prazo; uma consulta bem-sucedida reinicia a espera.

## Desenvolvimento

```sh
make build       # compila schema e prepara build/
make check       # sintaxe, metadata e schema
make test        # testes Node + GJS real, HTTP local e lifecycle
make test-prefs  # instancia preferências GTK4 (requer sessão gráfica)
make pack        # dist/ai-usage@guepardosys.shell-extension.zip
make debug       # journal do GNOME Shell
make disable
make uninstall
```

Diagnóstico read-only de uma conta, sem imprimir credenciais:

```sh
gjs -m scripts/probe.js openai ~/.codex-work
gjs -m scripts/probe.js claude ~/.claude-work
```

Veja [validação e compatibilidade](docs/VALIDATION.md). As capturas de teste usam dados de fixture **apenas na sessão isolada**; não há modo simulado no provider nem no pacote instalado.

## Arquitetura

- `providers/`: libsoup 3, endpoints fixos HTTPS e normalização de limites.
- `services/accounts.js`: validação e ordem em GSettings; UUID estável por conta.
- `services/credentials.js`: leitura assíncrona de credenciais existentes e libsecret opcional.
- `services/reset-message.js`: envio opt-in pelo CLI do perfil, timeout e cancelamento.
- `services/refresh.js`: até quatro contas em paralelo, Retry-After, geração de consultas e cancelamento.
- `ui/`: componentes St (segmented, switch, grupos, identidade) e barra Cairo em pílula.
- `extension.js`: PanelMenu, telas (detalhes, ajustes, editor) e lifecycle.
- `prefs.js`: preferências GTK4/libadwaita para acesso pelo gerenciador de extensões.

Todos os timers, sinais, bindings, efeitos e requests são removidos ao desabilitar. Subprocessos dos CLIs são iniciados apenas para contas com mensagem após reset ativada, sem interpretação de shell. Trocar o provider/diretório de uma conta invalida imediatamente a quota daquele perfil.

## Windows

O mesmo notch para Windows 11 (Electron): fechado mostra o restante da janela de 5h, ao passar o mouse abre com 5h e semanal, resets e tema. Instalador, bandeja e detalhes em [windows-notch/README.md](windows-notch/README.md).

Quando a API limita as consultas, a extensão mantém os últimos dados disponíveis e respeita a pausa informada pelo provedor, inclusive ao atualizar manualmente. Sem prazo informado, a pausa começa em cinco minutos e aumenta em recusas consecutivas. Uma nova tentativa ocorre ao final da pausa.

Todas as atualizações respeitam um intervalo mínimo preventivo de cinco minutos por provider e diretório de perfil, ou o intervalo configurado se maior. Cliques manuais e o envio automático de mensagem não antecipam a próxima consulta. Esse intervalo é uma política conservadora da extensão, não uma garantia publicada pelos provedores; outras aplicações também podem consumir o limite da conta.
