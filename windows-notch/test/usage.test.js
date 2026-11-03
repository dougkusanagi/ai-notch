const { test, expect } = require('bun:test');
const { normalizeClaude, normalizeOpenAI, resetMs, keepStale, backoffMs } = require('../src/usage');

test('Claude: 5h e semanal com restante calculado', () => {
  const r = normalizeClaude({ five_hour: { utilization: 38, resets_at: '2026-10-24T18:00:00Z' }, seven_day: { utilization: 19 } });
  expect(r.windows.map(w => [w.label, w.remaining])).toEqual([['5 horas', 62], ['Semanal', 81]]);
  expect(r.windows[0].reset).toBe(Date.parse('2026-10-24T18:00:00Z'));
  expect(r.windows[1].reset).toBeNull();
});

test('Claude sem janelas gera erro legível', () => {
  expect(() => normalizeClaude({})).toThrow('O Claude não informou limites de uso.');
});

test('Codex: janelas primária e secundária, reset em segundos', () => {
  const r = normalizeOpenAI({ plan_type: 'plus', rate_limit: {
    primary_window: { used_percent: 88, limit_window_seconds: 18000, reset_at: 1793000000 },
    secondary_window: { used_percent: 120, limit_window_seconds: 604800 } } });
  expect(r.plan).toBe('plus');
  expect(r.windows.map(w => [w.label, w.remaining])).toEqual([['5 horas', 12], ['Semanal', 0]]);
  expect(r.windows[0].reset).toBe(1793000000 * 1000);
});

test('resetMs aceita ms, segundos e texto inválido', () => {
  expect(resetMs(1793000000000)).toBe(1793000000000);
  expect(resetMs('x')).toBeNull();
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { profileName, discoverProfiles } = require('../src/usage');

test('profileName gera nome e iniciais a partir do diretório', () => {
  expect(profileName('.claude', '.claude')).toEqual({ name: 'Principal', initials: 'P' });
  expect(profileName('.claude-trabalho', '.claude')).toEqual({ name: 'Trabalho', initials: 'TR' });
  expect(profileName('.codex-cliente_acme', '.codex')).toEqual({ name: 'Cliente Acme', initials: 'CA' });
});

test('discoverProfiles inclui o padrão e só irmãos com login', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-'));
  for (const [dir, file] of [['.claude-work', '.credentials.json'], ['.codex-b', 'auth.json']]) {
    fs.mkdirSync(path.join(home, dir));
    fs.writeFileSync(path.join(home, dir, file), '{}');
  }
  fs.mkdirSync(path.join(home, '.claude-vazio'));
  fs.mkdirSync(path.join(home, '.claudette'));
  delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
  return discoverProfiles(home).then(list => {
    expect(list.map(p => `${p.provider}:${p.name}`).sort()).toEqual(['claude:Principal', 'claude:Work', 'codex:B', 'codex:Principal']);
  });
});

test('falha com dados anteriores mantém os números como desatualizados', () => {
  const prev = { id: 'claude:x', ok: true, windows: [{ minutes: 300, remaining: 40 }], fetchedAt: 1000 };
  const s = keepStale(prev, 'Login recusado.', 0);
  expect(s).toMatchObject({ ok: true, stale: true, error: 'Login recusado.', staleSince: 1000 });
  expect(s.windows).toEqual(prev.windows);
  expect(keepStale({ ...s, fetchedAt: 5000 }, 'de novo').staleSince).toBe(1000);
  expect(keepStale({ ok: false }, 'x')).toBeNull();
  expect(keepStale(undefined, 'x')).toBeNull();
});

test('espera progressiva de 5 a 60 minutos respeita o Retry-After maior', () => {
  const min = m => m * 60e3;
  expect([1, 2, 3, 4, 5, 9].map(n => backoffMs(n))).toEqual([min(5), min(10), min(20), min(40), min(60), min(60)]);
  expect(backoffMs(1, min(90))).toBe(min(90));
  expect(backoffMs(3, min(2))).toBe(min(20));
});

test('discoverProfiles aplica nome, iniciais, ocultação e pastas adicionadas', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-'));
  const extra = path.join(home, 'projetos', 'cliente-acme');
  fs.mkdirSync(extra, { recursive: true });
  delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
  const std = path.join(home, '.claude');
  const list = await discoverProfiles(home, {
    custom: [{ provider: 'codex', dir: extra }],
    overrides: { [std]: { name: 'Pessoal Dev', hidden: true } },
  });
  const claude = list.find(p => p.dir === std);
  expect(claude).toMatchObject({ name: 'Pessoal Dev', initials: 'PD', hidden: true, custom: false });
  expect(list.find(p => p.dir === extra)).toMatchObject({ provider: 'codex', name: 'cliente-acme', initials: 'CL', custom: true, hidden: false });
});
