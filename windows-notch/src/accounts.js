// Contas cadastradas pelo usuário (sem credenciais): serviço, nome, diretório do perfil, iniciais e cor.
// Funções puras sobre listas, no mesmo modelo da extensão GNOME (services/accounts.js).
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_RESET_PROMPT = 'Responda apenas: OK.';
const SERVICES = ['claude', 'codex'];
const DEFAULT_DIR = { claude: '~\\.claude', codex: '~\\.codex' };
const PALETTE = ['#0A84FF', '#7D35D8', '#D6409F', '#E5484D', '#E07B00', '#1F9D55', '#0E9AA7', '#5B6B7F'];

function initialsFor(name) {
  const words = String(name).trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return '';
  const chars = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words.at(-1))[0]];
  return chars.join('').toLocaleUpperCase('pt-BR');
}
const cleanInitials = v => Array.from(String(v ?? '').trim().toLocaleUpperCase('pt-BR')).slice(0, 3).join('');

function expandPath(value, home = os.homedir()) {
  const p = String(value ?? '').trim();
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  if (!path.isAbsolute(p)) throw new Error('Use um diretório absoluto (como C:\\Users\\voce\\.claude) ou ~\\pasta.');
  return path.resolve(p);
}

function validateAccount(v, newId = () => crypto.randomUUID()) {
  if (!SERVICES.includes(v?.provider)) throw new Error('Escolha o serviço da conta.');
  const name = String(v.name ?? '').trim().slice(0, 80);
  if (!name) throw new Error('Informe o nome da conta.');
  const profilePath = String(v.profilePath ?? '').trim();
  expandPath(profilePath);
  if (!/^#[0-9a-f]{6}$/i.test(String(v.color ?? ''))) throw new Error('Use uma cor hexadecimal, por exemplo #0A84FF.');
  const resetPrompt = String(v.resetPrompt ?? DEFAULT_RESET_PROMPT).trim();
  if (!resetPrompt || resetPrompt.length > 2000) throw new Error('Use um prompt de 1 a 2000 caracteres.');
  const initials = cleanInitials(v.initials || initialsFor(name));
  if (!/^[\p{L}\p{N}]{1,3}$/u.test(initials)) throw new Error('Use de 1 a 3 letras ou números nas iniciais.');
  return {
    id: v.id || newId(), provider: v.provider, name, profilePath, initials, color: v.color,
    visible: v.visible !== false, autoResetMessage: v.autoResetMessage === true, resetPrompt,
  };
}

// Lê a lista guardada, descartando entradas inválidas e ids repetidos.
function cleanList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw.flatMap(v => {
    try {
      const a = validateAccount(v);
      if (seen.has(a.id)) return [];
      seen.add(a.id);
      return [a];
    } catch { return []; }
  });
}

function put(list, value) {
  const account = validateAccount(value);
  const i = list.findIndex(a => a.id === account.id);
  const key = x => x.provider + '|' + expandPath(x.profilePath).toLowerCase();
  if (list.some(x => x.id !== account.id && key(x) === key(account))) throw new Error('Já existe uma conta deste serviço com esse diretório.');
  return i < 0 ? [...list, account] : list.map((a, k) => (k === i ? account : a));
}
const remove = (list, id) => list.filter(a => a.id !== id);
function move(list, id, offset) {
  const from = list.findIndex(a => a.id === id), to = from + offset;
  if (from < 0 || to < 0 || to >= list.length) return list;
  const out = [...list];
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

// Cria a lista inicial a partir dos perfis que o app já detectava sozinho.
function fromProfiles(profiles, home = os.homedir()) {
  return profiles.map((p, i) => {
    const rel = path.relative(home, p.dir);
    const profilePath = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~\\${rel}` : p.dir;
    return validateAccount({
      provider: p.provider, name: p.name, profilePath, initials: p.initials,
      color: PALETTE[i % PALETTE.length], visible: true, autoResetMessage: false,
    });
  });
}

// Comando de PowerShell para entrar nesta conta, com o diretório como dado entre aspas simples.
function loginCommand(provider, profilePath, home = os.homedir()) {
  let dir;
  try { dir = expandPath(profilePath, home); } catch { return ''; }
  const q = `'${dir.replaceAll("'", "''")}'`;
  return provider === 'codex' ? `$env:CODEX_HOME=${q}; codex login` : `$env:CLAUDE_CONFIG_DIR=${q}; claude`;
}

module.exports = {
  DEFAULT_RESET_PROMPT, DEFAULT_DIR, PALETTE, initialsFor, cleanInitials, expandPath, validateAccount,
  cleanList, put, remove, move, fromProfiles, loginCommand,
};
