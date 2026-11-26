import { expect } from '@playwright/test';
import { chooseCarton, loadCartons, test } from './beam-fixture.mjs';
import { cartonWorkload, codes, returnWorkload } from '../fixtures/scan-workload.mjs';

for (const mode of ['returns', 'cartons']) {
  test(`UX-34 ${mode} input sequence over 60,000 lines`, async ({ beam: page }, info) => {
    const carts = mode === 'cartons';
    if (carts) {
      await loadCartons(page, 'Outbound', cartonWorkload());
      await chooseCarton(page, 'BOX-0');
    } else {
      await page.locator('#backup').setInputFiles(returnWorkload());
      await expect(page.locator('#barcode')).toBeEnabled({ timeout: 60_000 });
    }
    const samples = await page.evaluate(async ({ carts, codes }) => {
      const input = document.getElementById(carts ? 'cartonScan' : 'barcode');
      const quantity = document.getElementById(carts ? 'cartonCount' : 'lastScannedProgress');
      const identity = document.getElementById(carts ? 'cartonLast' : 'lastScannedBarcode');
      const durations = [];
      for (let ordinal = 0; ordinal < 600; ordinal++) {
        const item = ordinal % codes.length, code = codes[item];
        input.value = code;
        const started = performance.now();
        input.form.requestSubmit();
        durations.push(performance.now() - started);
        const wanted = (carts ? ordinal + 1 : Math.floor(ordinal / codes.length) + 1).toLocaleString();
        if (!quantity.textContent.startsWith(wanted + ' / ') || !identity.textContent.includes(carts ? 'Product ' + item : code)) {
          throw Error('Feedback mismatch at input ' + (ordinal + 1));
        }
        // Let layout, painting and asynchronous checkpoints progress between bursts.
        await new Promise(requestAnimationFrame);
      }
      return durations;
    }, { carts, codes });
    const windows = ['first', 'middle', 'late'].map((name, index) => {
      const values = samples.slice(index * 200, (index + 1) * 200).sort((a, b) => a - b);
      return { name, mean: +(values.reduce((sum, value) => sum + value, 0) / 200).toFixed(2),
        p95: +values[189].toFixed(2) };
    });
    console.log(JSON.stringify({ mode, scans: samples.length, windows }));
    await info.attach('scan-timings.json', { body: JSON.stringify({ mode, windows, samples }), contentType: 'application/json' });
    expect(samples).toHaveLength(600);
  });
}
