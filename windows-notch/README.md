# AI Quota Notch (Windows)

Indicador pequeno no topo central da tela, no estilo do notch do MacBook. Fechado, mostra o restante da janela de 5 horas do Claude e do Codex. Ao passar o mouse, abre e mostra as janelas de 5 horas e semanal, o horário de renovação, o seletor de tema (Claro, Escuro, Sistema), o botão Atualizar e o menu (Iniciar com o Windows, Sair).

Com mais de uma conta do mesmo serviço, o notch fechado mostra um anel por conta com as iniciais do perfil no centro, sem o percentual, e o painel agrupa as contas por serviço. Com uma conta só, as iniciais não aparecem e o percentual fica ao lado do anel.

Pelo menu (⋯, botão direito no notch ou na bandeja), **Monitores e posição…** abre uma janela onde cada monitor tem sua caixa "Mostrar o notch aqui" (sem nenhuma marcada o notch fica oculto; clicar no ícone da bandeja o traz de volta) e sua própria borda: topo, base, esquerda ou direita. Base e laterais ficam acima da barra de tarefas. Arraste o notch ao longo da borda para tirá-lo de cima de outra informação; o limite considera o painel aberto, para não vazar para outro monitor. Duplo clique ou **Centralizar no monitor** volta ao centro. **Fixar posição** bloqueia o arrasto.

Fora do notch, a janela é transparente e deixa os cliques passarem.

## Dados

- Perfis: o app usa o diretório padrão e também detecta diretórios irmãos com login, como `.claude-trabalho` ou `.codex-cliente`. O nome e as iniciais vêm do sufixo (`trabalho` → Trabalho / TR).
- Claude: lê `%USERPROFILE%\.claude\.credentials.json` (ou `CLAUDE_CONFIG_DIR`). Faça login pelo Claude Code.
- Codex: lê `%USERPROFILE%\.codex\auth.json` (ou `CODEX_HOME`). Faça login com `codex login`.
- Tokens ficam só em memória. O app não salva, não copia e não registra credenciais. A consulta é feita a cada 5 minutos e de novo ao voltar da suspensão ou desbloquear a tela.
- Se uma consulta falhar, os últimos números continuam na tela como **desatualizados** (`!` no notch e o motivo no painel). Em HTTP 429, nem a atualização manual consulta antes do prazo: espera de 5, 10, 20, 40 e até 60 minutos, ou o Retry-After do serviço se for maior.
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

O instalador também pode ser gerado no Linux (precisa de acesso à internet na primeira vez). O app não é assinado, então o SmartScreen avisa na primeira execução. O ícone na bandeja é o plano B se o notch ficar escondido: clique atualiza, botão direito abre o menu (Atualizar, Iniciar com o Windows, Sair). `bun run icon` regenera `assets/icon.*` (precisa de Python com Pillow).

Preferências (tema) ficam em `%APPDATA%\ai-quota-notch\prefs.json`.

## Linux (Ubuntu/GNOME, protótipo)

No Wayland o app não pode posicionar a própria janela. Uma extensão pequena, `ai-notch-helper@guepardosys`, lê `$XDG_RUNTIME_DIR/ai-notch/layout.json` (gravado pelo app) e posiciona as janelas `ai-notch:*`, deixando-as por cima e em todos os workspaces. A extensão `ai-usage@guepardosys` não muda.

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$PWD/../ai-notch-helper@guepardosys" ~/.local/share/gnome-shell/extensions/
gnome-extensions enable ai-notch-helper@guepardosys   # no Wayland, saia da sessão e entre de novo na primeira vez
bun install
bun run start:linux
```

Em teste: a bandeja só aparece com AppIndicator no GNOME, e a barra superior pode ficar por cima do notch. Veja `docs/plans/linux-electron-posicionador.md`.
