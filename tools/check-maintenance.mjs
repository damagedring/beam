import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from "node:path";
import { fileURLToPath } from 'node:url';
import { styleMetrics } from './style-metrics.mjs';

const root = new URL('../src/', import.meta.url);
const baselineFile = new URL('./maintenance-baseline.json', import.meta.url);
const paths = (await readdir(root, { recursive: true })).filter(name => name.endsWith('.css')).sort();
const css = Object.values(styleMetrics(new Map(await Promise.all(paths.map(async name =>
  [name, await readFile(join(fileURLToPath(root), name), 'utf8')])))));
const app = await readFile(new URL('app.js', root), 'utf8');
const metrics = {
  appLines: app.replace(/\n$/, '').split('\n').length,
  cssLines: css.reduce((sum, file) => sum + file.lines, 0),
  important: css.reduce((sum, file) => sum + file.important, 0),
  hex: css.reduce((sum, file) => sum + file.hex, 0),
  mediaWidths: new Set(css.flatMap(file => file.widths)).size,
};
const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
for (const [name, actual] of Object.entries(metrics)) {
  const cap = baseline[name];
  if (!Number.isSafeInteger(cap) || cap < 0) throw Error('Invalid maintenance cap: ' + name);
  if (actual > cap) {
    console.error(`${name}: ${actual} exceeds the baseline of ${cap}`);
    process.exitCode = 1;
  }
}
if (!process.exitCode) {
  if (process.argv.includes('--tighten')) await writeFile(baselineFile, JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify(metrics));
}
