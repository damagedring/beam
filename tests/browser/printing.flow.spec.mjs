import { expect } from '@playwright/test';
import { chooseOutboundCarton, enterScan, loadCartons, returnsInspection, test } from './beam-fixture.mjs';

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
    await expect(report.locator('.pr-wordmark')).toHaveText('Beam');
    await expect(report.locator('.pr-reference')).toContainText('20 Apr 2026');
    await expect(report.locator('[aria-label="Code 128 · DEMO-001"]')).toHaveCount(1);
    await expect(report.locator('.pr-identity-band .pr-external-value')).toHaveText('EX-01');
    await expect(report.locator('.pr-label-work')).toContainText('B2B');
    if (action === 'print') {
      await expect(report.locator('.pr-checked dd')).toHaveText('1 / 5');
      await expect(report.locator('tfoot td').nth(3)).toHaveText('5');
      await expect(report.locator('tfoot td').nth(4)).toHaveText('1');
      await page.pdf({ path: info.outputPath('returns.pdf'), preferCSSPageSize: true, printBackground: true });
    } else {
      await expect(report.locator('.pr-checked')).toHaveCount(0);
      await expect(report).toContainText('Retained Scans');
      await expect(report).toContainText('Audit Log');
      await expect(report.locator('td').filter({ hasText: /^0012345678901$/ })).toHaveCount(2);
      await page.pdf({ path: info.outputPath('returns-history.pdf'), preferCSSPageSize: true, printBackground: true });
    }
    await page.evaluate(() => { window.printRequested = false; window.dispatchEvent(new Event('afterprint')); });
    await expect(page).toHaveTitle(originalTitle);
  }
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await expect(report.locator('h1')).toHaveText('Return Inspection Report');
});

test('Outbound prints the selected carton on paper even in dark mode', async ({ beam: page }, info) => {
  await loadCartons(page, 'Outbound');
  await chooseOutboundCarton(page, 'OUT-1', 'BOX-1');
  await enterScan(page.locator('#cartonScan'), '0001234567890');
  await page.locator('#theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await interceptPrint(page);
  await page.locator('#cartonReport').click();
  await expect.poll(() => page.evaluate(() => window.printRequested)).toBe(true);

  const report = page.locator('#printReport');
  await expect(report.locator('h1')).toHaveText('Outbound Inspection Report');
  await expect(report.locator('.pr-identity-band .pr-label-party')).not.toBeEmpty();
  await expect(report.locator('.pr-label-work')).toHaveText('Carton: BOX-1');
  await expect(report.locator('.pr-external-value')).toHaveText('EXT-1');
  await expect(report.locator('.pr-checked dd')).toHaveText('1 / 3');
  const barcode = report.locator('[aria-label="Code 128 · OUT-1"]');
  await expect(barcode.locator('g rect').first()).toHaveAttribute('x', '10');
  const edge = await barcode.evaluate(svg => {
    const lastBar = svg.querySelector('g rect:last-child');
    return svg.viewBox.baseVal.width - Number(lastBar.getAttribute('x')) - Number(lastBar.getAttribute('width'));
  });
  expect(edge).toBe(10);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('html')).toHaveCSS('color-scheme', /^(?:only light|light only)$/);
  await expect(report).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(report.locator('.pr-wordmark')).toHaveCSS('font-family', /Geist/);
  const bounds = await barcode.boundingBox();
  expect(bounds.width).toBeCloseTo(112 * 96 / 25.4, 0);
  expect(bounds.height).toBeCloseTo(26 * 96 / 25.4, 0);
  await page.pdf({ path: info.outputPath('outbound.pdf'), preferCSSPageSize: true, printBackground: true });
});

for (const { rows, paper } of [{ rows: 23, paper: 'portrait' }, { rows: 114, paper: 'landscape' }]) {
  test('an inspection report preserves all ' + rows + ' sorted items in ' + paper + ' print', async ({ beam: page }, info) => {
    const portrait = paper === 'portrait';
    const receipt = portrait ? 'RET-1001' : 'R'.repeat(80);
    const external = portrait ? 'EXT-1001' : 'EXT-LONG-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ-9876543210-RETURN-OR-OUTBOUND-REFERENCE-00077';
    const seller = portrait ? '가상 매장 · Sample retail store' : '가상 서울 검수 센터 · North Warehouse and Retail Acceptance Counter · East Wing Operations and Consolidated Delivery Desk';
    const raw = Array.from({ length: rows }, (_, index) => {
      const number = rows - index;
      return {
        receipt, external, seller, barcode: String(number).padStart(12, '0'), sku: 'SKU-' + number,
        name: 'Sample item ' + number + ' · 인쇄 검수용 예제 상품', qty: 2,
      };
    });
    await page.locator('#backup').setInputFiles({
      name: 'synthetic-report.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, receipt, data: { raw, sku: [], loc: [] }, scans: [] })),
    });
    await expect(page.locator('#barcode')).toBeEnabled();
    await enterScan(page.locator('#barcode'), raw.at(-1).barcode);
    await interceptPrint(page);
    await page.locator('#asnShare').click();
    await page.locator('#print').click();
    await expect.poll(() => page.evaluate(() => window.printRequested)).toBe(true);

    const report = page.locator('#printReport');
    await expect(report).toHaveAttribute('data-paper', paper);
    await expect(report.locator('.pr-identity-band dd')).toHaveText([seller, external]);
    await expect(report.locator('tbody tr')).toHaveCount(rows);
    await expect(report.locator('tbody tr').first()).toContainText('Sample item 1 ·');
    await expect(report.locator('tbody tr').last()).toContainText('Sample item ' + rows + ' ·');
    await expect(report.locator('.pr-checked dd')).toHaveText('1 / ' + 2 * rows);
    await expect(report.locator('tfoot td').nth(3)).toHaveText(String(2 * rows));
    await expect(report.locator('tfoot td').nth(4)).toHaveText('1');
    await page.emulateMedia({ media: 'print' });
    await expect(report.locator('thead')).toHaveCSS('display', 'table-header-group');
    await expect(report.locator('.pr-identity-band')).toHaveCSS('display', 'grid');
    await expect(report.locator('.pr-identity-band dd').first()).toHaveCSS('overflow-wrap', 'anywhere');
    const pdf = await page.pdf({
      path: info.outputPath(portrait ? 'returns-a4.pdf' : 'returns-long.pdf'), preferCSSPageSize: true, scale: 1, printBackground: true,
    });
    const pages = pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
    if (portrait) expect(pages).toBe(1);
    else expect(pages).toBeGreaterThan(1);
  });
}

test('UX-32/33 Outbound shipment summary stays separate from scoped, rotated A4 labels', async ({ beam: page }, info) => {
  await loadCartons(page, 'Outbound');
  await chooseOutboundCarton(page,'OUT-1','BOX-1');
  await interceptPrint(page);
  const report = page.locator('#printReport');
  await page.locator('#cartonDispatch').click();
  await expect(report.locator('h1')).toHaveText('Outbound Shipment Summary');
  await expect(report.locator('.pr-dispatch-fields')).toContainText('EXT-1');
  await expect(report.locator('.pr-dispatch-cartons li')).toHaveText(['BOX-1', 'BOX-2']);
  await page.pdf({ path: info.outputPath('shipment.pdf'), preferCSSPageSize: true });
  await page.evaluate(() => { window.printRequested = false; window.dispatchEvent(new Event('afterprint')); });
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

test('UX-32 failed browser print restores the title and permits retry', async ({ beam: page }) => {
  await loadCartons(page, 'Outbound');
  await chooseOutboundCarton(page,'OUT-1','BOX-1');
  const originalTitle = await page.title();
  await page.evaluate(() => { window.print = () => { throw Error('Fixture printer unavailable'); }; });
  await page.locator('#cartonDispatch').click();
  await expect(page.locator('#beamNoticeStrip')).toContainText('Fixture printer unavailable');
  await expect(page).toHaveTitle(originalTitle);
  await interceptPrint(page);
  await page.locator('#cartonDispatch').click();
  await expect.poll(() => page.evaluate(() => window.printRequested)).toBe(true);
});
