// Linux: início com o sistema via ~/.config/autostart. O Electron não implementa
// setLoginItemSettings no Linux. O atalho do menu vem do AppImage (o Gear Lever o cria).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DESKTOP_ID = 'ai-quota-notch';
const DESKTOP_FILE = `${DESKTOP_ID}.desktop`;

const configHome = env => env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const autostartFile = (env = process.env) => path.join(configHome(env), 'autostart', DESKTOP_FILE);

// Aspas conforme a especificação Desktop Entry, para caminhos com espaço.
const quote = a => /[\s"'\\$`]/.test(a) ? `"${a.replace(/(["\\$`])/g, '\\$1')}"` : a;

// cmd: [executável, ...argumentos]
function desktopEntry(cmd) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=AI Quota Notch',
    `Exec=${cmd.map(quote).join(' ')}`,
    `Icon=${DESKTOP_ID}`,
    'Terminal=false',
    `StartupWMClass=${DESKTOP_ID}`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

const autostartEnabled = (env = process.env) => fs.existsSync(autostartFile(env));

function setAutostart(on, cmd, env = process.env) {
  const file = autostartFile(env);
  if (!on) return fs.rmSync(file, { force: true });
  const content = desktopEntry(cmd);
  try { if (fs.readFileSync(file, 'utf8') === content) return; } catch { /* ainda não existe */ }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// O Gear Lever pode mover o AppImage; se o autostart estiver ligado, acompanha o caminho atual.
function refreshAutostart(cmd, env = process.env) {
  if (autostartEnabled(env)) setAutostart(true, cmd, env);
}

module.exports = { DESKTOP_ID, DESKTOP_FILE, autostartFile, desktopEntry, autostartEnabled, setAutostart, refreshAutostart };
