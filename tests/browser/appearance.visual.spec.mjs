import { expect } from '@playwright/test';
import { chooseCarton, enterScan, loadCartons, returnsInspection, test } from './beam-fixture.mjs';

test('UX-28/30 desktop home and settings', async ({ beam: page }) => {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('home.png');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveScreenshot('settings.png');
});

test('UX-22/28 Returns inspection in both themes', async ({ beam: page }) => {
  await returnsInspection(page);
  await enterScan(page.locator('#barcode'), '0012345678901');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('returns-light.png');
  await page.locator('#theme').click();
  await expect(page).toHaveScreenshot('returns-dark.png');
});

test('UX-22/28 Outbound receipt, identity and label preview', async ({ beam: page }) => {
  await loadCartons(page, 'Outbound');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('outbound-receipts.png');
  await chooseCarton(page, 'OUT-1');
  await page.locator('#cartonStart').click();
  await enterScan(page.locator('#cartonScan'), '0001234567890');
  await expect(page).toHaveScreenshot('outbound-inspection.png');
  await page.locator('#cartonLabelTrigger').click();
  await expect(page).toHaveScreenshot('outbound-labels.png');
});

test.describe('touch viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('UX-26/28 coarse-pointer home and search', async ({ beam: page }) => {
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('phone-home.png');
    await page.getByRole('button', { name: /Returns/ }).tap();
    await expect(page.locator('#beamQuery')).not.toBeFocused();
    await expect(page).toHaveScreenshot('phone-search.png');
    await page.locator('#beamQuery').tap();
    await expect(page.locator('#beamQuery')).toBeFocused();
  });
});
