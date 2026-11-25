import { expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { enterScan, returnsInspection, test } from './beam-fixture.mjs';

const demoAsset = '**/features/examples/cry-later-assets.js?*';
const demoButtonName = 'Cry Later 예제 체험';
const userProfile = {
  version: 1,
  active: 'fixture',
  profiles: {
    fixture: { name: 'Fictional saved profile', file: {}, paste: {}, locationRules: { eligibleTypes: ['RESERVE'], zoneSeparator: '' } },
  },
};

async function openHelp(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#helpLauncher').click();
  return page.getByRole('dialog', { name: '도움말 · 예제' });
}

async function openReference(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#dataLauncher').click();
  return page.getByRole('dialog', { name: '기준 데이터' });
}

async function chooseReference(page, dialog, file) {
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByRole('button', { name: 'RAW 또는 프로필 불러오기' }).click();
  await (await chooser).setFiles(file);
}

async function installFixtureProfile(page) {
  const settings = await openReference(page);
  page.once('dialog', dialog => dialog.accept());
  await chooseReference(page, settings, {
    name: 'fictional-profile.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(userProfile)),
  });
  await expect(settings.getByRole('button', { name: 'Fictional saved profile' })).toHaveAttribute('aria-current', 'true');
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
}

async function scanCryLaterOrder(page, { tracking, code, progress }) {
  const query = page.locator('#beamQuery');
  await query.fill(tracking);
  await query.press('Enter');
  await page.getByRole('button', { name: '파일 열기', exact: true }).click();
  await page.getByRole('button', { name: '선택한 주문 검수 시작' }).click();
  const field = page.locator('#barcode');
  await expect(field).toBeFocused();
  await enterScan(field, code);
  await expect(page.locator('#lastScannedProgress')).toHaveText(progress);
}

function savedProfile(page) {
  return page.evaluate(() => localStorage.getItem('logistics-local-mapping-v1'));
}

test('Cry Later example loads fictional B2B and B2C orders and preserves the active saved profile', async ({ beam: page }) => {
  await returnsInspection(page, { singleOrder: true });
  await enterScan(page.locator('#barcode'), '0012345678901');
  await installFixtureProfile(page);
  const profileBefore = await savedProfile(page);

  const help = await openHelp(page);
  page.once('dialog', dialog => dialog.dismiss());
  await help.getByRole('button', { name: demoButtonName }).click();
  await help.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);
  expect(await savedProfile(page)).toBe(profileBefore);

  const example = await openHelp(page);
  page.once('dialog', dialog => dialog.accept());
  await example.getByRole('button', { name: demoButtonName }).click();
  await expect(example.getByRole('status')).toHaveText('Cry Later 예제를 불러왔습니다.');
  await example.getByRole('button', { name: '닫기', exact: true }).click();
  await scanCryLaterOrder(page, { tracking: '0003-0001-7001', code: 'CLB00602', progress: /1\s*\/\s*6/ });
  expect(await savedProfile(page)).toBe(profileBefore);

  await page.locator('#beamBack').click();
  await page.getByRole('button', { name: 'B2C', exact: true }).click();
  await page.locator('#beamQuery').fill('임민서 (데모)');
  await expect(page.locator('#beamSearchStatus')).toHaveText('검색 결과 2건');
  await scanCryLaterOrder(page, { tracking: '9003-0001-7001', code: 'CLB00801', progress: /1\s*\/\s*2/ });
  expect(await savedProfile(page)).toBe(profileBefore);
});

test('Cry Later downloads preserve the supplied files and reconnect in the normal reference importer', async ({ beam: page }) => {
  const help = await openHelp(page);
  const files = [];
  for (const [button, name, mimeType, hash] of [
    ['Cry Later 프로필 JSON 다운로드', 'Cry-Later-Profile.json', 'application/json', 'f58bc1e45755f75e2f5a1e5497dc83cce814118b2b62feb2aa63851a3c105a0a'],
    ['Cry Later XLSX 다운로드', 'Cry-Later-Demo.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'aab5f90102cc5c07723fdb6160c8fdb73be8adab4fe2cd042583e3664c0ba910'],
  ]) {
    const pending = page.waitForEvent('download');
    await help.getByRole('button', { name: button, exact: true }).click();
    const file = await pending;
    expect(file.suggestedFilename()).toBe(name);
    const bytes = await buffer(await file.createReadStream());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
    files.push({ name, mimeType, buffer: bytes });
  }
  await help.getByRole('button', { name: '닫기', exact: true }).click();

  const reference = await openReference(page);
  page.once('dialog', dialog => dialog.accept());
  await chooseReference(page, reference, files[0]);
  await expect(reference.getByText('프로필 적용 완료 · 저장된 Excel 시트 4개', { exact: true })).toBeVisible();
  await chooseReference(page, reference, files[1]);
  await expect(page.locator('#beamRawAnnounce')).toHaveText('RAW 연결 완료 · 반품 예정 472행');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await scanCryLaterOrder(page, { tracking: '0003-0001-7001', code: 'CLB00602', progress: /1\s*\/\s*6/ });
});

test('Cry Later asset failure leaves existing work and mapping intact', async ({ beam: page }) => {
  await returnsInspection(page, { singleOrder: true });
  await enterScan(page.locator('#barcode'), '0012345678901');
  await installFixtureProfile(page);
  const profileBefore = await savedProfile(page);
  await page.route(demoAsset, route => route.abort());

  const help = await openHelp(page);
  page.once('dialog', dialog => dialog.accept());
  await help.getByRole('button', { name: demoButtonName }).click();
  await expect(help.getByRole('status')).toHaveText('Cry Later 예제를 불러오지 못했습니다. 현재 작업은 유지됩니다.');
  await help.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);
  expect(await savedProfile(page)).toBe(profileBefore);
});

test('Closing Help during Cry Later loading cancels the pending example', async ({ beam: page }) => {
  await returnsInspection(page, { singleOrder: true });
  await enterScan(page.locator('#barcode'), '0012345678901');
  const profileBefore = await savedProfile(page);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const requested = page.waitForRequest(demoAsset);
  await page.route(demoAsset, async route => {
    await pending;
    await route.continue();
  });

  const help = await openHelp(page);
  page.once('dialog', dialog => dialog.accept());
  try {
    await help.getByRole('button', { name: demoButtonName }).click();
    await requested;
    await expect(help.getByRole('status')).toHaveText('Cry Later 예제를 불러오는 중…');
    await help.getByRole('button', { name: '닫기', exact: true }).click();
  } finally {
    release();
  }
  await expect(page.locator('#demo')).toBeEnabled();
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);
  expect(await savedProfile(page)).toBe(profileBefore);
  await openHelp(page);
  await expect(page.locator('#demoStatus')).toBeHidden();
});
