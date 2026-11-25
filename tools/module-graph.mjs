import { init, parse } from 'es-module-lexer/minimal';
import { posix } from 'node:path';

await init();

export function moduleReferences(source, filename) {
  return parse(source, filename)[0].filter(reference => reference.d !== -2);
}

export function localModuleTarget(filename, specifier) {
  if (!/^(?:\.\.\/|\.\/)[a-zA-Z0-9_./-]+\.js$/.test(specifier ?? '')) {
    throw Error(`${filename}: expected a literal, unversioned relative JavaScript import, got ${specifier}`);
  }
  return posix.normalize(posix.join(posix.dirname(filename), specifier));
}

export function checkDependency(filename, target) {
  if (filename.startsWith('domain/') && !target.startsWith('domain/')) {
    throw Error(`${filename}: domain modules may only import other domain modules (${target})`);
  }
  if (filename.startsWith('features/') && target.startsWith('features/')) {
    const feature = path => path.split('/')[1];
    if (feature(filename) !== feature(target)) throw Error(`${filename}: cross-feature import of ${target}`);
  }
}

export function versionModule(filename, source, sources, revision) {
  const references = moduleReferences(source, filename);
  let rewritten = source;
  for (const { n, s, e, d } of [...references].reverse()) {
    const target = localModuleTarget(filename, n);
    if (!sources.has(target)) throw Error(`${filename}: missing allowlisted module ${n}`);
    checkDependency(filename, target);
    const versioned = `${n}?v=${revision}`;
    rewritten = rewritten.slice(0, s) + (d >= 0 ? JSON.stringify(versioned) : versioned) + rewritten.slice(e);
  }
  return rewritten;
}
