import { expect } from '@playwright/test';
import { enterScan, returnsInspection, test } from './beam-fixture.mjs';

test('locally bundled fonts render work selection, inspection and print labels', async ({ beam: page }) => {
  const session = await page.context().newCDPSession(page);
  await session.send('DOM.enable');
  await session.send('CSS.enable');

  async function checkFont(selector, ...names) {
    await expect(page.locator(selector)).toBeVisible();
    await page.evaluate(async () => { document.body.getBoundingClientRect(); await document.fonts.ready; });
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    expect(fonts.map(font => font.familyName).sort(), selector).toEqual(names.sort());
    expect(fonts.every(font => font.isCustomFont && font.glyphCount > 0), selector).toBe(true);
  }

  await checkFont('#beamHomeSlotInbound .beam-home-en', 'Geist');
  await checkFont('#beamHomeSlotInbound .beam-home-ko', 'Pretendard Variable');
  await checkFont('.beam-masthead-word', 'Geist');

  await returnsInspection(page);
  await enterScan(page.locator('#barcode'), '0012345678901');
  await checkFont('#lastScannedName', 'Geist', 'Pretendard Variable');

  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#printReport table tbody tr').first()).toBeVisible();
  await checkFont('#printReport .pr-label-party', 'Pretendard Variable');
  await session.detach();
});
