// Keyboard-wedge scanners often send a short burst ending in Enter.
// Outside the scan field, recognize only recognizably fast barcode-like bursts.
// Ordinary keystrokes and editable controls are not intercepted.
export function createScannerBurst({ minimum = 6, maximum = 128, interval = 45, endInterval = 110 } = {}) {
 let code = '', previous = -Infinity, started = 0;
 function clear() { code = ''; previous = -Infinity; }
 function consume(key, now) {
  const gap = now - previous;
  if (key === 'Enter') {
   const value = code.length >= minimum && /\d/.test(code) && gap >= 0 && gap <= endInterval &&
     (previous - started) / (code.length - 1) <= interval ? code : '';
   clear();
   return value;
  }
  if (!/^[A-Za-z0-9_./-]$/.test(key)) { clear(); return ''; }
  if (gap < 0 || gap > interval || code.length >= maximum) { clear(); started = now; }
  code += key;
  previous = now;
  return '';
 }
 return { consume, clear };
}
