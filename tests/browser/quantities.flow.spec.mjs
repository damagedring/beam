import { expect } from '@playwright/test';
import { enterScan, returnsInspection, test } from './beam-fixture.mjs';

test('UX-27 desktop F2 previews quantities without moving scanner focus', async ({ beam: page }) => {
  await returnsInspection(page, { singleOrder: true });
  const scan = page.locator('#barcode');
  const peek = page.locator('#questPeek');
  const count = peek.locator('.quest-count b');

  await page.keyboard.press('Shift+F2');
  await expect(peek).toBeHidden();
  await page.keyboard.down('F2');
  await expect(peek).toBeVisible();
  await expect(count).toHaveText(/0\s*\/\s*3/);
  await expect(scan).toBeFocused();
  await page.keyboard.up('F2');
  await expect(peek).toBeHidden();
  await expect(scan).toBeFocused();

  await enterScan(scan, '0012345678901');
  await page.keyboard.down('F2');
  await expect(count).toHaveText(/1\s*\/\s*3/);
  await page.keyboard.press('Escape');
  await expect(peek).toBeHidden();
  await expect(scan).toBeFocused();
  await page.keyboard.up('F2');
});

test.describe('touch viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('UX-27 phone quantity sheet virtualizes rows and resets on reopen', async ({ beam: page }) => {
    const trigger = page.locator('#mobileExpectedQuantities');
    await expect(trigger).toBeHidden();

    const receipt = 'PHONE-ORDER';
    const raw = Array.from({ length: 80 }, (_, index) => {
      const code = String(index + 1).padStart(3, '0');
      return { receipt, seller: 'Fictional store', external: 'P-01',
        barcode: '10' + code, sku: 'P-' + code, name: 'Product ' + code, qty: 3 };
    });
    await page.locator('#backup').setInputFiles({ name: 'phone-work.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, data: { raw, sku: [], loc: [] }, scans: [], receipt })) });

    const dialog = page.locator('#mobileQuantityDialog');
    const list = page.locator('#mobileQuantityList');
    const first = list.locator('[aria-posinset="1"]');
    const last = list.locator('[aria-posinset="80"]');
    await trigger.tap();
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#mobileQuantityClose')).toBeFocused();
    await expect(first).toHaveAttribute('aria-setsize', '80');
    await expect(first).toContainText('P-001');
    await expect(last).toHaveCount(0);

    await list.focus();
    await page.keyboard.press('End');
    await expect(last).toHaveAttribute('aria-setsize', '80');
    await expect(last).toContainText('P-080');
    await expect(first).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
    await expect(list.locator('li')).toHaveCount(0);

    await enterScan(page.locator('#barcode'), raw[0].barcode);
    await trigger.tap();
    await expect(first.locator('.quest-count b')).toHaveText(/1\s*\/\s*3/);
    await expect(last).toHaveCount(0);
    await page.locator('#mobileQuantityClose').tap();
    await expect(trigger).toBeFocused();
  });
});
