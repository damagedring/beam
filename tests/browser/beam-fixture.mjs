import { expect, test as base } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const test = base.extend({
  beam: async ({ page, baseURL }, use) => {
    const errors = [], outside = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (new URL(request.url()).origin !== new URL(baseURL).origin) outside.push(request.url());
    });
    await page.clock.setFixedTime(new Date('2026-04-20T02:30:00Z'));
    await page.goto('./');
    await expect(page.locator('#beamHome')).toBeVisible();
    await use(page);
    expect(errors, 'uncaught browser errors').toEqual([]);
    expect(outside, 'UX-01 runtime requests outside Beam').toEqual([]);
  },
});

export async function loadDemo(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#helpLauncher').click();
  await page.locator('#demo').click();
  await page.locator('#helpClose').click();
  await expect(page.locator('#beamQuery')).toBeVisible();
}

export async function returnsInspection(page, { singleOrder = false } = {}) {
  if (singleOrder) {
    const raw = [{ receipt: 'TEST-1', external: 'REF-1', seller: 'Fictional store',
      returnTracking: '1111-2222-3333', barcode: '0012345678901', sku: 'SKU-A', name: 'Field jacket', qty: 3 }];
    await page.locator('#backup').setInputFiles({ name: 'fictional-work.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 1, data: { raw, sku: [], loc: [] }, scans: [] })) });
    await expect(page.locator('#beamQuery')).toBeVisible();
  } else {
    await loadDemo(page);
  }
  const query = page.locator('#beamQuery');
  await query.fill('1111-2222-3333');
  await query.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('#beamStart')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('#barcode')).toBeEnabled();
}

export async function enterScan(field, value) {
  await field.fill(value);
  await field.press('Enter');
}

export async function openCartons(page, workflow) {
  const entry = page.getByRole('button', { name: new RegExp(workflow) });
  await entry.click();
  if (!await page.locator('#cartonWorkspace').isVisible()) await entry.click();
  await expect(page.locator('#cartonWorkspace')).toBeVisible();
}

export async function loadCartons(page, workflow, workbook) {
  await openCartons(page, workflow);
  const fixture = fileURLToPath(new URL('../fixtures/cartons.xlsx', import.meta.url));
  await page.locator('#cartonFile').setInputFiles(workbook || fixture);
  const dialog = page.locator('#cartonImportDialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('select').selectOption({ label: workflow === 'Outbound' ? 'Outbound Carton' : 'Inventory Carton' });
  await page.locator('#cartonImportApply').click();
  await expect(dialog.locator('.mapping-fields')).toBeVisible();
  await page.locator('#cartonImportApply').click();
  await expect(page.locator('#cartonSource')).toHaveText(workbook?.name || 'cartons.xlsx', { timeout: 60_000 });
}

export async function chooseCarton(page, query) {
  await page.locator('#cartonQuery').fill(query);
  await page.locator('#cartonQuery').press('Enter');
  await expect(page.locator('#cartonGroupTitle')).toBeVisible();
}
