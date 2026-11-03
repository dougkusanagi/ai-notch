// Leitura dos limites de assinatura. Tokens ficam só em memória e nunca são registrados.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const clamp = v => Math.max(0, Math.min(100, v));

function resetMs(value) {
  if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
  if (typeof value === 'string') { const t = Date.parse(value); return Number.isFinite(t) ? t : null; }
  return null;
}

function toWindow(label, raw, minutes) {
  if (!raw) return null;
  const used = raw.used_percent ?? raw.utilization ?? raw.percent;
  if (typeof used !== 'number') return null;
  const mins = raw.limit_window_seconds ? raw.limit_window_seconds / 60 : minutes;
  return { label, minutes: mins, remaining: clamp(100 - used), reset: resetMs(raw.reset_at ?? raw.resets_at) };
}

function normalizeClaude(raw) {
  const windows = [toWindow('5 horas', raw.five_hour, 300), toWindow('Semanal', raw.seven_day, 10080)].filter(Boolean);
  if (!windows.length) throw new Error('O Claude não informou limites de uso.');
  return { windows };
}

function normalizeOpenAI(raw) {
  const rate = raw.rate_limit ?? raw.rate_limits ?? {};
  const windows = [
    toWindow('5 horas', rate.primary_window ?? rate.primary, 300),
    toWindow('Semanal', rate.secondary_window ?? rate.secondary, 10080),
  ].filter(Boolean);
  for (const w of windows) {
    if (w.minutes === 10080) w.label = 'Semanal';
    else if (w.minutes !== 300) w.label = `${Math.round(w.minutes / 60)} horas`;
  }
  if (!windows.length) throw new Error('O Codex não informou limites de uso.');
  return { windows, plan: raw.plan_type ?? null };
}

async function readJSON(file, missing) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { throw new Error(e.code === 'ENOENT' ? missing : 'Não foi possível ler o login local.'); }
}

async function request(url, headers) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'AIQuotaNotch/0.1', ...headers },
    redirect: 'manual', // nunca repassa o token para outro destino
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Login recusado. Entre novamente pelo CLI.');
  if (res.status === 429) {
    const e = new Error('Muitas consultas. Tentaremos de novo em alguns minutos.');
    e.retryAfterMs = Math.max(0, Number(res.headers.get('retry-after')) * 1000) || 0;
    throw e;
  }
  if (!res.ok) throw new Error(`O serviço respondeu com erro ${res.status}.`);
  return res.json();
}

const PROVIDERS = {
  claude: { prefix: '.claude', file: '.credentials.json', env: 'CLAUDE_CONFIG_DIR', read: claude,
    missing: 'Entre no Claude Code para ver os limites.' },
  codex: { prefix: '.codex', file: 'auth.json', env: 'CODEX_HOME', read: codex,
    missing: 'Entre no Codex CLI (codex login) para ver os limites.' },
};

async function claude(dir) {
  const auth = await readJSON(path.join(dir, '.credentials.json'), PROVIDERS.claude.missing);
  const o = auth.claudeAiOauth;
  if (!o?.accessToken) throw new Error('Entre com uma assinatura Claude no Claude Code.');
  if (o.expiresAt && o.expiresAt < Date.now()) throw new Error('Login expirado. Abra o Claude Code para renovar.');
  const raw = await request('https://api.anthropic.com/api/oauth/usage',
    { Authorization: `Bearer ${o.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' });
  return { ...normalizeClaude(raw), plan: o.subscriptionType ?? null };
}

async function codex(dir) {
  const auth = await readJSON(path.join(dir, 'auth.json'), PROVIDERS.codex.missing);
  const t = auth.tokens;
  if (!t?.access_token) throw new Error('Entre com uma assinatura ChatGPT no Codex CLI.');
  const raw = await request('https://chatgpt.com/backend-api/wham/usage',
    { Authorization: `Bearer ${t.access_token}`, 'ChatGPT-Account-Id': t.account_id });
  return normalizeOpenAI(raw);
}

// Nome e iniciais a partir do diretório: .claude -> Principal; .claude-trabalho -> Trabalho / TR
function profileName(dirName, prefix) {
  const suffix = dirName.slice(prefix.length).replace(/^[-_.]/, '');
  if (!suffix) return { name: 'Principal', initials: 'P' };
  const name = suffix.split(/[-_.]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  const words = name.split(' ').filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  return { name, initials };
}

// Perfis: o diretório padrão (ou a variável de ambiente), irmãos com sufixo que tenham login
// e pastas adicionadas à mão. `config` = { custom: [{ provider, dir }], overrides: { [dir]: { name, initials, hidden } } }.
async function discoverProfiles(home = os.homedir(), config = {}) {
  const entries = await fs.readdir(home, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const [provider, cfg] of Object.entries(PROVIDERS)) {
    const dirs = new Set();
    if (process.env[cfg.env]) dirs.add(path.resolve(process.env[cfg.env]));
    dirs.add(path.join(home, cfg.prefix));
    for (const e of entries) {
      if (!e.isDirectory() || !/^[-_.]./.test(e.name.slice(cfg.prefix.length)) || !e.name.startsWith(cfg.prefix)) continue;
      const dir = path.join(home, e.name);
      if (await fs.access(path.join(dir, cfg.file)).then(() => true, () => false)) dirs.add(dir);
    }
    for (const c of config.custom ?? []) if (c.provider === provider) dirs.add(path.resolve(c.dir));
    const custom = new Set((config.custom ?? []).filter(c => c.provider === provider).map(c => path.resolve(c.dir)));
    const removed = new Set(config.removed ?? []);
    for (const dir of dirs) {
      if (removed.has(dir)) continue;
      const loggedIn = await fs.access(path.join(dir, cfg.file)).then(() => true, () => false);
      const auto = profileName(path.basename(dir), cfg.prefix);
      const o = config.overrides?.[dir] ?? {};
      const name = o.name || (custom.has(dir) && !path.basename(dir).startsWith(cfg.prefix) ? path.basename(dir) : auto.name);
      const initials = o.initials || (o.name ? initialsOf(o.name) : (name === auto.name ? auto.initials : initialsOf(name)));
      out.push({ provider, dir, name, initials, hidden: o.hidden === true, custom: custom.has(dir), loggedIn });
    }
  }
  // Ordem escolhida pelo usuário; contas novas vão para o fim, na ordem da descoberta.
  const order = config.order ?? [];
  const rank = d => { const i = order.indexOf(d); return i < 0 ? order.length : i; };
  return out.map((p, i) => [p, i]).sort((a, b) => rank(a[0].dir) - rank(b[0].dir) || a[1] - b[1]).map(([p]) => p);
}

// Comando que entra na conta usando a pasta do perfil, no shell da plataforma.
function loginCommand(provider, dir, platform = process.platform, home = os.homedir()) {
  const env = PROVIDERS[provider]?.env;
  if (!env) return '';
  const cmd = provider === 'codex' ? 'codex login' : 'claude';
  if (platform === 'win32') return `$env:${env}='${dir.replaceAll("'", "''")}'; ${cmd}`;
  const quote = v => `'${v.replaceAll("'", "'\\''")}'`;
  const value = dir === home ? '"$HOME"' : dir.startsWith(home + '/') ? `"$HOME"/${quote(dir.slice(home.length + 1))}` : quote(dir);
  return `${env}=${value} ${cmd}`;
}

function initialsOf(name) {
  const words = String(name).split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

function demo(accounts = 1, now = Date.now()) {
  const h = 3600e3, d = 24 * h;
  const w = (r5, t5, rw, tw) => [
    { label: '5 horas', minutes: 300, remaining: r5, reset: t5 && now + t5 },
    { label: 'Semanal', minutes: 10080, remaining: rw, reset: now + tw }];
  const list = [
    { id: 'claude:p', provider: 'claude', name: 'Principal', initials: 'P', ok: true, plan: 'max', windows: w(62, 2.3 * h, 81, 3.5 * d) },
    { id: 'codex:p', provider: 'codex', name: 'Principal', initials: 'P', ok: true, plan: 'plus', windows: w(12, 0.8 * h, 34, 5 * d) },
  ];
  if (accounts > 1) list.push(
    { id: 'claude:t', provider: 'claude', name: 'Trabalho', initials: 'TR', ok: true, plan: 'team', windows: w(100, null, 27, 1.2 * d) },
    { id: 'codex:t', provider: 'codex', name: 'Cliente Acme', initials: 'CA', ok: false, error: 'Login recusado. Entre novamente pelo CLI.' });
  return list;
}

// Falha com dados anteriores: mantém os números, marca como desatualizado e guarda o motivo.
function keepStale(prev, error, retryAfterMs) {
  if (!prev?.ok || !prev.windows) return null;
  return { ...prev, stale: true, error, staleSince: prev.staleSince ?? prev.fetchedAt ?? null, retryAfterMs };
}

// Espera progressiva de 5, 10, 20, 40 e até 60 minutos; o Retry-After do serviço vale se for maior.
function backoffMs(failures, retryAfterMs = 0) {
  return Math.max(retryAfterMs, Math.min(60, 5 * 2 ** Math.max(0, failures - 1)) * 60e3);
}

async function fetchAll(home, previous = [], config = {}) {
  const profiles = (await discoverProfiles(home, config)).filter(p => !p.hidden);
  const before = new Map(previous.map(a => [a.id, a]));
  return Promise.all(profiles.map(async ({ provider, dir, name, initials }) => {
    const base = { id: `${provider}:${dir}`, provider, name, initials };
    try { return { ...base, ok: true, fetchedAt: Date.now(), ...(await PROVIDERS[provider].read(dir)) }; }
    catch (e) {
      const stale = keepStale(before.get(base.id), e.message, e.retryAfterMs);
      return stale ?? { ...base, ok: false, error: e.message, retryAfterMs: e.retryAfterMs };
    }
  }));
}

module.exports = { keepStale, backoffMs, normalizeClaude, normalizeOpenAI, resetMs, profileName, initialsOf, loginCommand, discoverProfiles, fetchAll, demo };
