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
const PROV = { claude: 'Claude', codex: 'Codex' };

function showError(msg) { addError.hidden = !msg; addError.textContent = msg ?? ''; }
function renderAccounts({ accounts, error }) {
  showError(error);
  if (!accBox.contains(document.activeElement)) accBox.replaceChildren(...accounts.map(accountCard));
  if (!accounts.length) accBox.replaceChildren(el('p', 'hint', 'Nenhuma conta encontrada. Entre no Claude Code ou no Codex CLI, ou adicione uma pasta.'));
}
const save = a => window.settings.setAccount(a).then(r => { accBox.replaceChildren(...r.accounts.map(accountCard)); showError(r.error); });

function accountCard(a) {
  const c = el('section', a.hidden ? 'acc off' : 'acc');
  const row = el('div', 'row');
  const name = el('input', 'name'); name.type = 'text'; name.value = a.name; name.maxLength = 40;
  name.setAttribute('aria-label', `Nome da conta ${PROV[a.provider]}`);
  const ini = el('input', 'ini'); ini.type = 'text'; ini.value = a.initials; ini.maxLength = 3;
  ini.setAttribute('aria-label', `Iniciais da conta ${a.name}`);
  const commit = () => { if (name.value !== a.name || ini.value !== a.initials) save({ dir: a.dir, name: name.value, initials: ini.value }); };
  for (const i of [name, ini]) {
    i.addEventListener('change', commit);
    i.addEventListener('keydown', e => e.key === 'Enter' && i.blur());
  }
  const vis = el('label', 'show');
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = !a.hidden;
  cb.addEventListener('change', () => save({ dir: a.dir, hidden: !cb.checked }));
  vis.append(cb, document.createTextNode('Mostrar'));
  row.append(el('span', 'prov', PROV[a.provider]), name, ini, vis);
  if (a.custom) {
    const rm = el('button', null, 'Remover');
    rm.type = 'button';
    rm.setAttribute('aria-label', `Remover a conta ${a.name}`);
    rm.addEventListener('click', () => save({ dir: a.dir, remove: true }));
    row.append(rm);
  }
  c.append(row, el('div', 'dir', a.dir));
  return c;
}

addForm.addEventListener('submit', async e => {
  e.preventDefault();
  const dir = document.getElementById('add-dir');
  const r = await window.settings.setAccount({ add: true, provider: document.getElementById('add-provider').value, dir: dir.value.trim() });
  accBox.replaceChildren(...r.accounts.map(accountCard));
  showError(r.error);
  if (!r.error) dir.value = '';
});
const loadAccounts = () => window.settings.accounts().then(accounts => renderAccounts({ accounts }));
window.addEventListener('focus', loadAccounts);
loadAccounts();
