# AI Quota Notch (Windows)

Indicador pequeno no topo central da tela, no estilo do notch do MacBook. Fechado, mostra o restante da janela de 5 horas do Claude e do Codex. Ao passar o mouse, abre e mostra as janelas de 5 horas e semanal, o horário de renovação, o seletor de tema (Claro, Escuro, Sistema), o botão Atualizar e o menu (Iniciar com o Windows, Sair).

Com mais de uma conta do mesmo serviço, o notch fechado mostra um anel por conta com as iniciais do perfil no centro, sem o percentual, e o painel agrupa as contas por serviço. Com uma conta só, as iniciais não aparecem e o percentual fica ao lado do anel.

O botão de engrenagem no rodapé do painel (ou **Configurações…** no menu ⋯, no botão direito do notch e na bandeja) abre a tela de configuração, onde cada monitor tem sua caixa "Mostrar o notch aqui" (sem nenhuma marcada o notch fica oculto; clicar no ícone da bandeja o traz de volta) e sua própria borda: topo, base, esquerda ou direita. Base e laterais ficam acima da barra de tarefas. Arraste o notch ao longo da borda para tirá-lo de cima de outra informação; o limite considera o painel aberto, para não vazar para outro monitor. Duplo clique ou **Centralizar no monitor** volta ao centro. **Fixar posição** bloqueia o arrasto.

Em **Configurações e contas…** (⋯, botão direito ou bandeja) ficam três abas: **Ajustes** (tema, formato do horário de reset 24 h/12 h/relativo, barras coloridas, iniciar com o Windows), **Contas** e **Monitores e posição**. Em Contas é possível adicionar, editar, remover, reordenar e ocultar contas, escolher serviço, nome, diretório do perfil, iniciais e cor, e copiar o comando de login do PowerShell. A opção **Mensagem após o reset de 5 h** envia, pelo CLI da conta (`claude` ou `codex`, no PATH, em `~.localin` ou em `~AppDataRoaming
pm`), uma mensagem curta quando a janela de 5 horas fica livre. O texto vai pela entrada padrão. O app precisa estar aberto.

Fora do notch, a janela é transparente e deixa os cliques passarem.

## Dados

- Perfis: na primeira execução o app cria a lista de contas a partir do diretório padrão e dos irmãos com login, como `.claude-trabalho` ou `.codex-cliente` (nome e iniciais vêm do sufixo). Depois disso a lista é a da aba Contas; perfis novos entram por **Adicionar conta**. Contas ocultas não são consultadas.
- Claude: lê `%USERPROFILE%\.claude\.credentials.json` (ou `CLAUDE_CONFIG_DIR`). Faça login pelo Claude Code.
- Codex: lê `%USERPROFILE%\.codex\auth.json` (ou `CODEX_HOME`). Faça login com `codex login`.
- Tokens ficam só em memória. O app não salva, não copia e não registra credenciais. Cada serviço tem o próprio ritmo: Claude a cada ~6 minutos (o endpoint limita com rigor) e Codex a cada ~2 minutos, sempre com intervalo mínimo e pequeno desvio aleatório. Também consulta ao abrir o painel se o dado tem mais de 1 minuto, logo depois de um reset conhecido e ao voltar da suspensão ou desbloquear a tela. Contas do mesmo serviço são consultadas em sequência.
- Se uma consulta falhar, os últimos números continuam na tela como **desatualizados** (`!` no notch e o motivo no painel). Em HTTP 429, só aquele serviço espera (a atualização manual também respeita o prazo): espera de 5, 10, 20, 40 e até 60 minutos, ou o Retry-After do serviço se for maior.
- Os endpoints são internos e podem mudar (veja `docs/RESEARCH.md`).

## Executar

No PowerShell, na pasta `windows-notch`:

```powershell
bun install
bun run start   # dados reais
bun run demo        # dados simulados, 1 conta de cada
bun run demo:multi  # dados simulados, 2 contas de cada
bun test
```

## Instalar

```powershell
bun install
bun run dist   # gera out\AI Quota Notch Setup 0.1.0.exe (NSIS, por usuário, sem admin)
```

O instalador também pode ser gerado no Linux (precisa de acesso à internet na primeira vez). O app não é assinado, então o SmartScreen avisa na primeira execução. O ícone na bandeja é o plano B se o notch ficar escondido: clique atualiza, botão direito abre o menu (Atualizar, Iniciar com o Windows, Sair). `bun run icon` regenera `assets/icon.*` (precisa do `uv`).

Preferências e contas (sem credenciais) ficam em `%APPDATA%\ai-quota-notch\prefs.json`.

## Linux (Ubuntu/GNOME, protótipo)

No Linux o app roda em Wayland nativo. Como o Wayland não deixa recortar a área de cliques, a janela tem o tamanho do notch e muda de tamanho junto com ele, sem "janela fantasma" transparente. A bandeja usa `assets/tray-linux.png` (anéis claros, visíveis na barra escura) e só aparece com a extensão AppIndicator ativa. Uma extensão pequena, `ai-notch-helper@guepardosys`, lê `$XDG_RUNTIME_DIR/ai-notch/layout.json` (gravado pelo app) e posiciona as janelas `ai-notch:*`, deixando-as por cima e em todos os workspaces; ela também tira o notch da lista de apps do dock (a janela de Configurações continua aparecendo). Depois de atualizar a extensão, reinicie a sessão. A extensão `ai-usage@guepardosys` não muda.
Quando uma janela entra em tela cheia, o helper oculta a superfície do notch naquele monitor até a saída desse modo, sem depender da minimização da janela Electron.

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$PWD/../ai-notch-helper@guepardosys" ~/.local/share/gnome-shell/extensions/
gnome-extensions enable ai-notch-helper@guepardosys   # no Wayland, saia da sessão e entre de novo na primeira vez
bun install
bun run start:linux
```

### Instalar no Linux (AppImage)

```bash
cd windows-notch
bun run dist:linux   # gera out/ai-quota-notch-<versão>-x86_64.AppImage
```

Abra o AppImage com o Gear Lever: ele move o arquivo para `~/AppImages` e cria o atalho no menu de aplicativos. A extensão `ai-notch-helper@guepardosys` continua necessária (passos acima). Abrir o app pelo menu com ele já aberto traz o notch de volta. **Iniciar com o sistema** grava `~/.config/autostart/ai-quota-notch.desktop` e o mantém apontando para o AppImage atual.

Em teste: a barra superior pode ficar por cima do notch. Veja `docs/plans/linux-electron-posicionador.md`.

No Linux, a janela recebe o mouse diretamente e acompanha o tamanho do widget durante a expansão. Sem sombra no painel aberto, porque a janela a cortaria. `bun run icon` também gera `assets/tray-linux.png`.

### Atualizar a versão instalada

```bash
bun run desktop:update   # na raiz do repositório (ou em windows-notch/)
```

Gera e instala a versão atual no sistema em que roda: no Windows, o instalador NSIS em modo silencioso; no Ubuntu, o AppImage em `~/AppImages` (remove versões antigas). Fecha o notch em execução antes. Para atualizar os dois, rode o comando em cada sistema.
