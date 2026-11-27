import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { chooseCarton, chooseOutboundCarton, enterScan, loadCartons, test } from './beam-fixture.mjs';

const barcode = '0001234567890';

async function scanAndFinish(page, quantity) {
  const scan = page.locator('#cartonScan');
  for (let i = 0; i < quantity; i++) await enterScan(scan, barcode);
  await page.locator('#cartonFinish').click();
  await expect(page.locator('#cartonFeedback')).toHaveText('검수를 완료했어요.');
}

for (const { first, second, quantity } of [
  { first: 'LOC-1', second: 'BOX-1', quantity: 5 },
  { first: 'BOX-1', second: 'LOC-1', quantity: 3 },
]) {
  test(`Inventory reopens ${second} with the saved method from ${first}`, async ({ beam: page }) => {
    await loadCartons(page, 'Inventory');
    await chooseCarton(page, first);
    await scanAndFinish(page, quantity);

    await page.reload();
    await loadCartons(page, 'Inventory');
    await chooseCarton(page, second);

    await expect(page.locator('#cartonFeedback')).toContainText('실사 방식');
    await expect(page.locator('#cartonScan')).toBeDisabled();
    await expect(page.locator('#cartonFinish')).toBeDisabled();
  });
}

test('Outbound shows saved sibling totals and carton markers after opening one carton', async ({ beam: page }) => {
  await loadCartons(page, 'Outbound');
  await chooseOutboundCarton(page, 'OUT-1', 'BOX-1');
  await scanAndFinish(page, 3);
  await page.locator('#cartonBack').click();
  await page.locator('.outbound-carton[title="BOX-2"]').click();
  await expect(page.locator('#cartonScan')).toBeEnabled();
  await scanAndFinish(page, 2);

  await page.reload();
  await loadCartons(page, 'Outbound');
  await chooseOutboundCarton(page, 'OUT-1', 'BOX-1');
  await expect(page.locator('#cartonFeedback')).toHaveText('검수를 완료했어요.');
  await expect(page.locator('#outboundOrderPercent')).toHaveText('100%');
  await expect(page.locator('#cartonPercent')).toHaveText('100%');
  await page.locator('#cartonBack').click();
  const receipt = page.locator('.outbound-cartons').filter({
    has: page.getByRole('img', { name: 'Code 128 · OUT-1', exact: true }),
  });
  await expect(receipt.getByRole('button', { name: /BOX-2.*완료/ })).toBeVisible();
  await receipt.getByRole('button', { name: /BOX-1.*완료/ }).click();
  await expect(page.locator('#outboundOrderPercent')).toHaveText('100%');
});

test('two Inventory tabs keep both local ledgers and save only one counting method', async ({ beam: page, context }) => {
  const other = await context.newPage();
  await other.clock.setFixedTime(new Date('2026-04-20T02:30:00Z'));
  await other.goto(page.url());
  await loadCartons(page, 'Inventory');
  await loadCartons(other, 'Inventory');
  await chooseCarton(page, 'LOC-1');
  await chooseCarton(other, 'BOX-1');

  for (let i = 0; i < 5; i++) await enterScan(page.locator('#cartonScan'), barcode);
  for (let i = 0; i < 3; i++) await enterScan(other.locator('#cartonScan'), barcode);
  await Promise.all([page.locator('#cartonFinish').click(), other.locator('#cartonFinish').click()]);
  const success = '검수를 완료했어요.';
  const conflict = /다른 창|다른 탭|실사 방식|충돌/;
  await expect.poll(async () => {
    const messages = await Promise.all([page, other].map(tab => tab.locator('#cartonFeedback').textContent()));
    return [messages.filter(message => message === success).length, messages.filter(message => conflict.test(message)).length];
  }).toEqual([1, 1]);
  await expect(page.locator('#cartonCount')).toContainText('5 / 5');
  await expect(other.locator('#cartonCount')).toContainText('3 / 3');
});

test('clearing a migrated legacy inspection preserves open scans and removes the lock after reload', async ({ beam: page }) => {
  const workbook = await readFile(new URL('../fixtures/cartons.xlsx', import.meta.url));
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const manifest = JSON.stringify([[JSON.stringify(['SKU-1', barcode]), 5]]);
  const key = JSON.stringify(['v1', 'inventory', sha(workbook), 'LOC-1', null, sha(manifest)]);
  const at = Date.parse('2026-04-19T00:00:00Z');
  const entry = {
    key, revision: 'v1', status: 'complete', outcome: 'matched', completedAt: new Date(at).toISOString(),
    events: Array.from({ length: 5 }, () => ({ value: barcode, at })),
  };

  await page.evaluate(async legacy => {
    const { createIndexedRecoveryStore } = await import(new URL('platform/indexed-recovery.js', document.baseURI));
    const store = createIndexedRecoveryStore(undefined, 'beam-inspection-completions');
    await store.write(legacy, null);
  }, entry);
  await loadCartons(page, 'Inventory');
  await chooseCarton(page, 'BOX-1');
  await expect(page.locator('#cartonFeedback')).toContainText('실사 방식');
  await page.locator('#cartonScopes button').first().click();
  await expect(page.locator('#cartonCount')).toContainText('5 / 5');
  await expect(page.locator('#cartonFeedback')).toHaveText('검수를 완료했어요.');

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#clearCompletionsLauncher').click();
  await page.locator('#clearCompletionsConfirm').click();
  await expect(page.locator('#clearCompletionsDialog')).toBeHidden();
  await expect(page.locator('#cartonCount')).toContainText('5 / 5');

  await page.reload();
  await loadCartons(page, 'Inventory');
  await chooseCarton(page, 'BOX-1');
  await expect(page.locator('#cartonScan')).toBeEnabled();
  await expect(page.locator('#cartonCount')).toContainText('0 / 3');
  await scanAndFinish(page, 3);
});


test('a saved Outbound carton contributes once and keeps another tab’s local draft', async ({ beam: page, context }) => {
  const other = await context.newPage();
  await other.clock.setFixedTime(new Date('2026-04-20T02:30:00Z'));
  await other.goto(page.url());
  await loadCartons(page, 'Outbound');
  await loadCartons(other, 'Outbound');
  await chooseOutboundCarton(other, 'OUT-1', 'BOX-2');
  await enterScan(other.locator('#cartonScan'), barcode);
  await expect(other.locator('#cartonPercent')).toHaveText('50%');

  await chooseOutboundCarton(page, 'OUT-1', 'BOX-2');
  await scanAndFinish(page, 2);
  await other.locator('#cartonBack').click();
  await other.locator('.outbound-carton[title="BOX-1"]').click();
  await expect(other.locator('#outboundOrderPercent')).toHaveText('40%');
  await expect(other.locator('#cartonPercent')).toHaveText('0%');

  await other.locator('#cartonBack').click();
  await other.getByRole('button', { name: /BOX-2.*완료/ }).click();
  await expect(other.locator('#cartonPercent')).toHaveText('50%');
  await expect(other.locator('#cartonHistory [data-result]')).toHaveCount(1);
  await expect(other.locator('#outboundOrderPercent')).toHaveText('40%');
});
