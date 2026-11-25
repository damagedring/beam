export function attachMobileQuantities({ element, hasReceipt, getRows, closeOverlays, virtualList }) {
  const trigger = element('mobileExpectedQuantities');
  const dialog = element('mobileQuantityDialog');
  const close = element('mobileQuantityClose');
  const title = element('mobileQuantityTitle');
  const summary = element('mobileQuantitySummary');
  const listId = 'mobileQuantityList';
  const list = element(listId);

  function update() {
    trigger.hidden = !hasReceipt();
    if (!dialog.open) return;
    if (trigger.hidden) {
      dialog.close();
      return;
    }
    title.textContent = element('questTitle').textContent;
    summary.textContent = element('questSummary').textContent;
    virtualList.set(listId, getRows());
  }

  trigger.onclick = () => {
    if (!hasReceipt() || dialog.open) return;
    closeOverlays();
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    update();
    close.focus({ preventScroll: true });
  };
  close.onclick = () => dialog.close();
  dialog.onclose = () => {
    virtualList.forget(listId);
    list.replaceChildren();
    trigger.setAttribute('aria-expanded', 'false');
    if (!trigger.hidden) trigger.focus({ preventScroll: true });
  };
  list.addEventListener('scroll', () => virtualList.render(listId));

  return update;
}
