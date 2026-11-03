const { test, expect } = require('bun:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const d = require('../src/linux-desktop');

const tmpEnv = () => ({ XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'ai-notch-autostart-')) });

test('desktopEntry cita caminhos com espaço e liga a janela ao app', () => {
  const e = d.desktopEntry(['/home/u/AppImages/ai quota.AppImage']);
  expect(e).toContain('Exec="/home/u/AppImages/ai quota.AppImage"\n');
  expect(e).toContain('StartupWMClass=ai-quota-notch\n');
  expect(e).toContain('X-GNOME-Autostart-enabled=true\n');
});

test('autostart liga, acompanha o caminho novo e desliga', () => {
  const env = tmpEnv(), file = d.autostartFile(env);
  d.refreshAutostart(['/a/app.AppImage'], env);
  expect(d.autostartEnabled(env)).toBe(false); // desligado: não cria nada

  d.setAutostart(true, ['/a/app.AppImage'], env);
  expect(fs.readFileSync(file, 'utf8')).toContain('Exec=/a/app.AppImage\n');
  d.refreshAutostart(['/b/app.AppImage'], env);
  expect(fs.readFileSync(file, 'utf8')).toContain('Exec=/b/app.AppImage\n');

  d.setAutostart(false, ['/b/app.AppImage'], env);
  expect(d.autostartEnabled(env)).toBe(false);
});
