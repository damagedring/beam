import { defineConfig } from '@playwright/test';

const port = Number(process.env.BEAM_TEST_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}/beam/`;

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  forbidOnly: !!process.env.CI,
  snapshotPathTemplate: '{testDir}/snapshots/{testFileName}/{arg}{ext}',
  use: {
    browserName: 'chromium',
    baseURL,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: { animations: 'disabled', threshold: 0, maxDiffPixels: 0 },
  },
  webServer: {
    command: 'node tools/serve.mjs',
    cwd: process.env.BEAM_TEST_ROOT,
    env: { PORT: String(port) },
    url: baseURL,
  },
});
