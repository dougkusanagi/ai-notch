// Gera e instala a versão atual do notch no sistema em que o comando roda.
// Windows: instalador NSIS em modo silencioso. Linux: AppImage em ~/AppImages.
import { spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  if (r.error) throw r.error;
  return r.status ?? 1;
}
function must(cmd, args, opts) {
  const code = run(cmd, args, opts);
  if (code !== 0) { console.error(`Falhou: ${cmd} ${args.join(' ')}`); process.exit(code); }
}

if (process.platform === 'win32') {
  must('bun', ['run', 'dist']);
  const setup = readdirSync(out).filter((f) => /^AI Quota Notch Setup .*\.exe$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  if (!setup) { console.error('Instalador não encontrado em out/.'); process.exit(1); }
  run('taskkill', ['/IM', 'AI Quota Notch.exe', '/F'], { stdio: 'ignore' });
  must(join(out, setup), ['/S']);
  console.log(`Instalado: ${setup}`);
} else if (process.platform === 'linux') {
  must('bun', ['run', 'dist:linux']);
  const image = readdirSync(out).filter((f) => /^ai-quota-notch-.*-x86_64\.AppImage$/.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
  if (!image) { console.error('AppImage não encontrado em out/.'); process.exit(1); }
  const dest = join(homedir(), 'AppImages');
  mkdirSync(dest, { recursive: true });
  run('pkill', ['-f', 'ai-quota-notch.*AppImage'], { stdio: 'ignore' });
  for (const f of readdirSync(dest)) {
    if (/^ai-quota-notch-.*\.AppImage$/.test(f) && f !== image) rmSync(join(dest, f));
  }
  copyFileSync(join(out, image), join(dest, image));
  chmodSync(join(dest, image), 0o755);
  console.log(`Instalado: ${join(dest, image)}\nAbra pelo menu ou rode o AppImage.`);
} else {
  console.error(`Sistema não suportado: ${process.platform}`);
  process.exit(1);
}
