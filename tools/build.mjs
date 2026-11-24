import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = join(root, 'src');
const destination = join(root, 'dist');
const files = Object.freeze([
  'index.html', 'app.js', 'import/workbook.js', 'domain/code128.js',
  'domain/search-keys.js', 'domain/reconcile.js', 'domain/scanner-input.js', 'ui/translations.js', 'vendor/xml-parser.js',
  'assets/pretendard-variable.woff2', 'assets/OFL-Pretendard.txt',
]);
const styles = ['styles/glass.css', 'styles/workspace.css'];

async function readSource(relative) {
  const file = join(source, relative);
  for (let path = file; path !== root; path = dirname(path)) {
    if ((await lstat(path)).isSymbolicLink()) throw Error(`Symbolic links are not build inputs: ${relative}`);
  }
  if (!(await lstat(file)).isFile()) throw Error(`Not a build input: ${relative}`);
  return readFile(file);
}

const stage = await mkdtemp(join(root, '.beam-dist-'));
try {
  for (const relative of files) {
    if (relative === 'index.html') continue;
    const file = join(stage, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, await readSource(relative));
  }
  const css = await Promise.all(styles.map(readSource));
  const stylesheet = Buffer.concat(css.flatMap((data) => [data, Buffer.from('\n')]));
  const revision = createHash('sha256').update(stylesheet).digest('hex').slice(0, 12);
  const markup = (await readSource('index.html')).toString('utf8');
  const stylesheetHref = 'href="./app.css"';
  if (!markup.includes(stylesheetHref)) throw Error('Missing Beam stylesheet reference');
  await writeFile(join(stage, 'index.html'), markup.replace(stylesheetHref, `href="./app.css?v=${revision}"`));
  await writeFile(join(stage, 'app.css'), stylesheet);
  await writeFile(join(stage, '.nojekyll'), '');
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
  console.log(`Built ${files.length + 2} allowlisted files in dist/.`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
