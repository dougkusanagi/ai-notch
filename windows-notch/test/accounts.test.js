const { test, expect } = require('bun:test');
const A = require('../src/accounts');
const R = require('../src/reset-message');

const base = { provider: 'claude', name: 'Trabalho Acme', profilePath: 'C:\\Users\\x\\.claude-trabalho', color: '#0A84FF' };

test('valida e completa uma conta', () => {
  const a = A.validateAccount(base, () => 'id1');
  expect(a).toMatchObject({ id: 'id1', initials: 'TA', visible: true, autoResetMessage: false, resetPrompt: A.DEFAULT_RESET_PROMPT });
});

test('recusa dados inválidos com mensagem clara', () => {
  expect(() => A.validateAccount({ ...base, name: ' ' })).toThrow('nome');
  expect(() => A.validateAccount({ ...base, color: 'azul' })).toThrow('hexadecimal');
  expect(() => A.validateAccount({ ...base, profilePath: 'relativo' })).toThrow('absoluto');
  expect(() => A.validateAccount({ ...base, provider: 'x' })).toThrow('serviço');
  expect(() => A.validateAccount({ ...base, initials: 'A-B' })).toThrow('iniciais');
});

test('~ vira o diretório do usuário', () => {
  expect(A.expandPath('~\\.codex', 'C:\\Users\\x')).toBe('C:\\Users\\x\\.codex');
  expect(A.expandPath('~', 'C:\\Users\\x')).toBe('C:\\Users\\x');
});

test('adiciona, edita, move e remove', () => {
  let l = A.put([], base);
  l = A.put(l, { ...base, name: 'Outra', profilePath: 'C:\\b' });
  expect(l.map(a => a.name)).toEqual(['Trabalho Acme', 'Outra']);
  l = A.put(l, { ...l[0], name: 'Renomeada' });
  expect(l).toHaveLength(2);
  expect(l[0].name).toBe('Renomeada');
  expect(A.move(l, l[1].id, -1).map(a => a.name)).toEqual(['Outra', 'Renomeada']);
  expect(A.move(l, l[0].id, -1)).toBe(l);
  expect(A.remove(l, l[0].id)).toHaveLength(1);
});

test('recusa a mesma conta duas vezes', () => {
  const l = A.put([], base);
  expect(() => A.put(l, { ...base, name: 'Copia', profilePath: base.profilePath.toUpperCase() })).toThrow('Já existe');
});

test('lista guardada descarta entradas inválidas e ids repetidos', () => {
  const ok = A.validateAccount(base);
  expect(A.cleanList([ok, ok, { provider: 'claude' }, 5])).toHaveLength(1);
  expect(A.cleanList('x')).toEqual([]);
});

test('lista inicial vem dos perfis detectados', () => {
  const l = A.fromProfiles([{ provider: 'claude', dir: 'C:\\Users\\x\\.claude-trabalho', name: 'Trabalho', initials: 'TR' }], 'C:\\Users\\x');
  expect(l[0]).toMatchObject({ profilePath: '~\\.claude-trabalho', initials: 'TR', provider: 'claude' });
});

test('comando de login usa aspas simples e protege apóstrofo', () => {
  expect(A.loginCommand('claude', 'C:\\a b', 'C:\\h')).toBe("$env:CLAUDE_CONFIG_DIR='C:\\a b'; claude");
  expect(A.loginCommand('codex', "C:\\o'k", 'C:\\h')).toBe("$env:CODEX_HOME='C:\\o''k'; codex login");
  expect(A.loginCommand('codex', 'relativo')).toBe('');
});

const NOW = 10_000_000;
const win = (reset, minutes = 300) => ({ ok: true, windows: [{ minutes, reset, remaining: 100 }] });

test('envia só quando a janela de 5 h está livre e passou o intervalo', () => {
  expect(R.shouldSendResetMessage(win(null), 0, NOW)).toBe(true);
  expect(R.shouldSendResetMessage(win(NOW - 1), 0, NOW)).toBe(true);
  expect(R.shouldSendResetMessage(win(NOW + 60e3), 0, NOW)).toBe(false);
  expect(R.shouldSendResetMessage(win(null), NOW - 4 * 60e3, NOW)).toBe(false);
  expect(R.shouldSendResetMessage(win(null), NOW - 5 * 60e3, NOW)).toBe(true);
  expect(R.shouldSendResetMessage({ ok: true, windows: [] }, 0, NOW)).toBe(false);
  // Claude sem a janela de 5 h, mas com a semanal: não há sessão ativa
  expect(R.shouldSendResetMessage(win(NOW + 1e9, 10080), 0, NOW)).toBe(true);
});

test('o prompt do usuário nunca vai nos argumentos', () => {
  for (const p of ['claude', 'codex']) expect(R.messageCommand(p, 'C:\\mcp.json').join(' ')).not.toContain('Responda apenas');
  expect(R.messageCommand('codex').at(-1)).toBe('-');
});

test('atalho .cmd usa cmd.exe com argumentos entre aspas e recusa caracteres perigosos', () => {
  const [file, args, opts] = R.launchSpec('C:\\n\\codex.cmd', ['exec', '-']);
  expect(file.toLowerCase()).toContain('cmd');
  expect(args.at(-1)).toBe('""C:\\n\\codex.cmd" "exec" "-""');
  expect(opts.windowsVerbatimArguments).toBe(true);
  expect(() => R.launchSpec('C:\\n\\a%PATH%.cmd', [])).toThrow();
  expect(R.launchSpec('C:\\n\\claude.exe', ['x'])[0]).toBe('C:\\n\\claude.exe');
});

test('erros do CLI viram texto simples', () => {
  expect(R.cliFailure('claude', 'Error: not logged in', 1)).toContain('Login Claude');
  expect(R.cliFailure('codex', 'usage limit reached', 1)).toContain('Limite');
  expect(R.cliFailure('codex', '???', 3)).toContain('código 3');
});

test('envia o prompt pela entrada padrão, sem expor variáveis de chave', async () => {
  const { EventEmitter } = require('node:events');
  let seen;
  const run = (file, args, opts) => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    let input = '';
    c.stdin = { on() {}, end: v => { input = v; seen = { file, args, opts, input }; setImmediate(() => c.emit('close', 0)); } };
    return c;
  };
  process.env.ANTHROPIC_API_KEY = 'segredo';
  await R.sendResetMessage({ provider: 'claude', profilePath: 'C:\\perfil', resetPrompt: 'Oi' }, { find: () => 'C:\\bin\\claude.exe', run });
  expect(seen.input).toBe('Oi');
  expect(seen.opts.env.ANTHROPIC_API_KEY).toBeUndefined();
  expect(seen.opts.env.CLAUDE_CONFIG_DIR).toBe('C:\\perfil');
  expect(seen.args).toContain('--print');
  await expect(R.sendResetMessage({ provider: 'codex', profilePath: 'C:\\p', resetPrompt: 'x' }, { find: () => null })).rejects.toThrow('não encontrado');
});
