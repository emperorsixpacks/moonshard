import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const upstream = process.argv[2] || (() => {
  const dir = mkdtempSync(join(tmpdir(), 'luna-'));
  execSync(`git clone --depth 1 https://github.com/JemIIahh/Luna-Blade.git ${dir}`, { stdio: 'ignore' });
  return dir;
})();

const packHashes = new Map();
for (const f of walk(join(upstream, 'extracted_assets'))) packHashes.set(sha(f), relative(upstream, f));

const rows = [];
for (const f of walk('public/assets')) {
  const rel = relative('.', f);
  const match = packHashes.get(sha(f));
  rows.push(match
    ? [rel, 'Anokolisa — Legacy Fantasy: High Forest 2.3', 'free; creator terms allow use in commercial projects (redistribution wording not verified)', 'matches pack / verify redistribution']
    : [rel, 'unknown, or re-cut from a pack (no byte match with the High Forest pack; no credit in the upstream repo)', 'unknown', 'PENDING']);
}

const pending = rows.filter((r) => r[3] === 'PENDING').length;
const table = ['| File | Source | Licence | Status |', '|---|---|---|---|', ...rows.map((r) => `| \`${r[0]}\` | ${r[1]} | ${r[2]} | ${r[3]} |`)].join('\n');
const block = `<!-- audit:start -->\n${rows.length} files audited, **${pending} pending**.\n\n${table}\n<!-- audit:end -->`;

let doc = readFileSync('docs/ATTRIBUTIONS.md', 'utf8');
doc = /<!-- audit:start -->[\s\S]*<!-- audit:end -->/.test(doc)
  ? doc.replace(/<!-- audit:start -->[\s\S]*<!-- audit:end -->/, block)
  : `${doc.trim()}\n\n${block}\n`;
writeFileSync('docs/ATTRIBUTIONS.md', doc);
console.log(`audited ${rows.length} files; ${pending} pending`);
