import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attachMobileQuantities } from '../src/features/returns/quantities.js';

test('phone quantity sheet is safe on cold start and gives focus back to its trigger', () => {
  const nodes = new Map();
  let focused = null;
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {
      open: false,
      hidden: false,
      textContent: '',
      attributes: new Map(),
      events: new Map(),
      addEventListener(type, handler) { this.events.set(type, handler); },
      replaceChildren() { this.cleared = true; },
      focus() { focused = id; },
      setAttribute(key, value) { this.attributes.set(key, value); },
      showModal() { this.open = true; },
      close() { this.open = false; this.onclose(); },
    });
    return nodes.get(id);
  };
  let receipt = '';
  const rows = [{ sku: 'test' }];
  const lists = new Map();
  const rendered = [];
  let overlaysClosed = 0;
  const update = attachMobileQuantities({
    element,
    hasReceipt: () => Boolean(receipt),
    getRows: () => rows,
    closeOverlays: () => { overlaysClosed++; },
    virtualList: {
      set: (id, entries) => lists.set(id, entries),
      render: id => rendered.push(id),
      forget: id => lists.delete(id),
    },
  });
  const trigger = element('mobileExpectedQuantities');
  const dialog = element('mobileQuantityDialog');
  const close = element('mobileQuantityClose');
  const list = element('mobileQuantityList');
  update();
  assert(trigger.hidden);
  trigger.onclick();
  assert(!dialog.open);

  receipt = 'return-1';
  element('questTitle').textContent = 'Expected';
  element('questSummary').textContent = '0 / 1';
  update();
  assert(!trigger.hidden);
  trigger.onclick();
  assert(dialog.open);
  assert.equal(overlaysClosed, 1);
  assert.equal(focused, 'mobileQuantityClose');
  assert.equal(trigger.attributes.get('aria-expanded'), 'true');
  assert.equal(lists.get('mobileQuantityList'), rows);
  assert.equal(element('mobileQuantityTitle').textContent, 'Expected');
  assert.equal(element('mobileQuantitySummary').textContent, '0 / 1');
  list.events.get('scroll')();
  assert.deepEqual(rendered, ['mobileQuantityList']);

  close.onclick();
  assert(!dialog.open);
  assert.equal(trigger.attributes.get('aria-expanded'), 'false');
  assert.equal(focused, 'mobileExpectedQuantities');
  assert(list.cleared);
  assert(!lists.has('mobileQuantityList'));

  trigger.onclick();
  receipt = '';
  update();
  assert(!dialog.open);
  assert(trigger.hidden);
  assert.equal(focused, 'mobileQuantityClose');
  assert(!lists.has('mobileQuantityList'));
});
