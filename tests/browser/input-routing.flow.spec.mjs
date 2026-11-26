import { expect } from '@playwright/test';
import { chooseCarton, loadCartons, returnsInspection, test } from './beam-fixture.mjs';

async function wedge(page, value) {
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
}

async function keydownBurst(target, value, options = {}) {
  return target.evaluate((element, { keys, options }) => keys.map(key => element.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }),
  )), { keys: [...value, 'Enter'], options });
}

async function expectIgnoredBursts(page, code, entries) {
  await wedge(page, 'manualtyping');
  await expect(entries).toHaveCount(0);

  const target = page.locator('body');
  for (const options of [{ ctrlKey: true }, { isComposing: true }, { repeat: true }]) {
    const uncancelled = await keydownBurst(target, code, options);
    expect(uncancelled.every(Boolean)).toBe(true);
    await expect(entries).toHaveCount(0);
  }
}

test('UX-08 Returns scanner ignores ordinary, modified, composing, repeating and modal key input', async ({ beam: page }) => {
  await returnsInspection(page, { singleOrder: true });
  const field = page.locator('#barcode');
  const entries = page.locator('#scanActivitySection [data-cell-state]');
  const code = '0012345678901';

  await field.blur();
  await expectIgnoredBursts(page, code, entries);

  await page.locator('#asnShare').click();
  const dialog = page.locator('#asnShareDialog');
  await expect(dialog).toBeVisible();
  expect((await keydownBurst(dialog, code)).every(Boolean)).toBe(true);
  await expect(entries).toHaveCount(0);
  await page.locator('#asnShareClose').click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => document.activeElement.blur());

  await wedge(page, code);
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toHaveAttribute('data-cell-state', 'accepted');
});

test('UX-08 Inventory scanner leaves the editable search field and ignored bursts alone', async ({ beam: page }) => {
  await loadCartons(page, 'Inventory');
  const field = page.locator('#cartonScan');
  const entries = page.locator('#cartonHistory [data-result]');
  const code = '0001234567890';

  const query = page.locator('#cartonQuery');
  await query.fill('');
  await wedge(page, code);
  await expect(query).toHaveValue(code);
  await expect(entries).toHaveCount(0);

  await chooseCarton(page, 'LOC-1');
  await expect(query).toBeHidden();
  await field.blur();
  await expectIgnoredBursts(page, code, entries);

  await wedge(page, code);
  await expect(field).toHaveValue('');
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toHaveAttribute('data-result', 'accepted');
});
