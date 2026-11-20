// Runs a workspace package's script directly: `node scripts/workspace.mjs <shared|api|web|all> <script> [args]`.
// Nested `pnpm -r` / `pnpm --filter` calls break on Windows when the user profile path contains spaces,
// so root scripts use this runner instead. Works the same on Windows, macOS and Linux.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = { shared: 'packages/shared', api: 'apps/api', web: 'apps/web' };
const [target, script, ...args] = process.argv.slice(2);
if (!target || !script || (target !== 'all' && !(target in packages))) {
  console.error('usage: node scripts/workspace.mjs <shared|api|web|all> <script> [args...]');
  process.exit(2);
}

function run(dir, command) {
  const cwd = join(root, dir);
  const bins = [join(cwd, 'node_modules', '.bin'), join(root, 'node_modules', '.bin')].filter(existsSync);
  const env = { ...process.env, PATH: [...bins, process.env.PATH ?? process.env.Path ?? ''].join(delimiter) };
  if (process.platform === 'win32') env.Path = env.PATH;
  return new Promise((done) => {
    const child = spawn([command, ...args.map((a) => JSON.stringify(a))].join(' '), { cwd, env, shell: true, stdio: 'inherit' });
    child.on('exit', (code, signal) => done(signal ? 1 : (code ?? 1)));
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => child.kill(sig));
  });
}

const order = target === 'all' ? Object.keys(packages) : [target];
for (const name of order) {
  const dir = packages[name];
  const pkg = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  const command = pkg.scripts?.[script];
  if (!command) {
    if (target === 'all') continue;
    console.error(`${pkg.name} has no "${script}" script`);
    process.exit(2);
  }
  if (target === 'all') console.info(`\n> ${pkg.name} ${script}`);
  const code = await run(dir, command);
  if (code !== 0) process.exit(code);
}
