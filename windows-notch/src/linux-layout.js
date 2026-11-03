// Canal app -> extensão GNOME: o Wayland não deixa o app posicionar a janela,
// então o app grava o layout e a extensão ai-notch-helper@guepardosys aplica.
const fs = require('node:fs');
const path = require('node:path');

const TITLE_PREFIX = 'ai-notch:';
const titleFor = id => `${TITLE_PREFIX}${id}`;

// wins: [{ id, x, y, width, height }] em coordenadas lógicas globais.
function buildLayout(wins) {
  return {
    version: 1,
    windows: wins.map(w => ({
      title: titleFor(w.id), x: Math.round(w.x), y: Math.round(w.y),
      width: Math.round(w.width), height: Math.round(w.height),
    })),
  };
}

function layoutDir(env = process.env) {
  return path.join(env.XDG_RUNTIME_DIR || `/tmp`, 'ai-notch');
}

// Escrita atômica: a extensão nunca lê um arquivo pela metade.
function writeLayout(layout, dir = layoutDir()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'layout.json'), tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(layout));
  fs.renameSync(tmp, file);
  return file;
}

module.exports = { TITLE_PREFIX, titleFor, buildLayout, layoutDir, writeLayout };
