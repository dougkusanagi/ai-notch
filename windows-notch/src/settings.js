const $ = id => document.getElementById(id);
const EDGES = [['top', 'Topo'], ['bottom', 'Base'], ['left', 'Esquerda'], ['right', 'Direita']];
const SERVICES = [['claude', 'Claude'], ['codex', 'Codex']];
const NAMES = { claude: 'Claude', codex: 'Codex' };
let state = null, editing = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function button(text, onClick, cls, label) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

// ---- Abas ----
const TABS = ['ajustes', 'contas', 'monitores'];
function showTab(name) {
  const tab = TABS.includes(name) ? name : 'ajustes';
  for (const t of TABS) {
    $(`tab-${t}`).hidden = t !== tab;
    $(`t-${t}`).setAttribute('aria-selected', String(t === tab));
    $(`t-${t}`).tabIndex = t === tab ? 0 : -1;
  }
}
for (const t of TABS) $(`t-${t}`).addEventListener('click', () => { showTab(t); history.replaceState(null, '', `#${t}`); });
window.settings.onTab(showTab);

// ---- Ajustes ----
function segmented(host, label, options, value, onPick) {
  host.replaceChildren(...options.map(([v, text]) => {
    const b = button(text, () => onPick(v), null);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(v === value));
    return b;
  }));
}
function renderAjustes() {
  const p = state.prefs;
  segmented($('theme'), 'Tema', [['light', 'Claro'], ['dark', 'Escuro'], ['system', 'Sistema']], p.theme, v => update({ theme: v }));
  segmented($('resetFormat'), 'Formato do reset', [['24h', '24 h'], ['12h', '12 h'], ['relative', 'Relativo']], p.resetFormat, v => update({ resetFormat: v }));
  $('coloredBars').checked = p.coloredBars;
  $('autoStart').checked = p.autoStart;
}
$('coloredBars').addEventListener('change', e => update({ coloredBars: e.target.checked }));
$('autoStart').addEventListener('change', e => update({ autoStart: e.target.checked }));

// ---- Contas: lista ----
function badge(a) {
  const b = el('span', 'badge', a.initials);
  b.style.background = a.color;
  return b;
}
function renderList() {
  const list = $('list');
  const rows = state.accounts.map((a, i) => {
    const row = el('div', a.visible ? 'acct' : 'acct dim');
    const names = el('div', 'names');
    names.append(el('strong', null, `${a.name}`), el('small', null, `${NAMES[a.provider]} · ${a.profilePath}${a.visible ? '' : ' · oculta'}${a.autoResetMessage ? ' · mensagem após reset' : ''}`));
    const actions = el('div', 'acts');
    const up = button('↑', () => account({ type: 'move', id: a.id, offset: -1 }), 'icon', `Mover ${a.name} para cima`);
    const down = button('↓', () => account({ type: 'move', id: a.id, offset: 1 }), 'icon', `Mover ${a.name} para baixo`);
    up.disabled = i === 0; down.disabled = i === state.accounts.length - 1;
    const eye = button(a.visible ? 'Ocultar' : 'Mostrar', () => account({ type: 'visible', id: a.id, visible: !a.visible }), null,
      a.visible ? `Ocultar ${a.name} do notch` : `Mostrar ${a.name} no notch`);
    actions.append(up, down, eye, button('Editar', () => openEditor(a), null, `Editar ${a.name}`));
    row.append(badge(a), names, actions);
    return row;
  });
  if (!rows.length) rows.push(el('p', 'hint', 'Nenhuma conta cadastrada. Adicione uma conta do Claude ou do Codex para ver os limites no notch.'));
  list.replaceChildren(el('div', 'group accts', null), button('Adicionar conta', () => openEditor({}), 'primary add'));
  list.firstChild.append(...rows);
}

// ---- Contas: editor ----
const form = $('editor');
async function openEditor(a) {
  editing = true;
  $('list').hidden = true; form.hidden = false;
  const f = {
    id: a.id, provider: a.provider ?? 'claude', name: a.name ?? '', profilePath: a.profilePath ?? state.defaults.dirs[a.provider ?? 'claude'],
    initials: a.initials ?? '', color: a.color ?? state.defaults.palette[state.accounts.length % state.defaults.palette.length],
    visible: a.visible !== false, autoResetMessage: a.autoResetMessage === true, resetPrompt: a.resetPrompt ?? state.defaults.prompt,
  };
  let manualInitials = Boolean(a.id);
  form.replaceChildren();
  const heading = el('h2', 'sec', a.id ? 'Editar conta' : 'Nova conta');

  const field = (title, value, opts = {}) => {
    const label = el('label', 'field');
    const input = el('input');
    input.type = 'text'; input.value = value; input.autocomplete = 'off'; input.spellcheck = false;
    if (opts.max) input.maxLength = opts.max;
    label.append(el('span', null, title), input);
    return { label, input };
  };

  const preview = el('div', 'acct preview');
  const pBadge = el('span', 'badge'), pNames = el('div', 'names'), pName = el('strong'), pSub = el('small');
  pNames.append(pName, pSub); preview.append(pBadge, pNames);

  const provider = el('div', 'seg wide'); provider.setAttribute('role', 'radiogroup'); provider.setAttribute('aria-label', 'Serviço');
  const name = field('Nome', f.name, { max: 80 });
  const dir = field('Diretório do perfil', f.profilePath);
  const pick = button('Escolher…', async () => { const p = await window.settings.pick(); if (p) { dir.input.value = p; sync(); } });
  dir.label.append(pick);
  dir.label.classList.add('with-btn');

  const login = el('div', 'login');
  const loginHint = el('small'), loginCode = el('code'), copy = button('Copiar', async () => {
    try { await navigator.clipboard.writeText(loginCode.textContent); loginHint.textContent = 'Copiado.'; }
    catch { loginHint.textContent = 'Não foi possível copiar. Selecione o comando e use Ctrl+C.'; }
  }, 'small');
  const loginTop = el('div', 'login-top'); loginTop.append(loginHint, copy);
  login.append(loginTop, loginCode);

  const initials = field('Iniciais', f.initials, { max: 3 });
  const hex = field('Cor (hexadecimal)', f.color, { max: 7 });
  const palette = el('div', 'palette'); palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', 'Cores sugeridas');
  const swatches = state.defaults.palette.map(c => {
    const b = button('', () => { hex.input.value = c; sync(); }, 'swatch', `Cor ${c}`);
    b.style.background = c;
    palette.append(b);
    return [b, c];
  });

  const auto = el('label', 'line');
  const autoBox = el('input'); autoBox.type = 'checkbox'; autoBox.checked = f.autoResetMessage;
  const autoText = el('span', null, 'Mensagem após o reset de 5 h'); autoText.append(el('small', null, 'Quando a janela de 5 h ficar livre, envia uma mensagem curta pelo CLI desta conta. Isso inicia a próxima janela e usa um pouco do limite. Uma tentativa a cada 5 minutos, no máximo. O app precisa estar aberto e o CLI da conta, instalado e com login.'));
  auto.append(autoText, autoBox);
  const prompt = field('Prompt', f.resetPrompt, { max: 2000 });

  const error = el('p', 'error'); error.hidden = true; error.setAttribute('role', 'alert');

  const draw = () => {
    segmented(provider, 'Serviço', SERVICES, f.provider, v => {
      if (state.defaults.dirs[f.provider] === dir.input.value) dir.input.value = state.defaults.dirs[v];
      f.provider = v; draw(); sync();
    });
  };
  let syncToken = 0;
  async function sync() {
    const color = /^#[0-9a-f]{6}$/i.test(hex.input.value.trim()) ? hex.input.value.trim() : '#8E8E93';
    pBadge.textContent = initials.input.value.trim().toUpperCase() || '··';
    pBadge.style.background = color;
    pName.textContent = name.input.value.trim() || 'Nome da conta';
    pSub.textContent = NAMES[f.provider];
    for (const [b, c] of swatches) b.setAttribute('aria-pressed', String(c.toLowerCase() === hex.input.value.trim().toLowerCase()));
    const token = ++syncToken;
    const cmd = await window.settings.accounts({ type: 'login', provider: f.provider, dir: dir.input.value });
    if (token !== syncToken) return;
    loginCode.textContent = cmd.login ?? '';
    loginCode.hidden = copy.hidden = !cmd.login;
    loginHint.textContent = cmd.login ? 'Para entrar nesta conta, rode no PowerShell:' : 'Informe um diretório válido para ver o comando de login.';
  }

  name.input.addEventListener('input', () => {
    if (!manualInitials) initials.input.value = initialsOf(name.input.value);
    sync();
  });
  initials.input.addEventListener('input', () => { manualInitials = true; sync(); });
  for (const i of [dir.input, hex.input]) i.addEventListener('input', sync);

  const actions = el('div', 'form-actions');
  const submit = async () => {
    error.hidden = true;
    const r = await window.settings.accounts({
      type: 'put', account: {
        ...f, name: name.input.value, profilePath: dir.input.value, initials: initials.input.value,
        color: hex.input.value.trim(), autoResetMessage: autoBox.checked, resetPrompt: prompt.input.value,
      },
    });
    if (r.error) { error.textContent = r.error; error.hidden = false; return; }
    closeEditor(r);
  };
  if (a.id) {
    const remove = button('Remover conta', () => {
      actions.replaceChildren(el('span', 'confirm', 'Remover esta conta? Só o cadastro é apagado; o login do CLI continua no disco.'),
        button('Cancelar', () => openEditor(a)), button('Remover', async () => closeEditor(await window.settings.accounts({ type: 'remove', id: a.id })), 'danger'));
    }, 'danger-outline');
    actions.append(remove);
  }
  actions.append(el('span', 'grow'), button('Cancelar', () => closeEditor()), button(a.id ? 'Salvar' : 'Adicionar', submit, 'primary'));
  for (const i of [name.input, dir.input, initials.input, hex.input, prompt.input]) i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  form.addEventListener('submit', e => e.preventDefault());

  const h = (t) => el('h3', 'sub', t);
  form.append(heading, preview, el('div', 'group stack', null), h('Cor'), el('div', 'group stack', null), h('Mensagem após o reset'), el('div', 'group stack', null), error, actions);
  const [g1, g2, g3] = form.querySelectorAll('.group');
  const svcLine = el('div', 'line'); svcLine.append(el('span', null, 'Serviço'), provider);
  g1.append(svcLine, name.label, dir.label, login, initials.label);
  g2.append(palette, hex.label);
  g3.append(auto, prompt.label);
  draw(); sync();
  if (!a.id) name.input.focus();
}
function initialsOf(name) {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return '';
  const chars = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words.at(-1))[0]];
  return chars.join('').toLocaleUpperCase('pt-BR');
}
function closeEditor(next) {
  editing = false;
  form.hidden = true; $('list').hidden = false;
  if (next) render(next); else window.settings.get().then(render);
}

// ---- Monitores e posição ----
function card(m) {
  const c = el('section', m.show ? 'card' : 'card off');
  const h = el('h2', null, `Monitor ${m.index}${m.primary ? ' (principal)' : ''} `);
  h.append(el('small', null, `${m.width}×${m.height}`));

  const show = el('label', 'show');
  const cb = el('input');
  cb.type = 'checkbox'; cb.checked = m.show;
  cb.addEventListener('change', () => update({ id: m.id, show: cb.checked }));
  show.append(cb, document.createTextNode('Mostrar o notch aqui'));

  const prev = el('div', m.show ? 'preview-mon' : 'preview-mon off');
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

function render(s) {
  state = s;
  renderAjustes();
  if (!editing) renderList();
  $('monitors').replaceChildren(...s.monitors.map(card));
  $('locked').checked = s.locked;
}

const update = s => window.settings.set(s).then(render);
const account = op => window.settings.accounts(op).then(r => { render(r); return r; });
$('locked').addEventListener('change', () => update({ locked: $('locked').checked }));
window.addEventListener('focus', () => window.settings.get().then(render));
showTab(location.hash.slice(1));
window.settings.get().then(render);
