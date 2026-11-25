import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = join(root, 'src');
const destination = join(root, 'dist');
const files = Object.freeze([
  'index.html', 'app.js', 'import/workbook.js', 'domain/code128.js', 'domain/product-identity.js', 'domain/product-labels.js', 'ui/product-label-print.js', 'ui/carton-workspace.js', 'ui/outbound-receipts.js', 'domain/carton-verification.js', 'domain/inspection-report.js',
  'domain/browser-recovery.js', 'domain/search-keys.js', 'domain/reconcile.js', 'domain/scan-history.js', 'domain/scanner-input.js', 'ui/translations.js', 'vendor/xml-parser.js',
  'assets/pretendard-variable.woff2', 'assets/OFL-Pretendard.txt',
]);
const styles = ['styles/status-colors.css', 'styles/glass.css', 'styles/workspace.css', 'styles/inspection-print.css', 'styles/product-labels.css', 'styles/carton-workspace.css', 'styles/touch-reels.css', 'styles/inspection-rail.css', 'styles/return-receipts.css', 'styles/scan-identity.css', 'styles/outbound-receipts.css'];

async function readSource(relative) {
  const file = join(source, relative);
  for (let path = file; path !== root; path = dirname(path)) {
    if ((await lstat(path)).isSymbolicLink()) throw Error(`Symbolic links are not build inputs: ${relative}`);
  }
  if (!(await lstat(file)).isFile()) throw Error(`Not a build input: ${relative}`);
  return readFile(file);
}

const jsSources=new Map(await Promise.all(files.filter(name=>name.endsWith('.js')).map(async name=>[name,await readSource(name)])));
const moduleDigest=createHash('sha256');
for(const [name,bytes] of jsSources){
  moduleDigest.update(JSON.stringify([name,bytes.length])).update(bytes);
}
const moduleRevision=moduleDigest.digest('hex').slice(0,12);

function versionModule(relative,bytes){
  return bytes.toString('utf8').replace(/^(import[^\r\n]+ from ["'])(\.\.?\/[^"'?#]+)(["'];?)/gm,
    (_,before,specifier,after)=>{
      // Module specifiers and the manifest use URL slash semantics on every OS.
      const target=posix.normalize(posix.join(posix.dirname(relative),specifier));
      if(!jsSources.has(target))throw Error('Missing local module: '+specifier);
      return before+specifier+'?v='+moduleRevision+after;
    });
}

const stage = await mkdtemp(join(root, '.beam-dist-'));
try {
  for (const relative of files) {
    if (relative === 'index.html') continue;
    const file = join(stage, relative);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, jsSources.has(relative) ? versionModule(relative,jsSources.get(relative)) : await readSource(relative));
  }
  const css = await Promise.all(styles.map(readSource));
  const stylesheet = Buffer.concat(css.flatMap((data) => [data, Buffer.from('\n')]));
  const revision = createHash('sha256').update(stylesheet).digest('hex').slice(0, 12);
  let markup = (await readSource('index.html')).toString('utf8');
  const entryScript='src="./app.js"';
  if(!markup.includes(entryScript))throw Error('Missing Beam entry script');
  markup=markup.replace(entryScript,`src="./app.js?v=${moduleRevision}"`);
  const driveExporter = process.env.BEAM_DRIVE_EXPORTER_ORIGIN ?? '';
  if (driveExporter) {
    const origin = new URL(driveExporter);
    const appOrigin = new URL(process.env.BEAM_APP_ORIGIN ?? '');
    if (origin.protocol !== 'https:' || origin.origin !== driveExporter || !/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(driveExporter) || appOrigin.protocol !== 'https:' || appOrigin.origin !== process.env.BEAM_APP_ORIGIN || appOrigin.origin === origin.origin) throw Error('Beam Drive export requires distinct canonical HTTPS origins');
    const marker = 'data-export-origin=""';
    if (!markup.includes(marker)) throw Error('Missing Beam Drive exporter field');
    markup = markup.replace(marker, `data-export-origin="${origin.origin}"`);
  }
  const oneDriveExporter = process.env.BEAM_ONEDRIVE_EXPORTER_ORIGIN ?? '';
  if(oneDriveExporter){
    const origin=new URL(oneDriveExporter),appValue=process.env.BEAM_APP_ORIGIN??'',appOrigin=new URL(appValue);
    if(origin.protocol!=='https:'||origin.origin!==oneDriveExporter||!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(oneDriveExporter)||appOrigin.protocol!=='https:'||appOrigin.origin!==appValue||origin.origin===appOrigin.origin||origin.origin===driveExporter)throw Error('Beam OneDrive export requires a distinct canonical HTTPS origin');
    const marker='data-one-drive-origin=""';
    if(!markup.includes(marker))throw Error('Missing Beam OneDrive exporter field');
    markup=markup.replace(marker,`data-one-drive-origin="${origin.origin}"`);
  }
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
