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
