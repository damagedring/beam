import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { labelGeometry, styleMetrics } from './style-metrics.mjs';
import { localModuleTarget, moduleReferences } from './module-graph.mjs';

const root = process.argv[2] || 'src';
const names = (await readdir(root, { recursive: true })).sort();
const inputs = async extension => new Map(await Promise.all(names.filter(name => name.endsWith(extension))
  .map(async name => [name, await readFile(join(root, name), 'utf8')])));
const css = await inputs('.css');
const js = await inputs('.js');
const imports = [...js].flatMap(([filename, source]) => moduleReferences(source, filename)
  .map(({ n }) => [filename, localModuleTarget(filename, n)]));
const feature = name => name.startsWith('features/') ? name.split('/')[1] : null;
const dynamic = new Set([...js.values()].flatMap(source => [...source.matchAll(/\.setProperty\(\s*['"](--[\w-]+)/g)]
  .map(match => match[1])));
if (js.has('components/product-labels/view.js') || js.has('ui/product-label-print.js')) {
  for (const property of labelGeometry) dynamic.add(property);
}
console.log(JSON.stringify({
  styles: styleMetrics(css),
  dynamic: [...dynamic].sort(),
  modules: js.size,
  dependencyEdges: imports.length,
  crossFeatureImports: imports.filter(([from, to]) => feature(from) && feature(to) && feature(from) !== feature(to)),
}, null, 2));
