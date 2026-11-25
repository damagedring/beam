import { expect } from '@playwright/test';
import { chooseCarton, enterScan, loadCartons, returnsInspection, test } from './beam-fixture.mjs';

async function interceptPrint(page) {
  await page.evaluate(() => {
    // Mount and render the actual print target without blocking on the native dialog.
    window.print = () => document.dispatchEvent(new Event('beam-test-print'));
    document.addEventListener('beam-test-print', () => { window.printRequested = true; });
  });
}

test('UX-31 Returns comparison, history and native print retain both identifiers and quantity', async ({ beam: page }, info) => {
  await returnsInspection(page);
  await enterScan(page.locator('#barcode'), '0012345678901');
  await interceptPrint(page);
  const report = page.locator('#printReport');
  const originalTitle = await page.title();
  for (const [action, title] of [['print', 'Return Inspection Report'], ['evidence', 'Return Inspection Scan History']]) {
    await page.locator('#asnShare').click();
    await page.locator('#'+action).click();
    await expect.poll(() => page.evaluate(() => window.printRequested)).toBe(true);
    await expect(report.locator('h1')).toHaveText(title);
    await expect(report.locator('[aria-label="Code 128 · DEMO-001"]')).toHaveCount(1);
    await expect(report.locator('.pr-brand')).toContainText('EX-01');
    await expect(report.locator('.pr-label-work')).toContainText('B2B');
    if (action === 'print') {
      await expect(report.locator('tfoot td').nth(3)).toHaveText('5');
      await expect(report.locator('tfoot td').nth(4)).toHaveText('1');
      await page.pdf({ path: info.outputPath('returns.pdf'), preferCSSPageSize: true });
    }
    await page.evaluate(() => { window.printRequested = false; window.dispatchEvent(new Event('afterprint')); });
    await expect(page).toHaveTitle(originalTitle);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(report.locator('h1')).toHaveText('Return Inspection Report');
});

test('UX-32/33 Outbound shipment summary stays separate from scoped, rotated A4 labels', async ({ beam: page }, info) => {
  await loadCartons(page, 'Outbound');
  await chooseCarton(page, 'OUT-1');
  await interceptPrint(page);
  const report = page.locator('#printReport');
  await page.locator('#cartonDispatch').click();
  await expect(report.locator('h1')).toHaveText('Outbound Shipment Summary');
  await expect(report.locator('.pr-dispatch-fields')).toContainText('EXT-1');
  await expect(report.locator('.pr-dispatch-cartons li')).toHaveText(['BOX-1', 'BOX-2']);
  await page.pdf({ path: info.outputPath('shipment.pdf'), preferCSSPageSize: true });
  await page.evaluate(() => { window.printRequested = false; window.dispatchEvent(new Event('afterprint')); });
  await page.locator('#cartonStart').click();
  await enterScan(page.locator('#cartonScan'), '0001234567890');
  await page.locator('#cartonLabelTrigger').click();
  await page.locator('#productLabelRotate').click();
  await expect(page.locator('#productLabelOrientation')).toHaveText('297 × 210 mm');
  await page.locator('#productLabelPrint').click();
  await expect.poll(() => page.evaluate(() => window.printRequested)).toBe(true);
  await expect(report).toHaveAttribute('data-paper', 'product-label');
  await expect(report.locator('.product-label-barcode')).toHaveText(['0001234567890', '0001234567890']);
  await expect(report.locator('.product-label-ref')).toHaveText([/EXT-1.*BOX-1/, /EXT-1.*BOX-1/]);
  await page.emulateMedia({ media: 'print' });
  const label = report.locator('.product-label').first();
  const { width } = await label.boundingBox();
  expect(width).toBeCloseTo((297 - 20) / 2 * 96 / 25.4, 0);
  const bars = await label.locator('.product-label-code svg').boundingBox();
  expect(bars.width).toBeGreaterThan(0);
  expect(bars.width).toBeLessThan(width);
  await page.pdf({ path: info.outputPath('labels.pdf'), preferCSSPageSize: true });
});
