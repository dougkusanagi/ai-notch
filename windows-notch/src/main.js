const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, dialog, clipboard, nativeTheme, powerMonitor } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fetchAll, demo, backoffMs, discoverProfiles, loginCommand } = require('./usage');
const { buildLayout, titleFor, writeLayout } = require('./linux-layout');
const linuxDesktop = require('./linux-desktop');

const LINUX = process.platform === 'linux';
// Wayland nativo no Linux; a extensão ai-notch-helper posiciona a janela e a tira do dock.
// X11 não serve: nesta máquina o processo da GPU morre (exit 139) e nada é desenhado.
if (LINUX) {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  // No Wayland o app_id vem do nome do .desktop; assim o GNOME liga a janela ao atalho.
  app.setDesktopName(linuxDesktop.DESKTOP_FILE);
}

// Comando que reabre o app. APPIMAGE só vale empacotado: em desenvolvimento a variável
// pode vir herdada de outro AppImage (ex.: o terminal do T3 Code) e apontaria para ele.
const launchCommand = () => !app.isPackaged ? [process.execPath, app.getAppPath()]
  : process.env.APPIMAGE ? [process.env.APPIMAGE] : [process.execPath];
const startsWithSystem = () => LINUX ? linuxDesktop.autostartEnabled() : app.getLoginItemSettings().openAtLogin;
function setStartsWithSystem(on) {
  if (!LINUX) return app.setLoginItemSettings({ openAtLogin: on });
  try { linuxDesktop.setAutostart(on, launchCommand()); }
  catch (e) { console.error('Falha ao configurar o início com o sistema:', e.message); }
}

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
const DEFAULTS = { theme: 'system', displays: null, edge: 'top', edges: {}, locked: false, offsets: {}, custom: [], overrides: {} };
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
  const { w, h } = windowSize(win, edge, wa);
  // Centro do notch no eixo da borda: meio do monitor (topo/base) ou da área útil (laterais), mais o deslocamento.
  const cx = Math.round(b.x + b.width / 2 - w / 2) + off, cy = Math.round(wa.y + wa.height / 2 - h / 2) + off;
  const pos = {
    top: { x: cx, y: b.y }, bottom: { x: cx, y: wa.y + wa.height - h },
    left: { x: wa.x, y: cy }, right: { x: wa.x + wa.width - w, y: cy },
  }[edge];
  win.setBounds({ ...pos, width: w, height: h });
  win.layoutBounds = { id: display.id, ...pos, width: w, height: h };
  publishLayout();
}

// Windows: janela fixa de W×H e o mouse atravessa a parte transparente (setIgnoreMouseEvents).
// Linux/Wayland não tem essa opção, então a janela tem o tamanho do notch, mais as duas
// orelhas (cantos côncavos, 10px cada) no eixo da borda. Assim não sobra "janela fantasma".
const EAR = 10;
function windowSize(win, edge, wa) {
  if (!LINUX) return { w: Math.min(W, wa.width), h: Math.min(H, wa.height) };
  const c = win.contentSize ?? { width: 200, height: 30 };
  const side = isSide(edge);
  return { w: Math.min(W, wa.width, Math.ceil(c.width) + (side ? 0 : 2 * EAR)), h: Math.min(H, wa.height, Math.ceil(c.height) + (side ? 2 * EAR : 0)) };
}

// Linux: informa à extensão onde cada janela deve ficar.
function publishLayout() {
  if (!LINUX) return;
  try { writeLayout(buildLayout([...wins.values()].filter(w => !w.isDestroyed() && w.layoutBounds).map(w => w.layoutBounds))); }
  catch (e) { console.error('Falha ao gravar o layout:', e.message); }
}

function createWindow(display) {
  const win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, resizable: LINUX, // Linux: a janela muda de tamanho com o notch
    movable: false,
    title: titleFor(display.id), skipTaskbar: true, alwaysOnTop: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.displayId = display.id;
  win.on('page-title-updated', e => e.preventDefault()); // a extensão acha a janela pelo título
  win.setAlwaysOnTop(true, 'screen-saver');
  if (!LINUX) win.setIgnoreMouseEvents(true, { forward: true });
  place(win, display);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); if (last) win.webContents.send('usage', last); });
  win.on('closed', () => { if (wins.get(display.id) === win) wins.delete(display.id); publishLayout(); });
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
  publishLayout();
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
    const accounts = DEMO ? demo(DEMO) : await fetchAll(undefined, last?.accounts, accountConfig());
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
  updateTrayMenu();
  if (hidden && wins.size) refresh();
}

// ---- Contas: nome, iniciais, visibilidade e pastas de perfil adicionadas à mão ----
const accountConfig = () => { const p = loadPrefs(); return { custom: p.custom ?? [], overrides: p.overrides ?? {}, removed: p.removed ?? [], order: p.order ?? [] }; };
const PROVIDER_IDS = ['claude', 'codex'];

async function accountsState() {
  const accounts = (await discoverProfiles(undefined, accountConfig())).map(({ provider, dir, name, initials, hidden, custom, loggedIn }) =>
    ({ provider, dir, name, initials, hidden, custom, loggedIn, login: loginCommand(provider, dir) }));
  return { accounts, removed: (loadPrefs().removed ?? []).length };
}

async function applyAccount(a) {
  const prefs = loadPrefs();
  const custom = [...(prefs.custom ?? [])], overrides = { ...(prefs.overrides ?? {}) };
  let removed = [...(prefs.removed ?? [])], order = [...(prefs.order ?? [])];
  if (a.restore) removed = [];
  else {
    // Aceita ~ no começo, como no terminal.
    const raw = typeof a?.dir === 'string' ? a.dir.trim().replace(/^~(?=$|[\\/])/, require('node:os').homedir()) : '';
    const dir = raw ? path.resolve(raw) : '';
    if (!dir) throw new Error('Informe a pasta do perfil.');
    if (a.add) {
      if (!PROVIDER_IDS.includes(a.provider) || !path.isAbsolute(raw)) throw new Error('Use o caminho completo da pasta, por exemplo ~/.claude-trabalho.');
      if (fs.statSync(dir, { throwIfNoEntry: false })?.isFile()) throw new Error('Esse caminho é um arquivo. Escolha uma pasta.');
      const known = (await discoverProfiles(undefined, { ...accountConfig(), removed: [] })).some(p => p.dir === dir);
      if (known && !removed.includes(dir)) throw new Error('Essa pasta já está na lista.');
      removed = removed.filter(d => d !== dir);
      if (!known) custom.push({ provider: a.provider, dir });
    } else if (a.remove) {
      const i = custom.findIndex(c => c.dir === dir);
      // Pastas encontradas sozinhas voltariam na próxima busca; ficam marcadas como removidas.
      if (i >= 0) custom.splice(i, 1); else if (!removed.includes(dir)) removed.push(dir);
      delete overrides[dir];
      order = order.filter(d => d !== dir);
    } else if (a.move) {
      // Move só entre as contas do mesmo serviço, que é como o notch as agrupa.
      const all = await discoverProfiles(undefined, accountConfig());
      const provider = all.find(p => p.dir === dir)?.provider;
      const same = all.filter(p => p.provider === provider).map(p => p.dir);
      const from = same.indexOf(dir), to = from + Math.sign(a.move);
      if (from < 0 || to < 0 || to >= same.length) return;
      [same[from], same[to]] = [same[to], same[from]];
      order = all.map(p => p.provider === provider ? same.shift() : p.dir);
    } else {
      const o = { ...overrides[dir] };
      if (typeof a.name === 'string') { const n = a.name.trim().slice(0, 40); if (n) o.name = n; else delete o.name; }
      if (typeof a.initials === 'string') { const i = a.initials.trim().slice(0, 3).toUpperCase(); if (i) o.initials = i; else delete o.initials; }
      if (typeof a.hidden === 'boolean') o.hidden = a.hidden;
      if (Object.keys(o).length) overrides[dir] = o; else delete overrides[dir];
    }
  }
  savePrefs({ ...prefs, custom, overrides, removed, order });
  backoffUntil = 0;
  refresh(true);
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
    width: 640, height: 720, minWidth: 460, minHeight: 480, title: 'AI Quota Notch · Configurações', skipTaskbar: false,
    autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

const menuTemplate = () => [
  { label: 'Atualizar agora', click: () => refresh(true) },
  { label: 'Configurações…', click: openSettings },
  // Zera o deslocamento nos dois eixos, então vale para topo, base e laterais.
  { label: 'Centralizar no monitor', click: () => setPref({ offsets: {} }) },
  { label: 'Fixar posição', type: 'checkbox', checked: loadPrefs().locked, click: item => setPref({ locked: item.checked }) },
  { label: LINUX ? 'Iniciar com o sistema' : 'Iniciar com o Windows', type: 'checkbox', checked: startsWithSystem(),
    click: item => { setStartsWithSystem(item.checked); updateTrayMenu(); } },
  { type: 'separator' },
  { label: 'Sair', click: () => app.quit() },
];

function updateTrayMenu() {
  if (LINUX && tray) tray.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Abrir de novo pelo menu de aplicativos traz o notch de volta, como o clique na bandeja.
  app.on('second-instance', () => app.isReady() && showNotch());
  app.whenReady().then(start);
}

// Oculto em todos os monitores: traz o notch de volta no principal.
function showNotch() {
  if (!wins.size) setPref({ displays: null }); else for (const w of wins.values()) w.showInactive();
  refresh(true);
}

function start() {
  if (LINUX) {
    try { linuxDesktop.refreshAutostart(launchCommand()); }
    catch (e) { console.error('Falha ao atualizar o início com o sistema:', e.message); }
  }
  nativeTheme.themeSource = loadPrefs().theme;
  syncWindows();
  refresh();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, syncWindows);
  timer = setInterval(refresh, REFRESH_MS);
  // O Windows pode trazer a barra de tarefas para a frente das janelas fixas; reafirma o topo.
  if (!LINUX) keepOnTop = setInterval(() => { for (const w of wins.values()) if (!w.isDestroyed()) w.moveTop(); }, 3000);
  // Depois de suspender ou desbloquear, a rede pode demorar um pouco a voltar.
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(refresh, 5000));

  // A bandeja é o plano B caso o notch fique escondido ou oculto.
  // No Linux o fundo escuro do ícone some na barra do GNOME; lá vale a versão só com os anéis.
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', LINUX ? 'tray-linux.png' : 'icon.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('AI Quota Notch');
  tray.on('click', showNotch);
  if (LINUX) updateTrayMenu();
  else tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(menuTemplate())));

  ipcMain.on('interactive', (e, on) => {
    if (!LINUX) winOf(e)?.setIgnoreMouseEvents(!on, { forward: true });
  });
  ipcMain.on('notch-size', (e, size) => {
    if (!LINUX || !size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return;
    const win = winOf(e), display = screen.getAllDisplays().find(d => d.id === win?.displayId);
    if (!win || win.isDestroyed() || !display) return;
    win.contentSize = { width: Math.max(1, Math.min(W, size.width)), height: Math.max(1, Math.min(H, size.height)) };
    place(win, display);
  });
  ipcMain.on('drag', (e, dx) => { const w = winOf(e); if (w && Number.isFinite(dx)) moveBy(w, dx); });
  ipcMain.on('drag-end', commitDrag);
  ipcMain.on('center', e => {
    const w = winOf(e);
    if (w && !loadPrefs().locked) applySetting({ id: w.displayId, center: true });
  });
  ipcMain.on('refresh', () => refresh());
  ipcMain.on('open-settings', openSettings);
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
  ipcMain.handle('accounts:get', () => accountsState());
  ipcMain.on('accounts:copy', (_e, text) => { if (typeof text === 'string' && text.length < 4096) clipboard.writeText(text); });
  ipcMain.handle('accounts:pick', async () => {
    const r = await dialog.showOpenDialog(settingsWin, { title: 'Escolher a pasta do perfil', defaultPath: require('node:os').homedir(),
      buttonLabel: 'Usar esta pasta', properties: ['openDirectory', 'showHiddenFiles'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('accounts:set', async (_e, a) => {
    try { await applyAccount(a ?? {}); return accountsState(); }
    catch (e) { return { ...(await accountsState()), error: e.message }; }
  });
  ipcMain.handle('settings:set', (_e, s) => { applySetting(s ?? {}); return monitorsState(); });
}

let keepOnTop;
app.on('before-quit', () => { clearInterval(timer); clearInterval(keepOnTop); });
