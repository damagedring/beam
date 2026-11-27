import { json } from 'node:stream/consumers';
import { devices, expect } from '@playwright/test';
import { enterScan, test } from './beam-fixture.mjs';

async function openInspection(page) {
  const data = {
    version: 1, receipt: 'ORDER-1', scans: [],
    data: { raw: [{ receipt: 'ORDER-1', seller: 'Fictional store', barcode: '0012345678901', sku: 'SKU-A', name: 'Example jacket', qty: 2 }], sku: [], loc: [] },
  };
  await page.locator('#backup').setInputFiles({
    name: 'synthetic-return.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  });
  const scan = page.locator('#barcode');
  await expect(scan).toBeEnabled();
  return scan;
}

async function expectWorkDownload(download) {
  const work = await json(await download.createReadStream());
  expect(work.receipt).toBe('ORDER-1');
  expect(work.scans).toEqual([expect.objectContaining({ barcode: '0012345678901', qty: 1, scanOutcome: 'accepted' })]);
}

async function measureCallout(page) {
  const geometry = await page.evaluate(() => {
    const save = document.getElementById('beamSaveHint');
    const rect = selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height };
    };
    const title = document.body.dataset.beamView === 'home' ? '.beam-masthead-word' : '.beam-home-spin';
    const controls = ['#workSidebarToggle', '#beamBack', '#theme', '#fileMenuButton', '#availabilityToggle']
      .map(rect).filter(box => box.height);
    const bubble = rect('#beamSaveHint');
    const hit = document.elementFromPoint((bubble.left + bubble.right) / 2, (bubble.top + bubble.bottom) / 2);
    return {
      bubble, title: rect(title), notice: rect('#beamNoticeSlot'), controls, hit: Boolean(hit?.closest('#beamSaveHint')),
      inner: innerWidth, scroll: document.documentElement.scrollWidth, tail: Number.parseFloat(getComputedStyle(save, '::before').bottom),
    };
  });
  const { bubble, title, notice, controls } = geometry;
  expect(geometry.scroll).toBe(geometry.inner);
  expect(bubble.left).toBeGreaterThanOrEqual(8);
  expect(bubble.right).toBeLessThanOrEqual(geometry.inner - 8);
  expect(bubble.top).toBeGreaterThanOrEqual(notice.bottom + 4);
  expect(bubble.bottom + 6).toBeLessThan(title.top + 1);
  expect((bubble.left + bubble.right) / 2).toBeGreaterThan(title.left);
  expect((bubble.left + bubble.right) / 2).toBeLessThan(title.right);
  expect(geometry.tail).toBeLessThan(0);
  expect(geometry.hit).toBe(true);
  for (const target of controls) {
    expect(bubble.right <= target.left || bubble.left >= target.right || bubble.bottom <= target.top || bubble.top >= target.bottom).toBe(true);
  }
  return bubble.height;
}

test('the dirty Save callout sits above Beam and returns focus after a keyboard download', async ({ beam: page }) => {
  const button = page.getByRole('button', { name: '변경사항 저장', exact: true });
  await expect(button).toBeHidden();
  const scan = await openInspection(page);
  await enterScan(scan, '0012345678901');
  await expect(button).toBeVisible();
  await measureCallout(page);
  await button.focus();
  const download = page.waitForEvent('download');
  await button.press('Enter');
  await expectWorkDownload(await download);
  await expect(button).toBeHidden();
  await expect(scan).toBeFocused();
});

test.describe('narrow touch Save callout', () => {
  test.use({ isMobile: true, hasTouch: true, userAgent: devices['iPhone 13'].userAgent, viewport: { width: 390, height: 760 } });

  test('Save stays above the compact and Home titles with usable margins', async ({ beam: page }) => {
    const scan = await openInspection(page);
    await enterScan(scan, '0012345678901');
    const button = page.getByRole('button', { name: '변경사항 저장', exact: true });
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 760 });
      expect(await measureCallout(page)).toBeGreaterThanOrEqual(44);
    }
    await page.locator('#beamBack').tap();
    await expect(page.locator('#beamQuery')).toBeVisible();
    await measureCallout(page);
    await page.locator('#beamHomeBack').tap();
    await expect(page.locator('#beamHome')).toBeVisible();
    await measureCallout(page);
    const download = page.waitForEvent('download');
    await button.tap();
    await expectWorkDownload(await download);
    await expect(button).toBeHidden();
  });
});
