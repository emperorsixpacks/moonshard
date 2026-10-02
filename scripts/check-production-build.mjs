// Builds the game for production into a temporary folder and checks the shipped JavaScript for what must not be in it
// (the development-only gate bypass and everything from the local test launcher: the stand-in face scan and the test wallet)
// and for what must be (GoodDollar's real face-verification code). The face-scan exemption of `npm run dev:local` lives only
// in the launcher's own dev server; this is the check that it cannot reach a build.
//   npm run test:build
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';

const ROOT = new URL('../', import.meta.url).pathname;
const MUST_NOT_CONTAIN = ['__MS_GATE_OFF', '__MS_LOCAL_DEV', 'isMoonshardLocalDev', 'Pass the face scan', '/face-scan?', 'LOCAL TEST'];
const MUST_CONTAIN = ['generateFVLink'];

async function jsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const dir = await mkdtemp(path.join(tmpdir(), 'moonshard-build-'));
let failed = false;
try {
  await build({ root: ROOT, logLevel: 'error', build: { outDir: dir, emptyOutDir: true, sourcemap: false } });
  const files = await jsFiles(dir);
  const code = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
  console.log(`built ${files.length} JavaScript files (${(code.length / 1e6).toFixed(1)} MB)`);
  for (const marker of MUST_NOT_CONTAIN) {
    const present = code.includes(marker);
    if (present) failed = true;
    console.log(`  ${present ? '✗' : '✓'} the build ${present ? 'CONTAINS' : 'does not contain'} "${marker}"`);
  }
  for (const marker of MUST_CONTAIN) {
    const present = code.includes(marker);
    if (!present) failed = true;
    console.log(`  ${present ? '✓' : '✗'} the build ${present ? 'contains' : 'is MISSING'} "${marker}" (the real face-verification code)`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
if (failed) {
  console.error('\n❌ production build check failed');
  process.exit(1);
}
console.log('\n✅ the production build has the real face check and none of the local test tooling');
