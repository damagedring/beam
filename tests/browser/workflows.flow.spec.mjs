import { expect } from '@playwright/test';
import { chooseCarton, enterScan, loadCartons, loadDemo, openCartons, returnsInspection, test } from './beam-fixture.mjs';

test('UX-05/06/08/09/10/11 Returns tracking, scanner routing, frozen verdicts and undo', async ({ beam: page }) => {
  await returnsInspection(page, { singleOrder: true });
  const scan = page.locator('#barcode');
  await expect(scan).toBeFocused();
  await scan.blur();
  await page.keyboard.type('0012345678901');
  await page.keyboard.press('Enter');
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);
  for (let i = 0; i < 3; i++) await enterScan(scan, '0012345678901');
  const activity = page.locator('#scanActivitySection [data-cell-state]');
  await expect(activity).toHaveCount(4);
  await expect(activity.last()).toHaveAttribute('data-cell-state', 'excess');
  for (const item of (await activity.all()).slice(0, 3)) await expect(item).toHaveAttribute('data-cell-state', 'accepted');
  await enterScan(scan, 'not-in-reference');
  await expect(activity.last()).toHaveAttribute('data-cell-state', 'unknown');
  await page.locator('#undo').click();
  await expect(activity).toHaveCount(4);
  await expect(activity.last()).toHaveAttribute('data-cell-state', 'excess');
});

test('UX-15/16 Returning to matching reference data after reload restores an actual browser checkpoint', async ({ beam: page }) => {
  await returnsInspection(page);
  await enterScan(page.locator('#barcode'), '0012345678901');
  await expect(page.locator('#beamRecoverySaved')).toContainText('자동 저장됨');
  await page.reload();
  await expect(page.locator('#beamRecoveryStatus')).toContainText('기준 자료를 먼저');
  await expect(page.locator('#beamRecoverDraft')).toBeHidden();
  await loadDemo(page);
  await expect(page.locator('#beamRecoverDraft')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#beamRecoverDraft').click();
  await expect(page.locator('#barcode')).toBeFocused();
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);
});

test('UX-17/18/19/21/22 Outbound tracks each carton and uses mapped identity for remaining labels', async ({ beam: page }) => {
  await loadCartons(page, 'Outbound');
  await chooseCarton(page, 'OUT-1');
  await page.locator('#cartonStart').click();
  await enterScan(page.locator('#cartonScan'), '0001234567890');
  await expect(page.locator('#cartonCount')).toContainText('1 / 3');
  await expect(page.locator('#cartonLastBrand')).toHaveText('ACME');
  await expect(page.locator('#cartonLast')).toHaveText('Field jacket');
  await page.locator('#cartonLabelTrigger').click();
  await expect(page.locator('#productLabelDialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cartonLabelTrigger')).toBeFocused();
  await page.locator('#cartonBack').click();
  await page.locator('#cartonScopes').getByRole('button', { name: 'BOX-2' }).click();
  await page.locator('#cartonStart').click();
  await expect(page.locator('#cartonCount')).toContainText('0 / 2');
  await page.locator('#beamHomeBack').click();
  await openCartons(page, 'Outbound');
  await chooseCarton(page, 'OUT-1');
  await page.locator('#cartonStart').click();
  await expect(page.locator('#cartonCount')).toContainText('1 / 3');
});

test('UX-20 Inventory disallows a second counting method until its first scan is undone', async ({ beam: page }) => {
  await loadCartons(page, 'Inventory');
  await chooseCarton(page, 'LOC-1');
  const scan = page.locator('#cartonScan');
  await enterScan(scan, '0001234567890');
  await expect(page.locator('#cartonCount')).toContainText('1 / 5');
  await page.locator('#cartonScopes').getByRole('button', { name: 'BOX-1' }).click();
  await expect(scan).toBeDisabled();
  await page.locator('#cartonScopes button').first().click();
  await page.locator('#cartonUndo').click();
  await page.locator('#cartonScopes').getByRole('button', { name: 'BOX-1' }).click();
  await expect(scan).toBeEnabled();
  await expect(page.locator('#cartonCount')).toContainText('0 / 3');
});
