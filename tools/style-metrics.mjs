const occurrences = (source, pattern) => [...source.matchAll(pattern)];
const withoutComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '');

export const labelGeometry = new Set([
  '--bars-ideal', '--label-code-height', '--label-cols', '--label-h', '--label-name-size',
  '--label-ref-cols', '--label-w', '--paper-inset', '--paper-w',
]);

export function styleMetrics(entries) {
  const all = withoutComments([...entries.values()].join('\n'));
  const defined = new Set(occurrences(all, /(?:^|[;{])\s*(--[\w-]+)\s*:/g).map(match => match[1]));
  const result = {};
  for (const [filename, source] of entries) {
    const css = withoutComments(source);
    const uses = new Set(occurrences(css, /\bvar\(\s*(--[\w-]+)/g).map(match => match[1]));
    const widths = new Set(occurrences(css, /@media\s*([^{}]+)/g).flatMap(([, query]) =>
      occurrences(query, /\b(?:min-|max-)?width\s*:\s*([\d.]+(?:px|em|rem))/g).map(match => match[1])));
    result[filename] = {
      lines: source.replace(/\n$/, '').split('\n').length,
      important: occurrences(css, /!\s*important\b/gi).length,
      hex: occurrences(css, /#(?:[a-f\d]{8}|[a-f\d]{6}|[a-f\d]{4}|[a-f\d]{3})(?![\w-])/gi).length,
      widths: [...widths].sort(),
      undefined: [...uses].filter(name => !defined.has(name)).sort(),
    };
  }
  return result;
}

export function checkStyleReferences(entries) {
  const managed = ['components/', 'features/', 'styles/tokens/', 'styles/receipt-paper.css'];
  const ownership = [
    [/#productLabel[\w-]*\b|\.product-label(?:[\w-]*)\b/, ['components/product-labels/view.css']],
    [/#mobileQuantity[\w-]*\b|#mobileExpectedQuantities\b/, ['features/returns/quantities.css']],
    [/#printReport\b/, ['components/print/inspection-report.css', 'components/product-labels/view.css']],
    [/\.scan-brand-badge\b/, ['components/product-identity/view.css']],
  ];
  for (const [filename, source] of entries) {
    for (const [pattern, owners] of ownership) {
      if (!owners.includes(filename) && pattern.test(withoutComments(source))) {
        throw Error(`${filename}: selector belongs in ${owners.join(' or ')}`);
      }
    }
  }
  for (const [filename, metrics] of Object.entries(styleMetrics(entries))) {
    if (!managed.some(prefix => filename.startsWith(prefix))) continue;
    const unresolved = metrics.undefined.filter(name => filename !== 'components/product-labels/view.css' || !labelGeometry.has(name));
    if (unresolved.length) throw Error(`${filename}: unresolved custom properties ${unresolved.join(', ')}`);
  }
}
