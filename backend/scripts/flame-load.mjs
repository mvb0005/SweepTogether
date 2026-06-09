/**
 * Workload runner for flame profiling — failures on optional scenarios are non-fatal.
 */
import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = process.env.PORT ?? '3002';
const BACKEND_URL = process.env.PERF_BACKEND_URL ?? `http://localhost:${PORT}`;
const LOAD_SEC = parseInt(process.env.PROFILE_DURATION_SEC ?? '30', 10);

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: ROOT,
      env: { ...process.env, PERF_BACKEND_URL: BACKEND_URL, ...env },
      shell: true,
      stdio: 'inherit',
    });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
}

async function tryRun(label, args, env = {}) {
  try {
    await run(args, env);
  } catch (err) {
    console.warn(`[flame-load] ${label} skipped: ${err.message}`);
  }
}

async function main() {
  console.log(`\n[flame-load] backend=${BACKEND_URL} duration~${LOAD_SEC}s\n`);

  await tryRun('burst', ['run', 'perf:chunks:burst'], {
    PERF_CHUNK_COUNT: '400',
    PERF_SKIP_PERSIST_CHECK: '1',
  });

  await tryRun('sustained', ['run', 'perf:chunks:sustained'], {
    PERF_DURATION_SEC: String(Math.max(10, LOAD_SEC - 10)),
    PERF_MIN_FILL_CELLS: '100',
    PERF_SKIP_PERSIST_CHECK: '1',
    PERF_SKIP_FILL: '1',
  });

  await tryRun('fill', ['run', 'perf:chunks:fill'], {
    PERF_FILL_GAME_ID: '',
    PERF_MIN_FILL_CELLS: '100',
    PERF_SKIP_PERSIST_CHECK: '1',
  });

  console.log('\n[flame-load] done — profiler will finalize.\n');
}

main().catch(err => {
  console.error('[flame-load]', err);
  process.exit(1);
});
