// Mensagem curta enviada pelo CLI da conta quando a janela de 5 horas fica livre.
// Isso inicia a próxima janela. O prompt vai pela entrada padrão, nunca na linha de comando.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { expandPath } = require('./accounts');

const FIVE_H = [240, 360];
const RETRY_MS = 5 * 60e3;
const TIMEOUT_MS = 120e3;

const sessionWindow = u => u?.windows?.find(w => w.minutes >= FIVE_H[0] && w.minutes <= FIVE_H[1]);
// Uma mensagem pequena pode iniciar a janela mesmo quando o uso arredondado ainda mostra 100%.
const waiting = (w, now) => Boolean(w && w.minutes >= FIVE_H[0] && w.minutes <= FIVE_H[1] && (!Number.isFinite(w.reset) || w.reset <= now));

function shouldSendResetMessage(usage, lastAttempt = 0, now = Date.now()) {
  const w = sessionWindow(usage);
  // O Claude pode omitir a janela de 5 horas enquanto não há sessão ativa.
  if (w ? !waiting(w, now) : !usage?.windows?.length) return false;
  // Uma tentativa anterior pode ter iniciado a janela antes de o endpoint de uso refletir isso.
  return now - lastAttempt >= RETRY_MS;
}

// Argumentos fixos: o texto do usuário não aparece aqui. `mcp` é o arquivo de configuração vazio do Claude.
function messageCommand(provider, mcp = '') {
  if (provider === 'codex') return ['exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--sandbox', 'read-only',
    '-c', 'approval_policy=never', '-c', 'model_reasoning_effort=low', '-'];
  return ['--print', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--mcp-config', mcp,
    '--setting-sources', '', '--disable-slash-commands', '--permission-mode', 'dontAsk',
    '--system-prompt', 'Responda brevemente. Não use ferramentas.'];
}

// O app iniciado pelo menu Iniciar não herda o PATH do terminal.
function cliDirs(env = process.env, home = os.homedir()) {
  const extra = ['.local\\bin', '.bun\\bin', '.npm-global', '.volta\\bin', 'AppData\\Roaming\\npm', 'AppData\\Local\\pnpm'].map(d => path.join(home, d));
  return [...new Set([...(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean), ...extra])];
}
function findCli(name, dirs = cliDirs()) {
  for (const dir of dirs) for (const ext of ['.exe', '.cmd']) {
    const file = path.join(dir, name + ext);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* continua */ }
  }
  return null;
}

function cliFailure(provider, diagnostic, status) {
  const cli = provider === 'codex' ? 'Codex' : 'Claude';
  if (/not logged in|authentication|unauthorized|invalid.{0,20}token|login required|please.{0,20}log ?in|oauth.{0,30}expired/i.test(diagnostic))
    return `Login ${cli} inválido ou expirado. Entre novamente pelo CLI no perfil cadastrado.`;
  if (/model.{0,80}(not found|not available|not supported|does not exist|invalid)|invalid.{0,30}model/i.test(diagnostic))
    return `Modelo indisponível no ${cli}. Confira o modelo e o acesso da assinatura no CLI.`;
  if (/unknown option|unexpected argument|unrecognized option/i.test(diagnostic))
    return `CLI ${cli} incompatível com as opções de envio. Atualize o CLI.`;
  if (/usage limit|rate.limit|hit your limit|quota|limit reached/i.test(diagnostic))
    return `Limite de uso atingido no ${cli}. Aguarde a liberação da assinatura.`;
  return `O CLI ${cli} encerrou com código ${status}. Confira o login no perfil cadastrado.`;
}

const SECRET_ENV = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'OPENAI_BASE_URL', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDECODE'];

// Monta [executável, argumentos, opções]. Atalhos .cmd (npm) precisam do cmd.exe, com cada argumento entre aspas.
function launchSpec(exe, args) {
  if (!/\.(cmd|bat)$/i.test(exe)) return [exe, args, {}];
  const bad = [exe, ...args].find(a => /["%]/.test(a));
  if (bad) throw new Error('O caminho do CLI tem caracteres que não podem ser usados com segurança.');
  const line = [exe, ...args].map(a => `"${a}"`).join(' ');
  return [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsVerbatimArguments: true }];
}

async function sendResetMessage(account, { find = findCli, run = spawn } = {}) {
  const exe = find(account.provider === 'codex' ? 'codex' : 'claude');
  if (!exe) throw new Error(`CLI ${account.provider === 'codex' ? 'codex' : 'claude'} não encontrado. Instale-o ou coloque-o no PATH.`);
  // Pasta temporária vazia: o CLI não carrega instruções nem contexto de nenhum projeto.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aiqn-msg-'));
  try {
    const mcp = path.join(cwd, 'mcp.json');
    fs.writeFileSync(mcp, '{"mcpServers":{}}');
    const env = { ...process.env };
    for (const k of SECRET_ENV) delete env[k];
    env[account.provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] = expandPath(account.profilePath);
    const [file, args, opts] = launchSpec(exe, messageCommand(account.provider, mcp));
    await new Promise((resolve, reject) => {
      let diag = '', done = false;
      const child = run(file, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
      const end = fn => v => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
      const timer = setTimeout(() => { child.kill(); end(reject)(new Error('A mensagem automática excedeu 2 minutos.')); }, TIMEOUT_MS);
      const keep = d => { if (diag.length < 16384) diag += d.toString('utf8').slice(0, 16384 - diag.length); };
      child.stdout.on('data', keep); child.stderr.on('data', keep);
      child.on('error', end(() => reject(new Error('Não foi possível iniciar o CLI para enviar a mensagem automática.'))));
      child.on('close', end(code => (code === 0 ? resolve() : reject(new Error(cliFailure(account.provider, diag, code))))));
      child.stdin.on('error', () => {});
      child.stdin.end(account.resetPrompt);
    });
  } finally {
    // O CLI pode criar metadados locais; remove só a nossa pasta temporária.
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

module.exports = { sessionWindow, shouldSendResetMessage, messageCommand, cliDirs, findCli, cliFailure, launchSpec, sendResetMessage, RETRY_MS };
