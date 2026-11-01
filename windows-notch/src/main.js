const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, nativeTheme, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fetchAll, demo, backoffMs } = require('./usage');

const demoArg = process.argv.find(a => a.startsWith('--demo'));
const DEMO = demoArg ? Number(demoArg.split('=')[1] ?? 1) : 0;
// Área máxima (painel aberto). O resto é transparente e deixa o mouse passar.
const W = 460, H = 640;
const REFRESH_MS = 5 * 60e3;
const THEMES = ['light', 'dark', 'system'];
const wins = new Map(); // id do monitor -> janela
let tray, timer, last = null, failures = 0, backoffUntil = 0;

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
const DEFAULTS = { theme: 'system', display: 'primary', offsets: {} };
function loadPrefs() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function savePrefs(p) {
  fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
  fs.writeFileSync(prefsFile(), JSON.stringify(p));
}

// Monitores que mostram o notch: todos, um escolhido ou (padrão) o principal.
function targetDisplays() {
  const all = screen.getAllDisplays(), { display } = loadPrefs();
  if (display === 'all') return all;
  return [all.find(d => d.id === display) ?? screen.getPrimaryDisplay()];
}

// O deslocamento horizontal nunca deixa o notch sair do monitor.
function clampOffset(bounds, px) {
  const max = Math.max(0, bounds.width / 2 - 140);
  return Math.max(-max, Math.min(max, Math.round(px || 0)));
}

function place(win, display, offsets = loadPrefs().offsets) {
  const { bounds } = display;
  const offset = clampOffset(bounds, offsets[display.id]);
  win.setBounds({ x: Math.round(bounds.x + (bounds.width - W) / 2) + offset, y: bounds.y, width: W, height: H });
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

// Cria, remove e reposiciona as janelas para combinar com a escolha de monitor.
function syncWindows() {
  const targets = targetDisplays();
  for (const [id, w] of wins) if (!targets.some(d => d.id === id)) { wins.delete(id); w.destroy(); }
  for (const d of targets) {
    const w = wins.get(d.id);
    if (w) place(w, d); else createWindow(d);
  }
}

const broadcast = (ch, v) => { for (const w of wins.values()) if (!w.isDestroyed()) w.webContents.send(ch, v); };
const winOf = e => BrowserWindow.fromWebContents(e.sender);

// Durante o arrasto o deslocamento fica em memória; só é gravado ao soltar.
const dragOffsets = new Map();
function moveBy(win, dx) {
  const display = screen.getAllDisplays().find(d => d.id === win.displayId);
  if (!display) return;
  const cur = dragOffsets.get(win.displayId) ?? loadPrefs().offsets[win.displayId] ?? 0;
  const next = clampOffset(display.bounds, cur + dx);
  dragOffsets.set(win.displayId, next);
  place(win, display, { [display.id]: next });
}
function commitDrag(win) {
  if (!dragOffsets.has(win.displayId)) return;
  const prefs = loadPrefs();
  savePrefs({ ...prefs, offsets: { ...prefs.offsets, [win.displayId]: dragOffsets.get(win.displayId) } });
  dragOffsets.delete(win.displayId);
}

async function refresh() {
  if (!wins.size) return;
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
  savePrefs({ ...loadPrefs(), ...patch });
  syncWindows();
}

function monitorMenu() {
  const { display } = loadPrefs(), all = screen.getAllDisplays(), primary = screen.getPrimaryDisplay().id;
  const known = all.some(d => d.id === display);
  const item = (label, value, checked) => ({ label, type: 'radio', checked, click: () => setPref({ display: value }) });
  return [
    item('Monitor principal', 'primary', display === 'primary' || (display !== 'all' && !known)),
    ...all.map((d, i) => item(`Monitor ${i + 1}${d.id === primary ? ' (principal)' : ''} · ${d.size.width}×${d.size.height}`, d.id, display === d.id)),
    item('Todos os monitores', 'all', display === 'all'),
  ];
}

const menuTemplate = () => [
  { label: 'Atualizar agora', click: refresh },
  { label: 'Monitor', submenu: monitorMenu() },
  { label: 'Centralizar o notch', click: () => setPref({ offsets: {} }) },
  { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
    click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
  { type: 'separator' },
  { label: 'Sair', click: () => app.quit() },
];

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', refresh);
  app.whenReady().then(start);
}

function start() {
  nativeTheme.themeSource = loadPrefs().theme;
  syncWindows();
  refresh();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, syncWindows);
  timer = setInterval(refresh, REFRESH_MS);
  // Depois de suspender ou desbloquear, a rede pode demorar um pouco a voltar.
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(refresh, 5000));

  // A bandeja é o plano B caso o notch fique escondido atrás de algo.
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('AI Quota Notch');
  tray.on('click', () => { for (const w of wins.values()) w.showInactive(); refresh(); });
  tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate())));

  ipcMain.on('interactive', (e, on) => winOf(e)?.setIgnoreMouseEvents(!on, { forward: true }));
  ipcMain.on('drag', (e, dx) => { const w = winOf(e); if (w && Number.isFinite(dx)) moveBy(w, dx); });
  ipcMain.on('drag-end', e => { const w = winOf(e); if (w) commitDrag(w); });
  ipcMain.on('center', e => {
    const w = winOf(e);
    if (w) setPref({ offsets: { ...loadPrefs().offsets, [w.displayId]: 0 } });
  });
  ipcMain.on('refresh', refresh);
  ipcMain.handle('prefs', () => loadPrefs());
  ipcMain.on('theme', (_e, theme) => {
    if (!THEMES.includes(theme)) return;
    nativeTheme.themeSource = theme;
    savePrefs({ ...loadPrefs(), theme });
  });
  ipcMain.on('menu', e => Menu.buildFromTemplate(menuTemplate()).popup({ window: winOf(e) }));
}

app.on('before-quit', () => clearInterval(timer));
