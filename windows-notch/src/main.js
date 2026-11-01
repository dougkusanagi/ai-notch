const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, nativeTheme, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fetchAll, demo, backoffMs } = require('./usage');

const demoArg = process.argv.find(a => a.startsWith('--demo'));
const DEMO = demoArg ? Number(demoArg.split('=')[1] ?? 1) : 0;
// Área máxima (painel aberto). O resto é transparente e deixa o mouse passar.
const W = 460, H = 640;
const EXPANDED_W = 396; // largura do painel aberto + margem, usada para limitar o arrasto
const REFRESH_MS = 5 * 60e3;
const THEMES = ['light', 'dark', 'system'];
const EDGES = ['top', 'bottom', 'left', 'right'];
const wins = new Map(); // id do monitor -> janela
let tray, timer, settingsWin, last = null, failures = 0, backoffUntil = 0;

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
// displays: null = só o principal; [] = oculto. edges: posição por monitor (padrão: edge).
const DEFAULTS = { theme: 'system', displays: null, edge: 'top', edges: {}, locked: false, offsets: {} };
let prefsCache = null;
function loadPrefs() {
  if (prefsCache) return prefsCache;
  try { prefsCache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; }
  catch { prefsCache = { ...DEFAULTS }; }
  if (!EDGES.includes(prefsCache.edge)) prefsCache.edge = 'top';
  return prefsCache;
}
function savePrefs(p) {
  prefsCache = p;
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(p));
}

const isSide = edge => edge === 'left' || edge === 'right';
const edgeOf = id => { const e = loadPrefs().edges?.[id]; return EDGES.includes(e) ? e : loadPrefs().edge; };
// Chave do deslocamento: eixo horizontal (topo/base) ou vertical (laterais), por monitor.
const offsetKey = (edge, id) => `${isSide(edge) ? 'v' : 'h'}:${id}`;
// O renderer de cada janela recebe a posição do próprio monitor.
const viewPrefs = id => ({ ...loadPrefs(), edge: edgeOf(id) });

// Monitores marcados. Nenhum marcado = notch oculto. Se os marcados sumirem (cabo
// removido), volta para o principal em vez de sumir sem explicação.
function selectedIds() {
  const all = screen.getAllDisplays(), { displays } = loadPrefs();
  if (displays === null) return [screen.getPrimaryDisplay().id];
  if (displays.length === 0) return [];
  const present = all.filter(d => displays.includes(d.id)).map(d => d.id);
  return present.length ? present : [screen.getPrimaryDisplay().id];
}

// O deslocamento nunca deixa o painel aberto sair do monitor.
function clampOffset(display, edge, px) {
  const { bounds, workArea } = display;
  const max = Math.max(0, isSide(edge) ? (workArea.height - Math.min(H, workArea.height)) / 2 : (bounds.width - EXPANDED_W) / 2);
  return Math.max(-max, Math.min(max, Math.round(px || 0)));
}

// Topo encosta na borda da tela. Base e laterais respeitam a área útil, ou seja,
// ficam acima/ao lado da barra de tarefas em vez de cobri-la.
function place(win, display, offsets = loadPrefs().offsets) {
  const edge = edgeOf(display.id), b = display.bounds, wa = display.workArea;
  const off = clampOffset(display, edge, offsets[offsetKey(edge, display.id)]);
  const w = Math.min(W, wa.width), h = Math.min(H, wa.height);
  const cx = Math.round(b.x + (b.width - w) / 2), cy = Math.round(wa.y + (wa.height - h) / 2);
  const pos = {
    top: { x: cx + off, y: b.y }, bottom: { x: cx + off, y: wa.y + wa.height - h },
    left: { x: wa.x, y: cy + off }, right: { x: wa.x + wa.width - w, y: cy + off },
  }[edge];
  win.setBounds({ ...pos, width: w, height: h });
}

function createWindow(display) {
  const win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.displayId = display.id;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  place(win, display);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); if (last) win.webContents.send('usage', last); });
  win.on('closed', () => { if (wins.get(display.id) === win) wins.delete(display.id); });
  wins.set(display.id, win);
}

const broadcast = (ch, v) => { for (const w of wins.values()) if (!w.isDestroyed()) w.webContents.send(ch, v); };
const winOf = e => BrowserWindow.fromWebContents(e.sender);

// Cria, remove e reposiciona as janelas para combinar com a seleção de monitores.
function syncWindows() {
  const ids = selectedIds();
  for (const [id, w] of wins) if (!ids.includes(id)) { wins.delete(id); w.destroy(); }
  for (const d of screen.getAllDisplays().filter(d => ids.includes(d.id))) {
    const w = wins.get(d.id);
    if (w) place(w, d); else createWindow(d);
  }
  for (const [id, w] of wins) w.webContents.send('prefs', viewPrefs(id));
}

// Durante o arrasto o deslocamento fica em memória; só é gravado ao soltar.
const dragOffsets = new Map();
function moveBy(win, dx) {
  if (loadPrefs().locked) return;
  const display = screen.getAllDisplays().find(d => d.id === win.displayId);
  if (!display) return;
  const edge = edgeOf(display.id), key = offsetKey(edge, display.id);
  const next = clampOffset(display, edge, (dragOffsets.get(key) ?? loadPrefs().offsets[key] ?? 0) + dx);
  dragOffsets.set(key, next);
  place(win, display, { [key]: next });
}
function commitDrag() {
  if (!dragOffsets.size) return;
  const prefs = loadPrefs();
  savePrefs({ ...prefs, offsets: { ...prefs.offsets, ...Object.fromEntries(dragOffsets) } });
  dragOffsets.clear();
}

async function refresh(force) {
  if (!wins.size && force !== true) return;
  // Depois de um 429, nem a atualização manual consulta antes do prazo.
  if (!DEMO && last && Date.now() < backoffUntil) { broadcast('usage', last); return; }
  broadcast('loading', true);
  try {
    const accounts = DEMO ? demo(DEMO) : await fetchAll(undefined, last?.accounts);
    const limited = accounts.filter(a => a.retryAfterMs !== undefined);
    failures = limited.length ? failures + 1 : 0;
    backoffUntil = limited.length ? Date.now() + backoffMs(failures, Math.max(...limited.map(a => a.retryAfterMs))) : 0;
    last = { at: Date.now(), accounts, retryAt: backoffUntil || null };
  } catch (e) {
    console.error('Falha ao atualizar:', e.message);
  } finally {
    if (last) broadcast('usage', last);
    broadcast('loading', false);
  }
}

function setPref(patch) {
  const hidden = !wins.size;
  savePrefs({ ...loadPrefs(), ...patch });
  syncWindows();
  if (hidden && wins.size) refresh();
}

// ---- Tela de configuração de monitores e posição ----
function monitorsState() {
  const chosen = selectedIds(), primary = screen.getPrimaryDisplay().id;
  const all = screen.getAllDisplays().slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return {
    locked: loadPrefs().locked,
    monitors: all.map((d, i) => ({
      id: d.id, index: i + 1, primary: d.id === primary, width: d.size.width, height: d.size.height,
      show: chosen.includes(d.id), edge: edgeOf(d.id),
    })),
  };
}

function applySetting(s) {
  const prefs = loadPrefs();
  if (typeof s.locked === 'boolean') return setPref({ locked: s.locked });
  const id = Number(s.id);
  if (!screen.getAllDisplays().some(d => d.id === id)) return;
  if (typeof s.show === 'boolean') {
    const chosen = selectedIds();
    setPref({ displays: s.show ? [...new Set([...chosen, id])] : chosen.filter(x => x !== id) });
  }
  if (EDGES.includes(s.edge)) setPref({ edges: { ...prefs.edges, [id]: s.edge } });
  if (s.center) {
    const offsets = { ...loadPrefs().offsets };
    delete offsets[offsetKey('top', id)]; delete offsets[offsetKey('left', id)];
    setPref({ offsets });
  }
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 620, height: 460, minWidth: 460, minHeight: 360, title: 'AI Quota Notch · Monitores e posição',
    autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

const menuTemplate = () => [
  { label: 'Atualizar agora', click: () => refresh(true) },
  { label: 'Monitores e posição…', click: openSettings },
  // Zera o deslocamento nos dois eixos, então vale para topo, base e laterais.
  { label: 'Centralizar no monitor', click: () => setPref({ offsets: {} }) },
  { label: 'Fixar posição', type: 'checkbox', checked: loadPrefs().locked, click: item => setPref({ locked: item.checked }) },
  { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
    click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
  { type: 'separator' },
  { label: 'Sair', click: () => app.quit() },
];

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => refresh(true));
  app.whenReady().then(start);
}

function start() {
  nativeTheme.themeSource = loadPrefs().theme;
  syncWindows();
  refresh();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, syncWindows);
  timer = setInterval(refresh, REFRESH_MS);
  // O Windows pode trazer a barra de tarefas para a frente das janelas fixas; reafirma o topo.
  keepOnTop = setInterval(() => { for (const w of wins.values()) if (!w.isDestroyed()) w.moveTop(); }, 3000);
  // Depois de suspender ou desbloquear, a rede pode demorar um pouco a voltar.
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(refresh, 5000));

  // A bandeja é o plano B caso o notch fique escondido ou oculto.
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('AI Quota Notch');
  tray.on('click', () => {
    // Oculto em todos os monitores: o clique traz o notch de volta no principal.
    if (!wins.size) setPref({ displays: null }); else for (const w of wins.values()) w.showInactive();
    refresh(true);
  });
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate())));

  ipcMain.on('interactive', (e, on) => winOf(e)?.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('drag', (e, dx) => { const w = winOf(e); if (w && Number.isFinite(dx)) moveBy(w, dx); });
  ipcMain.on('drag-end', commitDrag);
  ipcMain.on('center', e => {
    const w = winOf(e);
    if (w && !loadPrefs().locked) applySetting({ id: w.displayId, center: true });
  });
  ipcMain.on('refresh', () => refresh());
  ipcMain.handle('prefs', e => viewPrefs(winOf(e)?.displayId));
  ipcMain.on('theme', (_e, theme) => {
    if (!THEMES.includes(theme)) return;
    nativeTheme.themeSource = theme;
    savePrefs({ ...loadPrefs(), theme });
  });
  // Enquanto o menu nativo está aberto, o notch fica expandido mesmo com o mouse fora dele.
  ipcMain.on('menu', e => {
    const w = winOf(e);
    w?.webContents.send('pin', true);
    Menu.buildFromTemplate(menuTemplate()).popup({ window: w, callback: () => { if (!w.isDestroyed()) w.webContents.send('pin', false); } });
  });
  ipcMain.handle('settings:get', () => monitorsState());
  ipcMain.handle('settings:set', (_e, s) => { applySetting(s ?? {}); return monitorsState(); });
}

let keepOnTop;
app.on('before-quit', () => { clearInterval(timer); clearInterval(keepOnTop); });
