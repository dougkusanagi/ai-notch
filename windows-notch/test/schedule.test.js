const { test, expect } = require('bun:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { POLICY, RESET_DELAY_MS, jitter, newState, nextResetAt, dueAt, canFetch, afterFetch, isStale } = require('../src/schedule');
const { fetchAll } = require('../src/usage');

const min = m => m * 60e3;

test('desvio aleatório fica em ±10%', () => {
  expect(jitter(1000, () => 0)).toBe(900);
  expect(jitter(1000, () => 1)).toBe(1100);
});

test('Claude é mais lento que o Codex', () => {
  expect(POLICY.claude.intervalMs).toBeGreaterThan(POLICY.codex.intervalMs);
  expect(POLICY.claude.minGapMs).toBeGreaterThan(POLICY.codex.minGapMs);
});

test('um 429 do Claude não freia o Codex', () => {
  const now = 1_000_000;
  const claude = afterFetch('claude', newState(), [{ provider: 'claude', retryAfterMs: 0 }], now, () => 0.5);
  const codex = afterFetch('codex', newState(), [{ provider: 'codex', ok: true }], now, () => 0.5);
  expect(claude.backoffUntil).toBe(now + min(5));
  expect(claude.failures).toBe(1);
  expect(codex.backoffUntil).toBe(0);
  expect(canFetch('claude', claude, now + min(3), true)).toBe(false);
  expect(canFetch('claude', claude, now + min(5), true)).toBe(true);
  expect(canFetch('codex', codex, now + min(1), false)).toBe(true);
});

test('espera cresce a cada 429 seguido e zera no sucesso', () => {
  let st = newState();
  for (const n of [1, 2, 3]) {
    st = afterFetch('claude', st, [{ retryAfterMs: 0 }], 0, () => 0.5);
    expect(st.failures).toBe(n);
  }
  expect(st.backoffUntil).toBe(min(20));
  expect(afterFetch('claude', st, [{ ok: true }], 0, () => 0.5).failures).toBe(0);
});

test('consulta manual ignora o intervalo mínimo, o painel velho não', () => {
  const st = { ...newState(), lastAt: 1000 };
  expect(canFetch('claude', st, 1000 + 5000, false)).toBe(false);
  expect(canFetch('claude', st, 1000 + 5000, true)).toBe(true);
  expect(isStale(st, 1000 + 59e3)).toBe(false);
  expect(isStale(st, 1000 + 61e3)).toBe(true);
});

test('hora da próxima consulta: o reset conhecido adianta o intervalo', () => {
  const lastAt = 0, reset = min(2);
  const accounts = [{ provider: 'claude', ok: true, windows: [{ minutes: 300, reset }, { minutes: 10080, reset: min(5000) }] }];
  const st = { ...newState(), lastAt, nextAt: min(6) };
  expect(nextResetAt(accounts, lastAt)).toBe(reset + RESET_DELAY_MS);
  expect(dueAt('claude', st, accounts)).toBe(reset + RESET_DELAY_MS);
  // depois de consultar após o reset, ele não conta mais
  expect(dueAt('claude', { ...st, lastAt: reset + min(1), nextAt: min(9) }, accounts)).toBe(min(9));
});

test('hora da próxima consulta respeita o mínimo e a espera do 429', () => {
  const accounts = [{ provider: 'claude', ok: true, windows: [{ minutes: 300, reset: 1000 }] }];
  const st = { ...newState(), lastAt: 500, nextAt: 800, backoffUntil: min(10) };
  expect(dueAt('claude', st, accounts)).toBe(min(10));
  expect(dueAt('claude', { ...st, backoffUntil: 0 }, accounts)).toBe(500 + POLICY.claude.minGapMs);
});

test('fetchAll limitado a um serviço só traz as contas dele', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-'));
  fs.mkdirSync(path.join(home, '.claude')); fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{}');
  fs.mkdirSync(path.join(home, '.codex')); fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{}');
  delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
  const only = await fetchAll(home, [], { providers: ['codex'] });
  expect(only.map(a => a.provider)).toEqual(['codex']);
  const both = await fetchAll(home, []);
  expect(both.map(a => a.provider).sort()).toEqual(['claude', 'codex']);
});

test('contas do mesmo serviço são consultadas em sequência, com pausa', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'notch-'));
  for (const d of ['.claude', '.claude-b']) { fs.mkdirSync(path.join(home, d)); fs.writeFileSync(path.join(home, d, '.credentials.json'), '{}'); }
  delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
  const t0 = Date.now();
  const out = await fetchAll(home, [], { providers: ['claude'], gapMs: 100 });
  expect(out).toHaveLength(2);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
});
