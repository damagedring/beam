import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { versionModule } from './module-graph.mjs';
import { checkStyleReferences } from './style-metrics.mjs';
import { copyBeamLicense } from './copy-license.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const source = join(root, 'src');
const destination = join(root, 'dist');
const exampleModule = 'features/examples/cry-later-assets.js';
const files = Object.freeze([
  'index.html', 'app.js', exampleModule, 'app/navigation.js', 'import/workbook.js', 'import/mapping/profiles.js', 'domain/code128.js', 'domain/product-identity.js', 'domain/product-labels.js', 'components/product-labels/view.js', 'features/cartons/workspace.js', 'features/cartons/model.js', 'features/cartons/outbound-receipts.js', 'domain/carton-verification.js', 'domain/expected-inventory-status.js', 'domain/original-order-lookup.js', 'features/cartons/outbound-cartons.js', 'features/cartons/reference.js', 'ui/notice-strip.js','components/folder-reel/view.js',
  'components/product-identity/view.js', 'components/print/barcode.js', 'components/print/inspection-report.js',
  'features/returns/quantities.js', 'components/inspection-progress/view.js', 'features/returns/recovery.js', 'features/returns/scan-commands.js', 'platform/indexed-recovery.js', 'platform/inspection-input.js', 'platform/print.js', 'platform/scan-audio.js', 'platform/reference-fingerprint.js', 'domain/search-keys.js', 'domain/reconcile.js', 'domain/return-report.js', 'domain/scan-history.js', 'domain/scanner-input.js', 'ui/translations.js', 'vendor/xml-parser.js',
  'assets/pretendard-variable.woff2', 'assets/OFL-Pretendard.txt',
  'assets/geist-variable.woff2', 'assets/OFL-Geist.txt',
  'assets/source-code-pro.woff2', 'assets/OFL-SourceCodePro.txt',
]);
const styles = ['styles/layers.css', 'styles/tokens/status.css', 'styles/tokens/typography.css', 'styles/tokens/controls.css', 'styles/glass.css', 'styles/workspace.css', 'features/returns/console.css', 'styles/receipt-paper.css', 'features/returns/quantities.css', 'features/returns/original-order.css', 'components/print/inspection-report.css', 'components/product-labels/view.css', 'features/cartons/workspace.css', 'styles/touch-reels.css', 'styles/inspection-rail.css', 'features/returns/receipts.css', 'components/product-identity/view.css', 'features/cartons/outbound-receipts.css'];

async function readSource(relative) {
  const file = join(source, relative);
  for (let path = file; path !== root; path = dirname(path)) {
    if ((await lstat(path)).isSymbolicLink()) throw Error(`Symbolic links are not build inputs: ${relative}`);
  }
  if (!(await lstat(file)).isFile()) throw Error(`Not a build input: ${relative}`);
  return readFile(file);
}

// Bundle the exact example files as a lazy script so the default CSP can keep connections disabled.
const [exampleWorkbook, exampleProfile] = await Promise.all([
  readSource('features/examples/cry-later-demo.xlsx'),
  readSource('features/examples/cry-later-profile.json'),
]);
const exampleBytes = Buffer.from(
  'export const workbookBase64 = ' + JSON.stringify(exampleWorkbook.toString('base64')) + ';\n' +
  'export const profileText = ' + JSON.stringify(exampleProfile.toString('utf8')) + ';\n',
);
const jsSources=new Map(await Promise.all(files.filter(name=>name.endsWith('.js')).map(async name=>[
  name, name===exampleModule ? exampleBytes : await readSource(name),
])));
const moduleDigest=createHash('sha256');
for(const [name,bytes] of jsSources){
  moduleDigest.update(JSON.stringify([name,bytes.length])).update(bytes);
}
const moduleRevision=moduleDigest.digest('hex').slice(0,12);

const stage = await mkdtemp(join(root, '.beam-dist-'));
try {
  for (const relative of files) {
    if (relative === 'index.html') continue;
    const file = join(stage, relative);
    await mkdir(dirname(file), { recursive: true });
    const modules = jsSources.get(relative);
    await writeFile(file, modules ? versionModule(relative, modules.toString('utf8'), jsSources, moduleRevision) : await readSource(relative));
  }
  const css = await Promise.all(styles.map(readSource));
  checkStyleReferences(new Map(styles.map((name, i) => [name, css[i].toString('utf8')])));
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
  await copyBeamLicense(stage);
  await rm(destination, { recursive: true, force: true });
  await rename(stage, destination);
  console.log(`Built ${files.length + 3} allowlisted files in dist/.`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
