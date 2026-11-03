# Plano: protótipo do notch Electron no Ubuntu com extensão posicionadora

Tipo: tarefa

## Objetivo

Provar que o app de `windows-notch/` (Electron) roda no Ubuntu/GNOME em Wayland
com a mesma interface do Windows. Uma extensão GNOME pequena faz só o que o
Wayland proíbe ao app: posicionar a janela e mantê-la por cima.

Critério de conclusão do protótipo:

- o notch aparece no topo do monitor certo, por cima das janelas normais, em todos os workspaces;
- mudar borda, monitor e deslocamento (arrasto) reposiciona a janela;
- nada muda no comportamento do Windows.

A extensão atual (`ai-usage@guepardosys/`) não é alterada.

## Desenho

- **Canal app → extensão: arquivo JSON**, sem dependência de D-Bus no Node.
  O Electron grava `$XDG_RUNTIME_DIR/ai-notch/layout.json` (escrita atômica:
  arquivo temporário + `rename`). A extensão observa o arquivo com `Gio.FileMonitor`.
- Formato (versão 1):
  ```json
  { "version": 1, "windows": [ { "title": "ai-notch:<displayId>", "x": 0, "y": 0, "width": 460, "height": 640 } ] }
  ```
  Coordenadas lógicas globais, iguais às que `place()` já calcula.
- **Identificação da janela:** título fixo `ai-notch:<displayId>` em cada `BrowserWindow`
  e `WM_CLASS` do app. A extensão só toca janelas com o prefixo `ai-notch:`.
- **Extensão `ai-notch-helper@guepardosys/`:** em `window-created` e quando o JSON muda,
  para cada janela correspondente: `make_above()`, `stick()`, `move_frame(false, x, y)`.
  Reaplica a posição se a janela se mover sozinha (`position-changed`), com proteção contra laço.
  Sem interface, sem preferências.
- **Electron:** em `process.platform === 'linux'`, `place()` continua chamando `setBounds`
  e também grava o layout. Inicia com `--ozone-platform-hint=auto` (Wayland nativo).
  O código Windows não muda.

## Passos

- [x] 1. `windows-notch/src/linux-layout.js`: módulo puro `buildLayout(wins)` + `writeLayout(layout, dir)` com escrita atômica. Testes em `windows-notch/test/linux-layout.test.js` (`bun test`).
- [x] 2. `main.js`: título `ai-notch:<id>` nas janelas do notch; no Linux, gravar o layout após `place()`/`syncWindows()` e ao fechar janelas; ativar `ozone-platform-hint=auto` só no Linux.
- [x] 3. Criar `ai-notch-helper@guepardosys/` (`metadata.json` com shell 46–50, `extension.js`) com `enable()`/`disable()` que desconectam todos os sinais e o monitor do arquivo.
- [x] 4. Script `package.json` `start:linux` e instruções no `windows-notch/README.md` (instalar a extensão, `gnome-extensions enable`, reiniciar sessão no Wayland).
- [x] 5. Fragmento `changelog/unreleased/linux-notch-electron.md` (Adicionado).
- [ ] 6. Teste manual no Ubuntu (usuário): roteiro abaixo.

## Roteiro de teste manual (Ubuntu, Wayland)

1. O notch aparece no topo do monitor principal e fica sobre uma janela maximizada?
2. Ele cobre ou fica abaixo da barra superior do GNOME?
3. Cliques nas áreas transparentes passam para a janela de trás?
4. Arrastar move o notch sem tremer?
5. Trocar de workspace mantém o notch visível?
6. Com dois monitores, a posição fica certa (inclusive com escala fracionária)?

## Tentativas que falharam

- Wayland nativo: `setShape`/`setIgnoreMouseEvents` não funcionam (janela fantasma de 460×640) e `skipTaskbar` é ignorado (notch no dock). X11 também falhou: a GPU do Electron morre (exit 139) e nada é desenhado. Solução atual: janela do tamanho do notch + filtro do dock na extensão — veja `docs/adr/0009-notch-linux-janela-do-tamanho-do-notch.md`.

## Dúvidas abertas

- Barra superior: janelas normais ficam abaixo dela. Se o notch precisar cobri-la, mover o actor para `Main.layoutManager` (mais frágil).
- `setIgnoreMouseEvents` no Wayland: se os cliques não passarem, a extensão terá de definir a região de entrada.
- Coordenadas do Electron e do Mutter com escala fracionária podem divergir.
- Ícone da bandeja: no GNOME sem AppIndicator não aparece; avaliar menu na extensão depois do protótipo.

## Próximo passo

Verificado em 2026-11-03 com captura pelo portal e ponteiro pela API RemoteDesktop do Mutter: notch desenhado nos dois monitores, hover abre e fecha com a janela acompanhando o tamanho, arrasto de 100px move 100px, engrenagem abre Configurações, ícone da bandeja visível. Falta: reiniciar a sessão para carregar a extensão nova e confirmar que o notch sai do dock.

Passos 1–5 feitos. O usuário instala a extensão e roda o roteiro no Ubuntu (passo 6); registrar resultados e falhas aqui.
