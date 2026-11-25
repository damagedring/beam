export function createPrintSession({ browser, document, root, nativeTarget }) {
  let active;

  function mount(target) {
    root.dataset.paper = target.paper;
    root.innerHTML = target.markup;
  }

  function reset() {
    if (!active) return;
    document.title = active.title;
    active.page?.remove();
    active = undefined;
  }

  function open(target, { title, size, defer = true, beforePrint, onError }) {
    if (active) return;
    let page;
    if (size) {
      page = document.createElement('style');
      page.textContent = `@page beam-product-label{size:${size.width}mm ${size.height}mm;margin:0}`;
      document.head.append(page);
    }
    mount(target);
    const session = { title: document.title, page };
    active = session;
    document.title = title;
    beforePrint?.();
    const print = () => {
      if (active !== session) return;
      try { browser.print(); }
      catch (error) { reset(); onError?.(error); }
    };
    if (defer && document.fonts?.ready) document.fonts.ready.then(print, print);
    else print();
  }

  browser.addEventListener('beforeprint', () => { if (!active) mount(nativeTarget()); });
  browser.addEventListener('afterprint', reset);
  return { open, busy: () => !!active };
}
