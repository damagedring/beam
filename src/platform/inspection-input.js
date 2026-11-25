import { createScannerBurst } from '../domain/scanner-input.js';

const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role=textbox]';

export function createInspectionInput(doc, browser) {
  const returns = createScannerBurst(), carton = createScannerBurst();
  const lifecycle = new AbortController(), { signal } = lifecycle;
  const dialogOpen = () => !!doc.querySelector('dialog[open]');
  const modified = event => event.ctrlKey || event.altKey || event.metaKey || event.repeat;

  // Keep Carton in the bubbling phase so its own controls can handle Enter first.
  function bindCartons(route) {
    doc.addEventListener('keydown', event => {
      if (!route.visible() || dialogOpen() || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape' && route.back()) { event.preventDefault(); return; }
      if (!route.canScan() || event.target?.matches('input,select,textarea') || modified(event)) {
        carton.clear();
        return;
      }
      const value = carton.consume(event.key, performance.now());
      if (value) { event.preventDefault(); route.scan(value); }
    }, { signal });
    route.root.addEventListener('focusin', () => carton.clear(), { signal });
  }

  // Returns retains priority over normal keyboard handlers only for a complete burst.
  function bindReturns(route) {
    doc.addEventListener('keydown', event => {
      if (!route.canScan() || event.isComposing || event.keyCode === 229 || modified(event) || dialogOpen() ||
          event.composedPath().some(element => element.matches?.(editable))) {
        returns.clear();
        return;
      }
      const value = returns.consume(event.key, performance.now());
      if (!value) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      route.scan(value);
    }, { capture: true, signal });
    doc.addEventListener('focusin', () => returns.clear(), { signal });
    browser.addEventListener('blur', () => returns.clear(), { signal });
  }

  browser.addEventListener('pagehide', event => {
    if (!event.persisted) lifecycle.abort();
  }, { signal });
  return { bindCartons, bindReturns, clearCartons: () => carton.clear() };
}
