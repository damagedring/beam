import { expect } from '@playwright/test';
import { chooseCarton, enterScan, loadCartons, loadReturnsFixture, openReturnsFixtureOrder, test } from './beam-fixture.mjs';

async function loadReturnsAppearance(page) {
  await loadReturnsFixture(page);
  // Open Returns from Home with unsaved work, matching the recorded view.
  const availability = page.locator('#availabilityToggle');
  await availability.press('Space');
  await availability.press('Space');
  await page.locator('#beamHomeBack').press('Space');
  await page.getByRole('button', { name: /Returns/ }).press('Space');
}

test('UX-28/30 desktop home and settings', async ({ beam: page }) => {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('home.png');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveScreenshot('settings.png');
});

test('UX-22/28 Returns inspection in both themes', async ({ beam: page }) => {
  await loadReturnsAppearance(page);
  await openReturnsFixtureOrder(page);
  await enterScan(page.locator('#barcode'), '0012345678901');
  await page.locator('#beamWorkName').hover();
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('returns-light.png');
  await page.locator('#theme').click();
  await expect(page).toHaveScreenshot('returns-dark.png');
});

test('UX-22/28 Outbound receipt, identity and label preview', async ({ beam: page }) => {
  await loadCartons(page, 'Outbound');
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('outbound-receipts.png');
  await page.locator('.outbound-carton').filter({hasText:'BOX-1'}).first().click();
  await enterScan(page.locator('#cartonScan'), '0001234567890');
  await expect(page).toHaveScreenshot('outbound-inspection.png');
  await page.locator('#cartonLabelTrigger').click();
  await expect(page).toHaveScreenshot('outbound-labels.png');
  await page.locator('#productLabelClose').click();
  // The close handler clears the preview and returns focus before scanning resumes.
  await expect(page.locator('#productLabelPreview')).toBeEmpty();
  for (let i = 0; i < 3; i++) await enterScan(page.locator('#cartonScan'), '0001234567890');
  await enterScan(page.locator('#cartonScan'), 'fictional-unknown');
  await expect(page.locator('#cartonMeter')).toHaveAttribute('data-phase', 'excess');
  await expect(page.locator('#cartonMeter')).toHaveCSS('color', await page.locator('#outboundOrderMeter').evaluate(m => getComputedStyle(m).color));
  await expect(page.locator('#cartonProgressMarkers button')).toHaveCount(1);
  await expect(page.locator('#cartonCount')).toContainText('초과 1 + 확인 필요 1');
  await expect(page).toHaveScreenshot('outbound-excess.png');
  await page.locator('#theme').click();
  await expect(page).toHaveScreenshot('outbound-excess-dark.png');
});

test.describe('1280 × 720 viewport', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('UX-24/25 Returns paper and folder presentation at working width', async ({ beam: page }) => {
    await loadReturnsAppearance(page);
    const query = page.locator('#beamQuery');
    await query.fill('가상 거래처');
    await expect(query).toBeFocused();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('returns-folders.png');
    await query.press('Enter');
    await page.locator('#beamFolderReceiptOpen').press('Space');
    await expect(page.locator('#beamFolderReceiptDialog')).toBeVisible();
    await expect(page).toHaveScreenshot('returns-folder-receipt.png');
    await page.keyboard.press('Escape');
    await expect(page.locator('#beamFolderReceiptOpen')).toBeFocused();
  });
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

  test('UX-27 phone quantity sheet keeps its own focus and progress roles', async ({ beam: page }) => {
    await expect(page.locator('#mobileExpectedQuantities')).toBeHidden();
    const data = { raw: [{ receipt: 'PHONE-ORDER', seller: '가상 센터', external: 'P-01',
      barcode: '00001', sku: 'P-001', name: '가상 상품 · A deliberately long product name for the quantity sheet', qty: 3 }], sku: [], loc: [] };
    await page.locator('#backup').setInputFiles({ name: 'phone-work.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, data, scans: [], receipt: 'PHONE-ORDER' })) });
    const trigger = page.locator('#mobileExpectedQuantities');
    await trigger.tap();
    await expect(page.locator('#mobileQuantityClose')).toBeFocused();
    await expect(page.locator('#mobileQuantityList')).toContainText('P-001');
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot('phone-quantities.png');
    await page.locator('#mobileQuantityClose').tap();
    await expect(trigger).toBeFocused();
  });
});
