import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'profiles');
const files = readdirSync(dir)
  .map(f => ({ f, m: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);
const file = join(dir, files[0].f);
const p = JSON.parse(readFileSync(file, 'utf8'));
const self = new Map();
const deltas = p.timeDeltas ?? [];
let total = 0;
for (let i = 0; i < (p.samples?.length ?? 0); i++) {
  const dt = deltas[i] ?? 1;
  const id = p.samples[i];
  self.set(id, (self.get(id) ?? 0) + dt);
  total += dt;
}
const ranked = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
console.log(`Profile: ${files[0].f} (${(total / 1000).toFixed(1)}ms sampled)\n`);
for (const [id, c] of ranked) {
  const n = p.nodes[id];
  if (!n) continue;
  const cf = n.callFrame;
  const loc = (cf.url ?? '').replace(/\\/g, '/').split('/').slice(-2).join('/');
  const pct = ((100 * c) / total).toFixed(1);
  console.log(`${pct.padStart(5)}%  ${cf.function || '(anon)'}  ${loc}:${cf.lineNumber ?? 0}`);
}
