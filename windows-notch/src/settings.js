const box = document.getElementById('monitors');
const lockEl = document.getElementById('locked');
const EDGES = [['top', 'Topo'], ['bottom', 'Base'], ['left', 'Esquerda'], ['right', 'Direita']];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function card(m) {
  const c = el('section', m.show ? 'card' : 'card off');
  const h = el('h2', null, `Monitor ${m.index}${m.primary ? ' (principal)' : ''} `);
  h.append(el('small', null, `${m.width}×${m.height}`));

  const show = el('label', 'show');
  const cb = el('input');
  cb.type = 'checkbox'; cb.checked = m.show;
  cb.addEventListener('change', () => update({ id: m.id, show: cb.checked }));
  show.append(cb, document.createTextNode('Mostrar o notch aqui'));

  const prev = el('div', m.show ? 'preview' : 'preview off');
  prev.append(el('i', m.edge));

  const edges = el('div', 'edges');
  edges.setAttribute('role', 'group');
  edges.setAttribute('aria-label', `Borda do monitor ${m.index}`);
  for (const [value, label] of EDGES) {
    const b = el('button', null, label);
    b.setAttribute('aria-pressed', String(m.edge === value));
    b.disabled = !m.show;
    b.addEventListener('click', () => update({ id: m.id, edge: value }));
    edges.append(b);
  }

  const center = el('button', 'center', 'Centralizar neste monitor');
  center.disabled = !m.show;
  center.addEventListener('click', () => update({ id: m.id, center: true }));

  c.append(h, show, prev, edges, center);
  return c;
}

function render(state) {
  box.replaceChildren(...state.monitors.map(card));
  lockEl.checked = state.locked;
}

const update = s => window.settings.set(s).then(render);
lockEl.addEventListener('change', () => update({ locked: lockEl.checked }));
window.addEventListener('focus', () => window.settings.get().then(render));
window.settings.get().then(render);

// ---- Contas ----
const accBox = document.getElementById('accounts');
const addForm = document.getElementById('add');
const addError = document.getElementById('add-error');
const dirInput = document.getElementById('add-dir');
const statusEl = document.getElementById('status');
const PROV = { claude: { name: 'Claude', color: '#d97757' }, codex: { name: 'Codex', color: '#10a37f' } };
let statusTimer;

function flash(msg) {
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 2500);
}
function showError(msg) { addError.hidden = !msg; addError.textContent = msg ?? ''; }

// Mostra ~ no lugar da pasta do usuário, para o caminho caber na linha.
const shortDir = dir => dir.replace(/^(\/home\/[^/]+|\/Users\/[^/]+|[A-Z]:\\Users\\[^\\]+)/, '~');

function renderAccounts(accounts) {
  if (accBox.contains(document.activeElement) && document.activeElement.type === 'text') return;
  if (!accounts.length) return accBox.replaceChildren(el('p', 'empty', 'Nenhuma conta encontrada. Entre no Claude Code ou no Codex CLI, ou adicione uma pasta abaixo.'));
  const groups = [];
  for (const [id, info] of Object.entries(PROV)) {
    const list = accounts.filter(a => a.provider === id);
    if (!list.length) continue;
    const g = el('section', 'provider');
    g.style.setProperty('--p', info.color);
    const h = el('header');
    h.append(el('i'), document.createTextNode(`${info.name} · ${list.length} ${list.length > 1 ? 'contas' : 'conta'}`));
    const box = el('div', 'list');
    box.append(...list.map(accountRow));
    g.append(h, box);
    groups.push(g);
  }
  accBox.replaceChildren(...groups);
}

async function save(a, msg) {
  const r = await window.settings.setAccount(a);
  renderAccounts(r.accounts);
  if (r.error) flash(r.error); else flash(msg);
  return r;
}

function input(cls, value, label, max) {
  const i = el('input', cls);
  i.type = 'text'; i.value = value; i.maxLength = max; i.setAttribute('aria-label', label); i.spellcheck = false;
  i.addEventListener('keydown', e => {
    if (e.key === 'Enter') i.blur();
    if (e.key === 'Escape') { i.value = i.defaultValue; i.blur(); }
  });
  return i;
}

function accountRow(a) {
  const row = el('div', a.hidden ? 'acc off' : 'acc');
  const badge = el('span', 'badge', a.initials);
  badge.setAttribute('aria-hidden', 'true');

  const fields = el('div', 'fields');
  const name = input('name', a.name, `Nome da conta ${PROV[a.provider].name}`, 40);
  const ini = input('ini', a.initials, `Iniciais da conta ${a.name}`, 3);
  ini.addEventListener('input', () => { badge.textContent = ini.value.toUpperCase() || '?'; });
  const commit = () => {
    if (name.value.trim() === a.name && ini.value.trim().toUpperCase() === a.initials) return;
    // Só envia as iniciais se mudaram; assim, sem iniciais próprias, elas seguem o novo nome.
    const changed = ini.value.trim().toUpperCase() !== a.initials;
    save({ dir: a.dir, name: name.value, ...(changed && { initials: ini.value }) }, 'Conta salva.');
  };
  name.addEventListener('change', commit);
  ini.addEventListener('change', commit);
  fields.append(name, ini);

  const actions = el('div', 'actions');
  const sw = el('label', 'switch');
  sw.title = a.hidden ? 'Oculta no notch' : 'Visível no notch';
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = !a.hidden; cb.setAttribute('role', 'switch');
  cb.setAttribute('aria-label', `Mostrar ${a.name} no notch`);
  cb.addEventListener('change', () => save({ dir: a.dir, hidden: !cb.checked }, cb.checked ? `${a.name} voltou ao notch.` : `${a.name} foi ocultada.`));
  sw.append(cb, el('span'));
  actions.append(sw);
  if (a.custom) {
    const rm = el('button', 'remove');
    rm.type = 'button'; rm.title = 'Remover conta';
    rm.setAttribute('aria-label', `Remover a conta ${a.name}`);
    rm.innerHTML = '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';
    rm.addEventListener('click', () => {
      if (confirm(`Remover "${a.name}"? A pasta não é apagada, só sai da lista.`)) save({ dir: a.dir, remove: true }, 'Conta removida.');
    });
    actions.append(rm);
  }

  const dir = el('div', 'dir');
  dir.title = a.dir;
  if (a.custom) dir.append(el('em', null, 'Adicionada'));
  dir.append(document.createTextNode(shortDir(a.dir)));
  row.append(badge, fields, actions, dir);
  return row;
}

document.getElementById('browse').addEventListener('click', async () => {
  const dir = await window.settings.pickFolder();
  if (dir) { dirInput.value = dir; showError(null); }
});

addForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = addForm.querySelector('.primary');
  btn.disabled = true;
  const provider = addForm.querySelector('input[name=provider]:checked').value;
  const r = await window.settings.setAccount({ add: true, provider, dir: dirInput.value.trim() }).finally(() => { btn.disabled = false; });
  renderAccounts(r.accounts);
  showError(r.error);
  if (!r.error) { dirInput.value = ''; flash('Conta adicionada. Atualizando os limites…'); }
});
const loadAccounts = () => window.settings.accounts().then(renderAccounts);
window.addEventListener('focus', loadAccounts);
loadAccounts();
