import { defineConfig } from '@playwright/test';
import config from './playwright.config.mjs';

export default defineConfig({ ...config, testMatch: '**/*.perf.mjs', timeout: 180_000,
  use: { ...config.use, trace: 'off' } });
