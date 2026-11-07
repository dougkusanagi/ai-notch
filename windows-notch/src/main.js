const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, nativeTheme, powerMonitor, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { fetchAll, demo, discoverProfiles } = require('./usage');
const { buildLayout, titleFor, writeLayout } = require('./linux-layout');
const linuxDesktop = require('./linux-desktop');
const accountsLib = require('./accounts');
const { shouldSendResetMessage, sendResetMessage } = require('./reset-message');
const { POLICY, ACCOUNT_GAP_MS, newState, dueAt, canFetch, afterFetch, isStale } = require('./schedule');

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
const TICK_MS = 15e3;
const THEMES = ['light', 'dark', 'system'];
const EDGES = ['top', 'bottom', 'left', 'right'];
const wins = new Map(); // id do monitor -> janela
let tray, timer, settingsWin, last = null;

const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json');
// displays: null = só o principal; [] = oculto. edges: posição por monitor (padrão: edge).
// accounts: null = ainda não criadas (são geradas a partir dos perfis detectados na primeira execução).
const DEFAULTS = { theme: 'system', displays: null, edge: 'top', edges: {}, locked: false, offsets: {},
  accounts: null, resetFormat: '24h', coloredBars: true, resetAttempts: {} };
const RESET_FORMATS = ['24h', '12h', 'relative'];
let prefsCache = null;
function loadPrefs() {
  if (prefsCache) return prefsCache;
  try { prefsCache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) }; }
  catch { prefsCache = { ...DEFAULTS }; }
  if (!EDGES.includes(prefsCache.edge)) prefsCache.edge = 'top';
  if (!RESET_FORMATS.includes(prefsCache.resetFormat)) prefsCache.resetFormat = '24h';
  if (prefsCache.accounts !== null) prefsCache.accounts = accountsLib.cleanList(prefsCache.accounts);
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
  win.once('ready-to-show', () => { win.showInactive(); if (last) win.webContents.send('usage', view()); });
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

// Cada serviço tem o próprio ritmo e a própria espera (ver schedule.js).
const sched = Object.fromEntries(Object.keys(POLICY).map(p => [p, newState()]));
let refreshing = false;

// opts.manual: ignora o intervalo mínimo (nunca a espera de um 429).
// opts.always: consulta mesmo com o notch oculto. opts.only: lista de serviços.
async function refresh(opts = {}) {
  if (refreshing || (!wins.size && !opts.always)) return;
  const now = Date.now();
  const list = (opts.only ?? Object.keys(POLICY)).filter(p => canFetch(p, sched[p], now, opts.manual));
  if (!list.length) { if (last) broadcast('usage', view()); return; }
  refreshing = true;
  broadcast('loading', true);
  try {
    const all = DEMO ? demo(DEMO) : await fetchAll(undefined, last?.accounts, { providers: list, gapMs: ACCOUNT_GAP_MS, accounts: loadPrefs().accounts ?? undefined });
    const fresh = all.filter(a => list.includes(a.provider)), at = Date.now();
    for (const p of list) sched[p] = afterFetch(p, sched[p], fresh.filter(a => a.provider === p), at);
    const retry = Math.max(0, ...Object.values(sched).map(s => s.backoffUntil));
    last = { at, accounts: [...(last?.accounts ?? []).filter(a => !list.includes(a.provider)), ...fresh], retryAt: retry > at ? retry : null };
    if (!DEMO) autoResetMessages(fresh, at);
  } catch (e) {
    console.error('Falha ao atualizar:', e.message);
  } finally {
    refreshing = false;
    if (last) broadcast('usage', view());
    broadcast('loading', false);
  }
}

// Dados enviados ao notch: só contas cadastradas e visíveis, na ordem da lista, com nome, iniciais e cor atuais.
const msgStatus = new Map(); // id da conta -> resultado da última mensagem após reset
function view() {
  const cfg = loadPrefs().accounts;
  if (DEMO || !cfg) return last;
  const byId = new Map(cfg.map((a, i) => [a.id, { ...a, i }]));
  const accounts = last.accounts.filter(a => byId.get(a.id)?.visible).sort((a, b) => byId.get(a.id).i - byId.get(b.id).i)
    .map(a => { const c = byId.get(a.id); return { ...a, name: c.name, initials: c.initials, color: c.color, resetMsg: msgStatus.get(a.id) }; });
  return { ...last, accounts };
}

// Mensagem após o reset: só para contas com a opção ligada, com dado atual e janela de 5 h livre.
function autoResetMessages(fresh, now) {
  const cfg = new Map((loadPrefs().accounts ?? []).map(a => [a.id, a]));
  for (const a of fresh) {
    const acc = cfg.get(a.id);
    if (!acc?.autoResetMessage || !a.ok || a.stale) continue;
    if (!shouldSendResetMessage(a, loadPrefs().resetAttempts?.[a.id] ?? 0, now)) continue;
    savePrefs({ ...loadPrefs(), resetAttempts: { ...loadPrefs().resetAttempts, [a.id]: now } });
    msgStatus.set(a.id, { at: now, sending: true });
    sendResetMessage(acc)
      .then(() => msgStatus.set(a.id, { at: Date.now(), ok: true }), e => msgStatus.set(a.id, { at: Date.now(), ok: false, error: e.message }))
      .finally(() => {
        if (last) broadcast('usage', view());
        // A nova janela só aparece no serviço depois de alguns instantes.
        setTimeout(() => refresh({ only: [acc.provider], always: true }), 90e3);
      });
  }
}

// A cada 15 s vê quais serviços já estão na hora: intervalo, reset conhecido ou fim da espera.
function tick() {
  if (!wins.size || refreshing) return;
  const now = Date.now(), accounts = last?.accounts ?? [];
  const only = Object.keys(POLICY).filter(p => now >= dueAt(p, sched[p], accounts));
  if (only.length) refresh({ only });
}
function setPref(patch) {
  const hidden = !wins.size;
  savePrefs({ ...loadPrefs(), ...patch });
  syncWindows();
  updateTrayMenu();
  if (hidden && wins.size) refresh();
}

// ---- Contas ----
async function seedAccounts() {
  if (loadPrefs().accounts) return;
  savePrefs({ ...loadPrefs(), accounts: accountsLib.fromProfiles(await discoverProfiles()) });
}

// Grava a lista. Contas novas ou com outro serviço/diretório saem do cache e são consultadas na hora.
function setAccounts(list) {
  const prev = new Map((loadPrefs().accounts ?? []).map(a => [a.id, a]));
  savePrefs({ ...loadPrefs(), accounts: list });
  if (DEMO) return;
  const same = a => { const p = prev.get(a.id), n = list.find(x => x.id === a.id); return n?.visible && p && p.provider === n.provider && p.profilePath === n.profilePath; };
  if (last) last = { ...last, accounts: last.accounts.filter(same) };
  if (last) broadcast('usage', view());
  if (list.some(a => a.visible && !last?.accounts.some(x => x.id === a.id))) refresh({ manual: true, always: true });
}

function accountsDo(op) {
  const list = loadPrefs().accounts ?? [];
  if (op.type === 'put') setAccounts(accountsLib.put(list, op.account));
  else if (op.type === 'remove') setAccounts(accountsLib.remove(list, op.id));
  else if (op.type === 'move') setAccounts(accountsLib.move(list, op.id, op.offset < 0 ? -1 : 1));
  else if (op.type === 'visible') {
    const a = list.find(x => x.id === op.id);
    if (a) setAccounts(accountsLib.put(list, { ...a, visible: op.visible === true }));
  }
}

function applyTheme(theme) {
  if (!THEMES.includes(theme)) return;
  nativeTheme.themeSource = theme;
  savePrefs({ ...loadPrefs(), theme });
  for (const [id, w] of wins) w.webContents.send('prefs', viewPrefs(id));
}

// ---- Tela de configurações ----
function settingsState() {
  const p = loadPrefs();
  return {
    ...monitorsState(),
    prefs: { theme: p.theme, resetFormat: p.resetFormat, coloredBars: p.coloredBars, autoStart: startsWithSystem() },
    accounts: p.accounts ?? [],
    defaults: { prompt: accountsLib.DEFAULT_RESET_PROMPT, dirs: accountsLib.DEFAULT_DIR, palette: accountsLib.PALETTE },
  };
}

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
  if (s.theme) return applyTheme(s.theme);
  if (RESET_FORMATS.includes(s.resetFormat)) return setPref({ resetFormat: s.resetFormat });
  if (typeof s.coloredBars === 'boolean') return setPref({ coloredBars: s.coloredBars });
  if (typeof s.autoStart === 'boolean') { setStartsWithSystem(s.autoStart); updateTrayMenu(); return; }
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

function openSettings(tab = 'ajustes') {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); settingsWin.webContents.send('tab', tab); return; }
  settingsWin = new BrowserWindow({
    width: 700, height: 680, minWidth: 480, minHeight: 420, title: 'AI Quota Notch · Configurações', skipTaskbar: false,
    autoHideMenuBar: true, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'), { hash: tab });
  settingsWin.on('closed', () => { settingsWin = null; });
}

const menuTemplate = () => [
  { label: 'Atualizar agora', click: () => refresh({ manual: true, always: true }) },
  { label: 'Configurações e contas…', click: () => openSettings('ajustes') },
  { label: 'Monitores e posição…', click: () => openSettings('monitores') },
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
  refresh({ manual: true, always: true });
}

async function start() {
  if (LINUX) {
    try { linuxDesktop.refreshAutostart(launchCommand()); }
    catch (e) { console.error('Falha ao atualizar o início com o sistema:', e.message); }
  }
  await seedAccounts();
  nativeTheme.themeSource = loadPrefs().theme;
  syncWindows();
  refresh();
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, syncWindows);
  timer = setInterval(tick, TICK_MS);
  // O Windows pode trazer a barra de tarefas para a frente das janelas fixas; reafirma o topo.
  if (!LINUX) keepOnTop = setInterval(() => { for (const w of wins.values()) if (!w.isDestroyed()) w.moveTop(); }, 3000);
  // Depois de suspender ou desbloquear, a rede pode demorar um pouco a voltar.
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => setTimeout(() => refresh(), 5000));

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
  ipcMain.on('refresh', () => refresh({ manual: true }));
  ipcMain.on('open-settings', openSettings);
  // Ao abrir o painel, atualiza só os serviços com dado mais velho que STALE_MS.
  ipcMain.on('opened', () => refresh({ only: Object.keys(POLICY).filter(p => isStale(sched[p], Date.now())) }));
  ipcMain.handle('prefs', e => viewPrefs(winOf(e)?.displayId));
  ipcMain.on('theme', (_e, theme) => applyTheme(theme));
  // Enquanto o menu nativo está aberto, o notch fica expandido mesmo com o mouse fora dele.
  ipcMain.on('menu', e => {
    const w = winOf(e);
    w?.webContents.send('pin', true);
    Menu.buildFromTemplate(menuTemplate()).popup({ window: w, callback: () => { if (!w.isDestroyed()) w.webContents.send('pin', false); } });
  });
  ipcMain.handle('settings:get', () => settingsState());
  ipcMain.handle('settings:set', (_e, s) => { applySetting(s ?? {}); return settingsState(); });
  ipcMain.handle('accounts:do', (_e, op) => {
    if (op?.type === 'login') return { login: accountsLib.loginCommand(op.provider, op.dir) };
    try { accountsDo(op ?? {}); return settingsState(); } catch (e) { return { ...settingsState(), error: e.message }; }
  });
  ipcMain.handle('accounts:pick', async () => {
    const r = await dialog.showOpenDialog(settingsWin, { properties: ['openDirectory', 'createDirectory'], title: 'Escolher o diretório do perfil' });
    return r.canceled ? null : r.filePaths[0];
  });
}

let keepOnTop;
app.on('before-quit', () => { clearInterval(timer); clearInterval(keepOnTop); });
