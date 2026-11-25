import { copyFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

const license = new URL('../LICENSE', import.meta.url);

export async function copyBeamLicense(destination) {
  if (!(await lstat(license)).isFile()) throw Error('LICENSE must be a regular file');
  await copyFile(license, join(destination, 'LICENSE.txt'));
}
