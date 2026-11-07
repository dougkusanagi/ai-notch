// Leitura dos limites de assinatura. Tokens ficam só em memória e nunca são registrados.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { expandPath } = require('./accounts');

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

// Perfis: o diretório padrão (ou a variável de ambiente) e irmãos com sufixo que tenham login.
async function discoverProfiles(home = os.homedir()) {
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
    for (const dir of dirs) out.push({ provider, dir, ...profileName(path.basename(dir), cfg.prefix) });
  }
  return out;
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// `providers` limita a consulta a alguns serviços. Serviços diferentes rodam em paralelo; as
// contas do mesmo serviço rodam em sequência, com pausa de `gapMs` (±50%) entre elas.
// `accounts` (lista cadastrada) substitui a detecção automática; contas ocultas não são consultadas.
async function fetchAll(home, previous = [], { providers, gapMs = 0, accounts } = {}) {
  const found = accounts
    ? accounts.filter(a => a.visible !== false).flatMap(a => {
      try { return [{ ...a, dir: expandPath(a.profilePath, home) }]; } catch { return []; }
    })
    : await discoverProfiles(home);
  const profiles = found.filter(p => !providers || providers.includes(p.provider));
  const before = new Map(previous.map(a => [a.id, a]));
  const one = async ({ id, provider, dir, name, initials, color }) => {
    const base = { id: id ?? `${provider}:${dir}`, provider, name, initials, ...(color && { color }) };
    try { return { ...base, ok: true, fetchedAt: Date.now(), ...(await PROVIDERS[provider].read(dir)) }; }
    catch (e) {
      const stale = keepStale(before.get(base.id), e.message, e.retryAfterMs);
      return stale ?? { ...base, ok: false, error: e.message, retryAfterMs: e.retryAfterMs };
    }
  };
  const groups = new Map();
  for (const p of profiles) groups.set(p.provider, [...(groups.get(p.provider) ?? []), p]);
  const done = await Promise.all([...groups.values()].map(async list => {
    const out = [];
    for (const [i, p] of list.entries()) {
      if (i && gapMs) await sleep(gapMs * (0.5 + Math.random()));
      out.push(await one(p));
    }
    return out;
  }));
  return done.flat();
}

module.exports = { keepStale, backoffMs, normalizeClaude, normalizeOpenAI, resetMs, profileName, discoverProfiles, fetchAll, demo };
