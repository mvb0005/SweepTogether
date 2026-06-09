/**
 * Capture a CPU flame graph while running representative backend load.
 *
 * Linux/macOS: Clinic.js (0x flame graph) — best native stack visibility.
 * Windows:     Node --cpu-prof + Speedscope HTML (Clinic/0x unsupported).
 *
 * Usage:
 *   cd backend && npm run profile:flame
 *   PROFILE_DURATION_SEC=30 npm run profile:flame
 *
 * Docker (matches prod Linux native addon):
 *   npm run profile:flame:docker
 */

import { spawn, spawnSync } from 'child_process';
import { mkdirSync, readdirSync, statSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROFILES_DIR = join(ROOT, 'profiles');
const PROFILE_PORT = parseInt(process.env.PROFILE_PORT ?? '3002', 10);
const MONGODB_URI =
  process.env.MONGODB_URI ??
  'mongodb://mongo_user:mongo_password@localhost:27017/minesweeper_infinite?authSource=admin';
const LOAD_SEC = parseInt(process.env.PROFILE_DURATION_SEC ?? '45', 10);
const SERVER_TS = join(ROOT, 'src/infrastructure/network/server.ts');
const SERVER_JS = join(ROOT, 'dist/infrastructure/network/server.js');
const USE_DIST = process.env.PROFILE_USE_DIST !== '0' && existsSync(SERVER_JS);
const LOAD_SCRIPT = join(ROOT, 'scripts/flame-load.mjs');
const USE_DOCKER = process.env.PROFILE_DOCKER === '1' || process.argv.includes('--docker');
const IS_WIN = process.platform === 'win32';

mkdirSync(PROFILES_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function waitForServer(url, timeoutMs) {
  return import('socket.io-client').then(({ io }) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tryConnect = () => {
        const socket = io(url, { transports: ['websocket'], reconnection: false, timeout: 3000 });
        const timer = setTimeout(() => {
          socket.close();
          if (Date.now() >= deadline) reject(new Error(`Server not ready at ${url}`));
          else setTimeout(tryConnect, 500);
        }, 4000);
        socket.on('connect', () => { clearTimeout(timer); socket.close(); resolve(); });
        socket.on('connect_error', () => {
          clearTimeout(timer);
          socket.close();
          if (Date.now() >= deadline) reject(new Error(`Server not ready at ${url}`));
          else setTimeout(tryConnect, 500);
        });
      };
      tryConnect();
    }),
  );
}

function serverArgs(extraNodeArgs = []) {
  if (USE_DIST) {
    return [...extraNodeArgs, SERVER_JS];
  }
  return [...extraNodeArgs, '-r', 'ts-node/register', SERVER_TS];
}

function spawnServer(extraNodeArgs = []) {
  return spawn('node', serverArgs(extraNodeArgs), {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PROFILE_PORT),
      MONGODB_URI,
      NODE_ENV: 'development',
      NODE_OPTIONS: '--max-old-space-size=4096',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function runLoad() {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [LOAD_SCRIPT], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PROFILE_PORT),
        PROFILE_DURATION_SEC: String(LOAD_SEC),
        PERF_BACKEND_URL: `http://localhost:${PROFILE_PORT}`,
      },
      stdio: 'inherit',
    });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`load exit ${code}`))));
  });
}

function newestMatching(dir, pred) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir)
    .filter(pred)
    .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.f ?? null;
}

async function profileWithCpuProf() {
  const stamp = Date.now();
  const profName = `sweeptogether-${stamp}.cpuprofile`;
  const profPath = join(PROFILES_DIR, profName);

  console.log('Using Node --cpu-prof (Windows / fallback path)\n');

  const server = spawnServer([`--cpu-prof`, `--cpu-prof-dir=${PROFILES_DIR}`, `--cpu-prof-name=${profName.replace('.cpuprofile', '')}`]);
  server.stdout?.on('data', d => process.stdout.write(d));
  server.stderr?.on('data', d => process.stderr.write(d));

  try {
    await waitForServer(`http://localhost:${PROFILE_PORT}`, 60000);
    console.log(`Server ready on :${PROFILE_PORT}\n`);
    await sleep(2000);
    await runLoad();
  } finally {
    server.kill('SIGINT');
    await sleep(4000);
    if (!server.killed) server.kill('SIGKILL');
  }

  let cpuprofile = existsSync(profPath) ? profPath : null;
  if (!cpuprofile) {
    const hit = newestMatching(PROFILES_DIR, f => f.endsWith('.cpuprofile') || f.startsWith('sweeptogether-'));
    cpuprofile = hit ? join(PROFILES_DIR, hit) : null;
  }

  if (!cpuprofile || !existsSync(cpuprofile)) {
    throw new Error('No .cpuprofile generated');
  }

  const htmlOut = join(PROFILES_DIR, `sweeptogether-${stamp}.speedscope.html`);
  const gen = spawnSync('npx', ['speedscope', '--help'], { cwd: ROOT, shell: true, encoding: 'utf8' });
  if (gen.stdout?.includes('-o') || gen.stderr?.includes('-o')) {
    spawnSync('npx', ['speedscope', cpuprofile, '-o', htmlOut], { cwd: ROOT, shell: true, stdio: 'inherit' });
    if (existsSync(htmlOut)) {
      console.log(`\nFlame graph (Speedscope): ${htmlOut}`);
      return htmlOut;
    }
  }

  console.log(`\nCPU profile saved: ${cpuprofile}`);
  console.log('View as flame graph: npx speedscope "' + cpuprofile + '"');
  console.log('Or drag the file into https://www.speedscope.app');
  return cpuprofile;
}

async function profileWithClinic() {
  const name = `sweeptogether-${Date.now()}`;
  const onPort = `node ${LOAD_SCRIPT}`;

  const args = [
    'clinic', 'flame',
    '--dest', PROFILES_DIR,
    '--name', name,
    '--open', 'false',
    '--on-port', onPort,
    '--',
    'node', ...serverArgs([]),
  ];

  console.log('Using Clinic.js flame (Linux/macOS path)\n');

  await new Promise((resolve, reject) => {
    const child = spawn('npx', args, {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PROFILE_PORT),
        MONGODB_URI,
        NODE_ENV: 'development',
        NODE_OPTIONS: '--max-old-space-size=4096',
        PROFILE_DURATION_SEC: String(LOAD_SEC),
      },
      shell: true,
      stdio: 'inherit',
    });
    child.on('exit', code => (code === 0 || code === null ? resolve() : reject(new Error(`clinic exit ${code}`))));
  });

  const dir = newestMatching(PROFILES_DIR, f => f.endsWith('.clinic-flame'));
  if (!dir) throw new Error('No .clinic-flame output');
  const indexHtml = join(PROFILES_DIR, dir, 'index.html');
  console.log(`\nFlame graph (Clinic): ${indexHtml}`);
  return indexHtml;
}

async function profileInDocker() {
  console.log('Profiling inside sweeptogether-backend-1 (Linux Clinic path)\n');

  const script = [
    'apk add --no-cache curl 2>/dev/null || true',
    `PORT=${PROFILE_PORT} MONGODB_URI="${MONGODB_URI.replace(/"/g, '\\"')}" PROFILE_DURATION_SEC=${LOAD_SEC} PERF_BACKEND_URL=http://127.0.0.1:${PROFILE_PORT} `,
    `npx clinic flame --dest /usr/src/app/profiles --open false --on-port "node scripts/flame-load.mjs" -- node -r ts-node/register src/infrastructure/network/server.ts`,
  ].join(' && ');

  const child = spawn('docker', [
    'compose', 'exec', '-T', 'backend', 'sh', '-lc', script,
  ], { cwd: resolve(ROOT, '..'), stdio: 'inherit', shell: true });

  await new Promise((resolve, reject) => {
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`docker exec exit ${code}`))));
  });

  const dir = newestMatching(PROFILES_DIR, f => f.endsWith('.clinic-flame'));
  if (dir) {
    console.log(`\nFlame graph: ${join(PROFILES_DIR, dir, 'index.html')}`);
  }
}

async function main() {
  console.log('SweepTogether backend flame profile');
  console.log(`  port:     ${PROFILE_PORT}`);
  console.log(`  mongo:    ${MONGODB_URI.replace(/:[^:@]+@/, ':***@')}`);
  console.log(`  load:     burst + sustained + fill (~${LOAD_SEC}s)`);
  console.log(`  output:   ${PROFILES_DIR}`);
  console.log(`  platform: ${process.platform}${USE_DOCKER ? ' (docker)' : ''}`);
  console.log(`  server:   ${USE_DIST ? 'dist (compiled)' : 'ts-node (dev)'}\n`);

  if (USE_DOCKER) {
    await profileInDocker();
    return;
  }

  if (IS_WIN) {
    await profileWithCpuProf();
  } else {
    try {
      await profileWithClinic();
    } catch {
      console.warn('Clinic failed — falling back to --cpu-prof\n');
      await profileWithCpuProf();
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
