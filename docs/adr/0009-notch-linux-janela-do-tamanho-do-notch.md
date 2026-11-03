# 0009. Notch no Linux: janela do tamanho do notch e saída do dock pela extensão

- Status: Aceito
- Data: 2026-11-03

## Contexto

No teste manual do protótipo Linux (Electron em Wayland nativo + extensão `ai-notch-helper@guepardosys`) apareceram: uma janela transparente de 460×640 que recebia cliques na área vazia ("janela fantasma"), porque `setShape` e `setIgnoreMouseEvents` não funcionam em Wayland; o widget no dock como janela comum, porque `skipTaskbar` é ignorado em Wayland; e a bandeja quase invisível, por causa do ícone escuro.

Tentamos forçar X11 (XWayland), onde esses recursos funcionam. Nesta máquina o sandbox do processo da GPU do Chromium nega acesso a `/usr/lib/x86_64-linux-gnu/gbm/dri_gbm.so`, a GPU morre (`exit_code=139`) e o Electron cai para renderização por software. Em Wayland isso funciona; em X11 nenhuma janela é desenhada. Por isso X11 foi descartado.

## Decisão

- No Linux a janela do notch tem o tamanho do notch (mais 10px de cada lado para as orelhas, no eixo da borda). O renderer informa o tamanho; ele cresce na hora e encolhe só depois da transição de 0,45 s. No Windows nada muda (janela fixa e `setIgnoreMouseEvents`).
- A extensão `ai-notch-helper` filtra `Shell.AppSystem.get_running()` e tira da lista o app cujas janelas são todas `ai-notch:*`. A janela de Configurações continua aparecendo no dock.
- O arrasto no Linux mede a distância entre o ponteiro e o ponto agarrado, dentro da janela, e envia no máximo um movimento a cada 100 ms. Somar deltas de `screenX` fazia o notch disparar, porque o Chromium já considera a posição nova antes de a extensão mover a janela.
- A bandeja no Linux usa `assets/tray-linux.png`.

## Alternativas

- X11/XWayland: descartada (GPU falha nesta máquina).
- Manter a janela grande e recortar a entrada: impossível em Wayland.

## Consequências

- O filtro do dock mexe no protótipo de uma classe do GNOME Shell, que o próprio dock também altera. Por isso o `disable()` só desliga o filtro, sem restaurar o método original.
- A extensão só é recarregada ao reiniciar a sessão (Wayland).
- Sem sombra no painel aberto no Linux, porque a janela a cortaria.
