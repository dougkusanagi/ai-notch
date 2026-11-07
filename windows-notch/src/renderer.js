const $ = (s, el = document) => el.querySelector(s);
const api = window.notch;
const notchEl = $('#notch');
const PROVIDERS = { claude: { name: 'Claude', icon: '#i-claude', cls: 'logo claude' }, codex: { name: 'Codex', icon: '#i-openai', cls: 'logo' } };
const SVG = 'http://www.w3.org/2000/svg';
let data = null, closeTimer = null;
let view = { resetFormat: '24h', coloredBars: true };

// Verde, âmbar e vermelho conforme o que resta; com "Barras coloridas" desligado, usa a cor do texto.
const color = r => !view.coloredBars ? 'var(--fg)' : r > 40 ? 'var(--ok)' : r > 15 ? 'var(--warn)' : 'var(--bad)';
const mainWindow = a => a.ok ? a.windows.find(w => w.minutes === 300) ?? a.windows[0] : null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// Anel de progresso; com várias contas, as iniciais ficam no centro.
function ring(account, withInitials) {
  const wrap = el('span', withInitials ? 'ring big' : 'ring');
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  for (const cls of ['track', 'val']) {
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', 10); c.setAttribute('cy', 10); c.setAttribute('r', 8);
    c.setAttribute('pathLength', 100); c.setAttribute('class', cls);
    svg.append(c);
  }
  const w = mainWindow(account);
  const val = svg.lastChild;
  val.style.strokeDashoffset = w ? 100 - w.remaining : 100;
  if (w) val.style.stroke = color(w.remaining);
  wrap.append(svg);
  if (withInitials) {
    const i = el('i', null, account.ok ? account.initials : '!');
    if (account.ok && account.color) i.style.color = account.color;
    wrap.append(i);
  }
  return wrap;
}

function relTime(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60e3));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.round(m / 1440)} dias`;
}
function ageText(ms) {
  const m = Math.floor((Date.now() - ms) / 60e3);
  return m < 1 ? 'agora há pouco' : m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h`;
}
function resetText(w) {
  if (!w.reset) return w.minutes === 300 ? 'sem uso' : '—';
  if (w.reset <= Date.now()) return 'agora';
  if (view.resetFormat === 'relative') return relTime(w.reset);
  const d = new Date(w.reset), hour12 = view.resetFormat === '12h';
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12 });
  return d.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12 }).replace('.', '');
}
function resetTitle(w) {
  if (!w.reset) return w.minutes === 300 ? 'Janela sem uso: começa na próxima mensagem' : 'Renovação não informada';
  return `Renova em ${relTime(w.reset)} (${new Date(w.reset).toLocaleString('pt-BR')})`;
}

function label(a) {
  const w = mainWindow(a);
  return `${PROVIDERS[a.provider].name} ${a.name}: ${a.ok ? `${Math.round(w.remaining)}% restante${a.stale ? ' (desatualizado)' : ''}` : a.error}`;
}

function renderCompact(byProv) {
  for (const p of Object.keys(PROVIDERS)) {
    const list = byProv[p];
    const items = $(`.group[data-p="${p}"] .items`);
    const multi = list.length > 1;
    items.replaceChildren(...list.map(a => {
      const chip = el('span', a.ok && !a.stale ? 'chip' : 'chip err');
      chip.title = label(a);
      chip.append(ring(a, multi));
      if (!multi) {
        const w = mainWindow(a);
        chip.append(el('b', null, w ? `${a.stale ? '!' : ''}${Math.round(w.remaining)}%` : '--'));
      }
      return chip;
    }));
    $(`.group[data-p="${p}"]`).hidden = !list.length;
  }
}

function windowRow(w) {
  const r = Math.round(w.remaining);
  const row = el('div', 'row');
  const bar = el('div', 'bar');
  const fill = el('i');
  fill.style.width = `${r}%`; fill.style.background = color(r);
  bar.append(fill);
  const reset = el('span', 'reset', resetText(w));
  row.title = resetTitle(w);
  row.append(el('span', 'lbl', w.minutes === 300 ? '5h' : w.minutes === 10080 ? 'Semana' : w.label), bar, el('span', 'pct', `${r}%`), reset);
  return row;
}

function renderPanel(byProv) {
  const body = $('#body');
  body.replaceChildren();
  for (const [p, info] of Object.entries(PROVIDERS)) {
    const list = byProv[p];
    if (!list.length) continue;
    const multi = list.length > 1;
    const sec = el('section', 'prov');
    const head = el('header');
    const logo = document.createElementNS(SVG, 'svg');
    logo.setAttribute('class', info.cls);
    const use = document.createElementNS(SVG, 'use');
    use.setAttribute('href', info.icon);
    logo.append(use);
    head.append(logo, el('h2', null, info.name));
    if (!multi && list[0].plan) head.append(el('span', 'plan', list[0].plan));
    sec.append(head);
    for (const a of list) {
      const acc = el('div', 'account');
      if (multi) {
        const ah = el('div', 'acc-head');
        const badge = el('span', 'badge', a.initials);
        if (a.color) { badge.style.background = a.color; badge.style.color = '#fff'; }
        ah.append(badge, el('span', 'acc-name', a.name));
        if (a.plan) ah.append(el('span', 'plan', a.plan));
        acc.append(ah);
      }
      if (a.ok && a.stale) acc.append(el('p', 'error stale', `Dados desatualizados: ${a.error}`));
      if (a.resetMsg?.sending) acc.append(el('p', 'error', 'Enviando a mensagem após o reset…'));
      else if (a.resetMsg?.ok === false) acc.append(el('p', 'error stale', `Mensagem após o reset não enviada: ${a.resetMsg.error}`));
      if (a.ok) for (const w of a.windows) acc.append(windowRow(w));
      else acc.append(el('p', 'error', a.error));
      sec.append(acc);
    }
    body.append(sec);
  }
  if (!body.children.length) body.append(el('p', 'error', 'Nenhuma conta para mostrar. Adicione ou mostre uma conta em Configurações (⋯ > Configurações e contas).'));
}

function render() {
  if (!data) return;
  const byProv = { claude: [], codex: [] };
  for (const a of data.accounts) byProv[a.provider]?.push(a);
  renderCompact(byProv);
  renderPanel(byProv);
  const hm = ms => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  // Idade do dado mais antigo: cada serviço atualiza no seu ritmo.
  const times = data.accounts.filter(a => a.ok && a.fetchedAt).map(a => a.fetchedAt);
  const oldest = times.length ? Math.min(...times) : data.at;
  const perProvider = Object.entries(PROVIDERS).map(([p, info]) => {
    const t = data.accounts.filter(a => a.provider === p && a.ok && a.fetchedAt).map(a => a.fetchedAt);
    return t.length ? `${info.name}: ${hm(Math.max(...t))}` : null;
  }).filter(Boolean).join(' · ');
  const retry = data.retryAt && data.retryAt > Date.now() ? ` · nova tentativa às ${hm(data.retryAt)}` : '';
  $('#updated').textContent = `Atualizado ${ageText(oldest)} · % restante${retry}`;
  $('#updated').title = perProvider ? `Última consulta — ${perProvider}` : '';
  fit();
}

// O notch acompanha o tamanho do conteúdo, fechado ou aberto.
// Nas laterais o notch fechado é uma pílula vertical de 30px de largura.
let edge = 'top';
const sideways = () => edge === 'left' || edge === 'right';
function fit() {
  const open = notchEl.classList.contains('open');
  const panel = $('#panel'), compact = $('#compact');
  const w = open ? panel.offsetWidth : sideways() ? 30 : compact.offsetWidth;
  const h = open ? panel.offsetHeight : sideways() ? compact.offsetHeight : 30;
  notchEl.style.width = `${w}px`;
  notchEl.style.height = `${h}px`;
  if (api.platform === 'linux') reportSize(w, h);
}

// Linux: a janela acompanha o tamanho do notch. Cresce na hora (a animação precisa de espaço)
// e só encolhe depois que a transição de .45s termina.
let sent = { w: 0, h: 0 }, shrinkTimer = null;
function reportSize(w, h) {
  clearTimeout(shrinkTimer);
  const send = (sw, sh) => { sent = { w: sw, h: sh }; api.notchSize({ width: sw, height: sh }); };
  const gw = Math.max(w, sent.w), gh = Math.max(h, sent.h);
  if (gw !== sent.w || gh !== sent.h) send(gw, gh);
  if (gw !== w || gh !== h) shrinkTimer = setTimeout(() => send(w, h), 520);
}
function applyPrefs(p) {
  view = { resetFormat: p.resetFormat || '24h', coloredBars: p.coloredBars !== false };
  setThemeUI(p.theme);
  render();
  edge = p.edge || 'top';
  document.body.dataset.edge = edge;
  document.body.dataset.locked = String(!!p.locked);
  fit();
}

// Com o menu nativo aberto o notch fica expandido, mesmo com o mouse sobre o menu.
let pinned = false, hovering = false;
function open() {
  clearTimeout(closeTimer);
  api.interactive(true);
  if (!notchEl.classList.contains('open')) api.opened(); // o painel só consulta se o dado está velho
  notchEl.classList.add('open');
  fit();
}
function close() {
  closeTimer = setTimeout(() => {
    if (pinned) return;
    notchEl.classList.remove('open');
    fit();
    api.interactive(false);
  }, 220);
}
notchEl.addEventListener('mouseenter', () => { hovering = true; open(); });
notchEl.addEventListener('mouseleave', () => { hovering = false; close(); });
api.onPin(on => { pinned = on; if (on) open(); else if (!hovering) close(); });

// Arrastar ao longo da borda (horizontal no topo/base, vertical nas laterais) move o notch; duplo clique volta ao centro.
// Botões do painel não iniciam o arrasto.
// Windows: screenX é confiável, porque a janela muda de lugar na hora.
// Linux/Wayland: quem move a janela é a extensão, com atraso, e o Chromium já considera a
// posição nova; somar deltas de screenX realimenta o erro e o notch dispara. Lá a medida é
// a distância entre o ponteiro e o ponto agarrado, dentro da própria janela, com no máximo
// um movimento a cada 100 ms para a extensão aplicar o anterior.
const LINUX_DRAG = api.platform === 'linux', DRAG_EVERY_MS = 100;
let dragX = null, dragged = false, lastDragAt = 0;
const pos = e => LINUX_DRAG ? (sideways() ? e.clientY : e.clientX) : (sideways() ? e.screenY : e.screenX);
notchEl.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button') || document.body.dataset.locked === 'true') return;
  dragX = pos(e); dragged = false; lastDragAt = 0;
  notchEl.setPointerCapture(e.pointerId);
});
notchEl.addEventListener('pointermove', e => {
  if (dragX === null) return;
  const dx = pos(e) - dragX;
  if (!dragged && Math.abs(dx) < 3) return;
  dragged = true;
  notchEl.classList.add('dragging');
  if (LINUX_DRAG) {
    if (performance.now() - lastDragAt < DRAG_EVERY_MS) return;
    lastDragAt = performance.now();
  } else dragX = pos(e);
  api.drag(dx);
});
const endDrag = () => {
  if (dragX === null) return;
  dragX = null; notchEl.classList.remove('dragging');
  if (dragged) api.dragEnd();
};
notchEl.addEventListener('pointerup', endDrag);
notchEl.addEventListener('pointercancel', endDrag);
notchEl.addEventListener('dblclick', e => {
  if (!e.target.closest('button') && document.body.dataset.locked !== 'true') api.center();
});

document.body.dataset.platform = api.platform;
api.onUsage(d => { data = d; render(); });
api.onLoading(on => {
  $('#pulse').classList.toggle('busy', on);
  $('#refresh').classList.toggle('spin', on);
});
$('#refresh').addEventListener('click', () => api.refresh());
$('#settings').addEventListener('click', () => api.openSettings());
$('#more').addEventListener('click', () => api.menu());

function setThemeUI(t) {
  for (const b of document.querySelectorAll('.theme button')) b.setAttribute('aria-checked', String(b.dataset.t === t));
}
for (const b of document.querySelectorAll('.theme button')) {
  b.addEventListener('click', () => { setThemeUI(b.dataset.t); api.setTheme(b.dataset.t); });
}
api.prefs().then(applyPrefs);
api.onPrefs(applyPrefs);
// Botão direito abre o mesmo menu da bandeja.
notchEl.addEventListener('contextmenu', e => { e.preventDefault(); api.menu(); });
fit();

setInterval(render, 30e3); // mantém os horários atuais
