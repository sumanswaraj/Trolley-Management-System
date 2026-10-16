import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as util from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function npmCli(environment) {
  const candidates = [
    environment.npm_execpath,
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  for (const directory of (environment.PATH || environment.Path || '').split(delimiter)) {
    if (!directory) continue;
    candidates.push(join(directory, 'node_modules/npm/bin/npm-cli.js'));
    const executable = join(directory, 'npm');
    if (existsSync(executable)) candidates.push(realpathSync(executable));
  }
  const filename = candidates.find(
    (candidate) => candidate && basename(candidate) === 'npm-cli.js' && existsSync(candidate),
  );
  if (!filename) throw new Error('npm is missing. Install Node.js 24 or later, including npm.');
  return filename;
}

export function prepareLocal({
  root = projectRoot,
  environment = process.env,
  install = true,
} = {}) {
  if (Number(process.versions.node.split('.')[0]) < 24)
    throw new Error('Node.js 24 or later is required. Install it, then run this launcher again.');
  const filename = join(root, '.env');
  let created = false;
  if (!existsSync(filename)) {
    writeFileSync(
      filename,
      `ADMIN_PASSWORD=${randomBytes(24).toString('hex')}\nHOST=127.0.0.1\nPORT=8080\nSECURE_COOKIE=false\nDEVICE_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    created = true;
  }
  const configured = { ...util.parseEnv(readFileSync(filename, 'utf8')), ...environment };
  if (
    !configured.ADMIN_PASSWORD ||
    configured.ADMIN_PASSWORD.length < 12 ||
    configured.ADMIN_PASSWORD.length > 256
  )
    throw new Error(
      'Set ADMIN_PASSWORD in .env to 12–256 characters, then run the launcher again. Existing settings were preserved.',
    );
  if (configured.DEVICE_ENCRYPTION_KEY && !/^[a-f0-9]{64}$/i.test(configured.DEVICE_ENCRYPTION_KEY))
    throw new Error(
      'DEVICE_ENCRYPTION_KEY in .env must be empty or contain 64 hexadecimal characters.',
    );
  if (install) {
    const stateDirectory = join(root, '.local-run');
    const stateFile = join(stateDirectory, 'install-state.json');
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const fingerprint = createHash('sha256')
      .update(readFileSync(join(root, 'package-lock.json')))
      .update(process.versions.node.split('.')[0])
      .digest('hex');
    let installed;
    try {
      installed = JSON.parse(readFileSync(stateFile, 'utf8'));
    } catch {}
    const require = createRequire(join(root, 'package.json'));
    const dependenciesPresent = Object.keys(manifest.dependencies || {}).every((name) => {
      try {
        require.resolve(name);
        return true;
      } catch {
        return false;
      }
    });
    if (installed?.fingerprint !== fingerprint || !dependenciesPresent) {
      mkdirSync(stateDirectory, { recursive: true });
      console.log('Installing the pinned application dependencies…');
      const result = spawnSync(
        process.execPath,
        [
          npmCli(configured),
          'ci',
          '--omit=dev',
          '--ignore-scripts',
          '--no-fund',
          '--cache',
          join(stateDirectory, 'npm-cache'),
        ],
        { cwd: root, env: configured, stdio: 'inherit' },
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(
          'Dependency installation failed. Check the npm output above and run the launcher again.',
        );
      writeFileSync(stateFile, JSON.stringify({ fingerprint }) + '\n');
    }
  }
  return { root, environment: configured, created };
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes('--help')) {
    console.log(
      'Usage: node scripts/start-local.mjs [--demo] [--setup-only]\nStarts the local app, or the separate sample plant with --demo.',
    );
    return;
  }
  if (arguments_.some((argument) => !['--demo', '--setup-only'].includes(argument)))
    throw new Error(
      'Unknown option. Use --demo for sample data or --setup-only to prepare without starting.',
    );
  const prepared = prepareLocal();
  if (prepared.created) console.log('Created private local settings in .env.');
  console.log(
    'Sign in as admin using ADMIN_PASSWORD from .env. Existing accounts retain their original password.',
  );
  if (arguments_.includes('--setup-only')) {
    console.log('Local setup is ready. Run the launcher again to start the app.');
    return;
  }
  const demo = arguments_.includes('--demo');
  console.log(
    demo
      ? 'Starting the isolated sample plant. Normal plant data is separate.'
      : 'Starting the local plant workspace.',
  );
  console.log('Keep this window open. Press Ctrl+C to stop.');
  const child = spawn(
    process.execPath,
    [join(prepared.root, demo ? 'scripts/demo.mjs' : 'server.mjs')],
    { cwd: prepared.root, env: prepared.environment, stdio: 'inherit' },
  );
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => resolveExit(signal ? 0 : (status ?? 1)));
  });
  process.off('SIGINT', interrupt);
  process.off('SIGTERM', terminate);
  process.exitCode = code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
