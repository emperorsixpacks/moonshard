// Writes the loading screen's markup into index.html between its two marker comments.
//   node scripts/inject-loader.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOADER_END, LOADER_START, loaderHtml } from '../src/ui/loaderMarkup.js';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const a = html.indexOf(LOADER_START);
const b = html.indexOf(LOADER_END);
if (a === -1 || b === -1) { console.error('index.html has no loader markers'); process.exit(1); }
fs.writeFileSync(file, `${html.slice(0, a + LOADER_START.length)}\n      ${loaderHtml()}\n      ${html.slice(b)}`);
console.log('loader markup written to index.html');
