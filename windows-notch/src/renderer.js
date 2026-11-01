const $ = (s, el = document) => el.querySelector(s);
const api = window.notch;
const notchEl = $('#notch');
const PROVIDERS = { claude: { name: 'Claude', icon: '#i-claude', cls: 'logo claude' }, codex: { name: 'Codex', icon: '#i-openai', cls: 'logo' } };
const SVG = 'http://www.w3.org/2000/svg';
let data = null, closeTimer = null;

const color = r => r > 40 ? 'var(--ok)' : r > 15 ? 'var(--warn)' : 'var(--bad)';
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
  if (withInitials) wrap.append(el('i', null, account.ok ? account.initials : '!'));
  return wrap;
}

function relTime(ms) {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60e3));
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.round(m / 1440)} dias`;
}
function resetText(w) {
  if (!w.reset) return w.minutes === 300 ? 'sem uso' : '—';
  if (w.reset <= Date.now()) return 'agora';
  const d = new Date(w.reset);
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
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
        ah.append(el('span', 'badge', a.initials), el('span', 'acc-name', a.name));
        if (a.plan) ah.append(el('span', 'plan', a.plan));
        acc.append(ah);
      }
      if (a.ok && a.stale) acc.append(el('p', 'error stale', `Dados desatualizados: ${a.error}`));
      if (a.ok) for (const w of a.windows) acc.append(windowRow(w));
      else acc.append(el('p', 'error', a.error));
      sec.append(acc);
    }
    body.append(sec);
  }
  if (!body.children.length) body.append(el('p', 'error', 'Nenhum login encontrado. Entre no Claude Code ou no Codex CLI e clique em Atualizar.'));
}

function render() {
  if (!data) return;
  const byProv = { claude: [], codex: [] };
  for (const a of data.accounts) byProv[a.provider]?.push(a);
  renderCompact(byProv);
  renderPanel(byProv);
  const t = new Date(data.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const retry = data.retryAt && data.retryAt > Date.now()
    ? ` · nova tentativa às ${new Date(data.retryAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
  $('#updated').textContent = `Atualizado às ${t} · % restante${retry}`;
  fit();
}

// O notch acompanha o tamanho do conteúdo, fechado ou aberto.
function fit() {
  const open = notchEl.classList.contains('open');
  notchEl.style.width = `${open ? $('#panel').offsetWidth : $('#compact').offsetWidth}px`;
  notchEl.style.height = `${open ? $('#panel').offsetHeight : 30}px`;
}

function open() {
  clearTimeout(closeTimer);
  api.interactive(true);
  notchEl.classList.add('open');
  fit();
}
function close() {
  closeTimer = setTimeout(() => {
    notchEl.classList.remove('open');
    fit();
    api.interactive(false);
  }, 220);
}
notchEl.addEventListener('mouseenter', open);
notchEl.addEventListener('mouseleave', close);

// Arrastar na horizontal move o notch; duplo clique volta ao centro.
// Botões do painel não iniciam o arrasto.
let dragX = null, dragged = false;
notchEl.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  dragX = e.screenX; dragged = false;
  notchEl.setPointerCapture(e.pointerId);
});
notchEl.addEventListener('pointermove', e => {
  if (dragX === null) return;
  const dx = e.screenX - dragX;
  if (!dragged && Math.abs(dx) < 3) return;
  dragged = true; dragX = e.screenX;
  notchEl.classList.add('dragging');
  api.drag(dx);
});
const endDrag = () => {
  if (dragX === null) return;
  dragX = null; notchEl.classList.remove('dragging');
  if (dragged) api.dragEnd();
};
notchEl.addEventListener('pointerup', endDrag);
notchEl.addEventListener('pointercancel', endDrag);
notchEl.addEventListener('dblclick', e => { if (!e.target.closest('button')) api.center(); });

api.onUsage(d => { data = d; render(); });
api.onLoading(on => {
  $('#pulse').classList.toggle('busy', on);
  $('#refresh').classList.toggle('spin', on);
});
$('#refresh').addEventListener('click', () => api.refresh());
$('#more').addEventListener('click', () => api.menu());

function setThemeUI(t) {
  for (const b of document.querySelectorAll('.theme button')) b.setAttribute('aria-checked', String(b.dataset.t === t));
}
for (const b of document.querySelectorAll('.theme button')) {
  b.addEventListener('click', () => { setThemeUI(b.dataset.t); api.setTheme(b.dataset.t); });
}
api.prefs().then(p => setThemeUI(p.theme));
fit();

setInterval(render, 30e3); // mantém os horários atuais
