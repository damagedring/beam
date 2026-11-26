import { expect } from '@playwright/test';
import { enterScan, returnsInspection, test } from './beam-fixture.mjs';

async function installAudioProbe(page, mode) {
  await page.evaluate(mode => {
    const probe = window.beamAudioProbe = { requests: 0, notes: [] };
    const Audio = class {
      state = 'running';
      currentTime = 0;
      destination = {};

      constructor() {
        if (mode === 'throws') throw new Error('Test AudioContext initialization failure');
      }

      createOscillator() {
        return {
          frequency: {}, connect() {}, stop() {},
          start() { probe.notes.push(this.frequency.value); },
        };
      }

      createGain() {
        return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
    };
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      get() {
        probe.requests++;
        return mode === 'unavailable' ? undefined : Audio;
      },
    });
    window.webkitAudioContext = undefined;
  }, mode);
}

test('UX-14 Returns scan outcomes play their corresponding notes', async ({ beam: page }) => {
  await installAudioProbe(page, 'available');
  await returnsInspection(page, { singleOrder: true });
  const scan = page.locator('#barcode');
  const activity = page.locator('#scanActivitySection [data-cell-state]');
  const barcode = '0012345678901';
  const entries = [
    [barcode, 'accepted', [900]],
    [barcode, 'accepted', [900]],
    [barcode, 'accepted', [900]],
    [barcode, 'excess', [540, 330]],
    ['not-in-reference', 'unknown', [480, 670]],
  ];
  for (const [index, [input, outcome, notes]] of entries.entries()) {
    await enterScan(scan, input);
    await expect(activity).toHaveCount(index + 1);
    await expect(activity.last()).toHaveAttribute('data-cell-state', outcome);
    expect(await page.evaluate(() => window.beamAudioProbe.notes.splice(0))).toEqual(notes);
  }
});

for (const mode of ['unavailable', 'throws']) {
  test(`UX-14 Returns still records a scan when AudioContext ${mode === 'throws' ? 'throws' : 'is unavailable'}`, async ({ beam: page }) => {
    await installAudioProbe(page, mode);
    await returnsInspection(page, { singleOrder: true });
    await enterScan(page.locator('#barcode'), '0012345678901');
    const activity = page.locator('#scanActivitySection [data-cell-state]');
    await expect(activity).toHaveCount(1);
    await expect(activity).toHaveAttribute('data-cell-state', 'accepted');
    await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);
    expect(await page.evaluate(() => window.beamAudioProbe)).toEqual({ requests: 1, notes: [] });
  });
}
