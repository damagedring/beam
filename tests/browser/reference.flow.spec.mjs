import { expect } from '@playwright/test';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { chooseOutboundCarton, enterScan, loadCartons, openCartons, test } from './beam-fixture.mjs';
import { zip } from '../fixtures/scan-workload.mjs';

const originalMapping = {
  '주문 식별자': 'A · Intake ID',
  '외부 주문 식별자': 'B · Public Ref',
  'B2B/B2C 구분 열': 'C · Segment',
  '반송장번호 (선택)': 'D · Waybill',
  '상품 바코드': 'E · Item barcode',
  '상품 코드': 'F · Item code',
  상품명: 'G · Item title',
  '예정 수량': 'H · Units planned',
  매장명: 'I · Shop',
  '고객명 · 조회용 (선택)': 'J · Recipient',
};

const annexMapping = {
  '예정 수량': 'A · Annex units',
  매장명: 'B · Annex shop',
  '주문 식별자': 'C · Annex key',
  '상품 코드': 'D · Annex code',
  상품명: 'E · Annex title',
  '상품 바코드': 'F · Annex barcode',
  '반송장번호 (선택)': 'G · Annex waybill',
};

const wholesaleBarcode = '0012345678901';
const wholesaleTracking = '0011-2233-4455';
const searchStatus = page => page.locator('#beamSearchStatus');
const columnDialog = page => page.getByRole('dialog', { name: 'Return ASN · 열 연결' });
const mapConfirm = dialog => dialog.getByRole('button', { name: '연결 확인' });

async function referenceSettings(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: '기준 데이터', exact: true }).click();
  return page.getByRole('dialog', { name: '기준 데이터' });
}

async function chooseReferenceFile(page, settings, file) {
  const chooser = page.waitForEvent('filechooser');
  await settings.getByRole('button', { name: 'RAW 또는 프로필 불러오기' }).click();
  await (await chooser).setFiles(file);
}

async function chooseWorkbook(page, name, mode = 'replace') {
  const settings = await referenceSettings(page);
  await settings.getByRole('combobox', { name: '예정 자료 적용' }).selectOption(mode);
  const path = fileURLToPath(new URL('../fixtures/reference-' + name + '.xlsx', import.meta.url));
  await chooseReferenceFile(page, settings, path);
}

async function mapWorkbook(page, sheet, fields) {
  const sheets = page.getByRole('dialog', { name: '시트 연결' });
  const role = sheets.getByRole('combobox', { name: 'Return ASN' });
  await expect(role).toBeFocused();
  await role.selectOption({ label: sheet });
  await mapConfirm(sheets).click();
  const columns = columnDialog(page);
  const header = columns.getByRole('combobox', { name: '헤더 행' });
  await expect(header).toBeFocused();
  await header.selectOption('1');
  for (const [name, label] of Object.entries(fields)) {
    await columns.getByRole('combobox', { name, exact: true }).selectOption({ label });
  }
  return columns;
}

async function expectImported(page, rows) {
  await expect(page.locator('#beamRawAnnounce')).toHaveText('RAW 연결 완료 · 반품 예정 ' + rows + '행');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

async function importOriginal(page) {
  await page.getByRole('button', { name: /Returns/ }).click();
  await chooseWorkbook(page, 'original');
  const columns = await mapWorkbook(page, 'Fictional Returns', originalMapping);
  await columns.getByRole('textbox', { name: 'B2B 원본 값' }).fill('WHOLE');
  await columns.getByRole('textbox', { name: 'B2C 원본 값' }).fill('HOME');
  await mapConfirm(columns).click();
  await expectImported(page, 3);
}

async function exportProfiles(page) {
  const settings = await referenceSettings(page);
  const exportButton = settings.getByRole('button', { name: 'JSON 내보내기' });
  if (!await exportButton.isVisible()) await settings.getByText('연결 프로필 관리', { exact: true }).click();
  const download = page.waitForEvent('download');
  await exportButton.click();
  const file = await download;
  const profiles = JSON.parse((await buffer(await file.createReadStream())).toString());
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  return profiles;
}

async function enterInspection(page, value) {
  const query = page.locator('#beamQuery');
  await query.fill(value);
  await query.press('Enter');
  await page.getByRole('button', { name: '파일 열기', exact: true }).click();
  await page.getByRole('button', { name: '선택한 주문 검수 시작' }).click();
  await expect(page.locator('#barcode')).toBeFocused();
}

test('UX-02 saved Returns mapping reconnects reordered headers and a moved header row', async ({ beam: page }) => {
  await importOriginal(page);
  await page.reload();
  await page.getByRole('button', { name: /Returns/ }).click();
  await chooseWorkbook(page, 'reordered');
  await expectImported(page, 3);

  await enterInspection(page, wholesaleTracking);
  await enterScan(page.locator('#barcode'), wholesaleBarcode);
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*7/);
  await expect(page.locator('#lastname')).toHaveText('Canvas tote revised');
  const profiles = await exportProfiles(page);
  expect(Object.values(profiles.profiles).map(profile => profile.name)).toEqual(['reference-original']);
  expect(profiles.profiles[profiles.active].file.raw.headerNames).toMatchObject({
    receipt: 'Intake ID', qty: 'Units planned', barcode: 'Item barcode', returnChannel: 'Segment',
    customerName: 'Recipient',
  });
});

test('UX-03 Escape cancels pending mapping without applying data and a new schema preserves the first profile', async ({ beam: page }) => {
  await importOriginal(page);
  const originalProfiles = await exportProfiles(page);

  await chooseWorkbook(page, 'new-schema');
  const pending = await mapWorkbook(page, 'Fictional Annex', annexMapping);
  await page.keyboard.press('Escape');
  await expect(pending).toBeHidden();
  await expect(page.locator('#beamRawMessage')).toContainText('[MAP-CANCEL]');
  await expect(page.locator('#beamQuery')).toBeFocused();
  await expect(searchStatus(page)).toHaveText('전체 반품 주문 · 1');
  await page.locator('#beamQuery').fill('Juniper Supply');
  await expect(page.getByRole('button', { name: /Juniper Supply · 주문 1/ })).toBeVisible();
  expect(await exportProfiles(page)).toEqual(originalProfiles);

  await chooseWorkbook(page, 'new-schema');
  await mapConfirm(await mapWorkbook(page, 'Fictional Annex', annexMapping)).click();
  await expectImported(page, 1);
  await page.locator('#beamQuery').fill('Gamma Annex');
  await expect(page.getByRole('button', { name: /Gamma Annex · 주문 1/ })).toBeVisible();

  const profiles = await exportProfiles(page);
  expect(profiles.active).not.toBe(originalProfiles.active);
  expect(Object.keys(profiles.profiles)).toHaveLength(2);
  expect(profiles.profiles[originalProfiles.active]).toEqual(originalProfiles.profiles[originalProfiles.active]);
  expect(profiles.profiles[profiles.active]).toMatchObject({
    name: 'reference-new-schema', file: { raw: { sheetName: 'Fictional Annex', headerNames: { receipt: 'Annex key' } } },
  });

  await chooseWorkbook(page, 'reordered');
  const sheets = page.getByRole('dialog', { name: '시트 연결' });
  await sheets.getByRole('button', { name: '다른 프로필 사용' }).click();
  const settings = page.getByRole('dialog', { name: '기준 데이터' });
  const retry = settings.getByRole('button', { name: '이 프로필로 다시 연결: reference-reordered.xlsx' });
  await expect(settings).toBeVisible();

  const confirmImport = page.waitForEvent('dialog').then(async dialog => {
    const message = dialog.message();
    await dialog.accept();
    return message;
  });
  await chooseReferenceFile(page, settings, {
    name: 'saved-return-profile.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(originalProfiles)),
  });
  expect(await confirmImport).toContain('현재 프로필 목록을 가져온 목록으로 바꿀까요?');
  await expect(retry).toBeFocused();
  await expect(settings.getByText('프로필 적용 완료 · 저장된 Excel 시트 1개', { exact: true })).toBeVisible();
  await retry.click();
  await expectImported(page, 3);
  await page.locator('#beamQuery').fill('Juniper Supply');
  await expect(page.getByRole('button', { name: /Juniper Supply · 주문 1/ })).toBeVisible();
});

test('UX-04 append rejects overlapping orders and replacement reuses the existing inspection work', async ({ beam: page }) => {
  await importOriginal(page);
  await enterInspection(page, wholesaleTracking);
  await enterScan(page.locator('#barcode'), wholesaleBarcode);
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);
  await expect(page.locator('#beamRecoverySaved')).toContainText('자동 저장됨');

  await chooseWorkbook(page, 'reordered', 'append');
  await expect(page.locator('#beamRawMessage')).toContainText('[RAW-APPLY]');
  await expect(page.locator('#dialogNotice')).toContainText('기존 오더 키가 겹칩니다.');
  await enterInspection(page, wholesaleTracking);
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);

  await chooseWorkbook(page, 'append', 'append');
  await expectImported(page, 1);
  await page.locator('#beamQuery').fill('Alder Goods');
  await expect(page.getByRole('button', { name: /Alder Goods · 주문 1/ })).toBeVisible();
  await enterInspection(page, wholesaleTracking);
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*3/);

  await chooseWorkbook(page, 'reordered');
  await expectImported(page, 3);
  await page.locator('#beamQuery').fill('Alder Goods');
  await expect(page.locator('#beamEmptyTitle')).toHaveText('일치하는 반품 주문이 없어요');
  await enterInspection(page, wholesaleTracking);
  await expect(page.locator('#lastScannedProgress')).toHaveText(/1\s*\/\s*7/);
  await expect(page.locator('#scanActivitySection [data-cell-state]')).toHaveCount(1);
});

test('UX-04 a delayed settings close after workbook import preserves search focus', async ({ beam: page }) => {
  await importOriginal(page);
  await page.locator('#dataDialog').evaluate(dialog => {
    // Deliver the native close notification after the fast import rejects.
    dialog.addEventListener('close', event => {
      event.stopImmediatePropagation();
      window.deliverFixtureSettingsClose = () => dialog.dispatchEvent(new Event('close'));
    }, { capture: true, once: true });
  });
  await chooseWorkbook(page, 'reordered', 'append');
  await expect(page.locator('#beamRawMessage')).toContainText('[RAW-APPLY]');
  await expect.poll(() => page.evaluate(() => typeof window.deliverFixtureSettingsClose)).toBe('function');

  const query = page.locator('#beamQuery');
  await expect(query).toBeFocused();
  await page.evaluate(() => window.deliverFixtureSettingsClose());
  await expect(query).toBeFocused();

  const settings = await referenceSettings(page);
  await settings.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();
});

test('UX-04 reference fingerprint completion preserves a focused draft in the settings dialog', async ({ beam: page }) => {
  // Hold the result of a real WebCrypto call at the browser API boundary.
  await page.addInitScript(() => {
    const digest = SubtleCrypto.prototype.digest;
    SubtleCrypto.prototype.digest = async function (algorithm, bytes) {
      const result = await digest.call(this, algorithm, bytes);
      if (new TextDecoder().decode(bytes).includes('REF-WHOLESALE') && !window.resumeFixtureFingerprint) {
        await new Promise(resolve => { window.resumeFixtureFingerprint = resolve; });
      }
      return result;
    };
  });
  await page.reload();
  await importOriginal(page);
  await enterInspection(page, wholesaleTracking);
  await enterScan(page.locator('#barcode'), wholesaleBarcode);
  const confirmation = page.locator('#confirmInspection');
  await expect(confirmation).toBeDisabled();
  await expect(page.locator('#confirmHint')).toContainText('기준 데이터 확인을 준비');
  await expect.poll(() => page.evaluate(() => typeof window.resumeFixtureFingerprint)).toBe('function');

  const settings = await referenceSettings(page);
  await settings.getByText('자료별 추가 · 붙여넣기', { exact: true }).click();
  await settings.getByRole('button', { name: '반품 예정 자료 추가' }).click();
  const draft = settings.getByRole('textbox', { name: '또는 데이터 붙여넣기' });
  await draft.fill('Synthetic draft awaiting review');
  await expect(draft).toBeFocused();
  await page.evaluate(() => window.resumeFixtureFingerprint());
  await expect(confirmation).toBeEnabled();
  await expect(settings).toBeVisible();
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('Synthetic draft awaiting review');
});

test('UX-05 B2B uses store names and B2C uses customer names and preserves tracking ambiguity', async ({ beam: page }) => {
  await importOriginal(page);
  const query = page.locator('#beamQuery');
  await expect(query).toHaveAccessibleName('매장명 또는 반송장번호');
  await query.fill('Mina Example');
  await expect(page.locator('#beamEmptyTitle')).toHaveText('일치하는 반품 주문이 없어요');
  await query.fill('Juniper Supply');
  await expect(page.getByRole('button', { name: /Juniper Supply · 주문 1/ })).toBeVisible();
  await page.getByRole('button', { name: 'B2C', exact: true }).click();
  await expect(query).toHaveAccessibleName('고객명 또는 반송장번호');
  await expect(query).toBeFocused();
  await expect(page.locator('#beamEmptyTitle')).toHaveText('일치하는 반품 주문이 없어요');
  await query.fill('Mina Example');
  await expect(page.getByRole('button', { name: /Mina Example.*HOME-RETURN-18/ })).toBeVisible();

  await query.fill('3344556677');
  await query.press('Enter');
  await expect(searchStatus(page)).toContainText('반송장번호를 찾지 못했어요');
  await query.fill('００３３ ４４５５–６６７７');
  await expect(searchStatus(page)).toHaveText('검색 결과 2건');
  await query.press('Enter');
  await expect(page.getByRole('button', { name: '파일 열기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mina Example.*HOME-RETURN-18/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mira Example · 주문 1/ })).toBeVisible();
  await expect(page.locator('#barcode')).toBeHidden();
});

test('combined import reports an invalid picking refresh without losing the previous carton or scan', async ({beam: page}) => {
  await loadCartons(page,'Outbound');
  await chooseOutboundCarton(page,'OUT-1','BOX-1');
  await enterScan(page.locator('#cartonScan'),'0001234567890');
  await expect(page.locator('#cartonCount')).toContainText('정상 1 / 전체 예정 3');
  await page.locator('#beamHomeBack').click();
  const current=page.locator('.beam-home-word[aria-current=true]');
  for(let i=0;i<4&&(await current.getAttribute('id'))!=='beamHomeReturns';i++)await current.press('ArrowRight');
  await expect(current).toHaveAttribute('id','beamHomeReturns');
  await current.press('Enter');

  const settings = await referenceSettings(page);
  await chooseReferenceFile(page,settings,invalidPickingWorkbook());
  const columns=await mapWorkbook(page,'Fictional Annex',annexMapping);
  await mapConfirm(columns).click();
  await expect(page.locator('#beamRawAnnounce')).toHaveText('RAW 연결 완료 · 반품 예정 1행 · 출고 이전 기준 유지');
  await page.locator('#beamQuery').fill('Gamma Annex');
  await expect(page.getByRole('button',{name:/Gamma Annex · 주문 1/})).toBeVisible();

  await page.locator('#beamHomeBack').click();
  await openCartons(page,'Outbound');
  await expect(page.locator('#cartonSource')).toHaveText('이 작업의 시트에서 읽을 수 없는 값이 있어요. · 이전 기준 파일 사용 중: cartons.xlsx');
  await expect(page.locator('#cartonMapButton')).toBeVisible();
  await chooseOutboundCarton(page,'OUT-1','BOX-1');
  await expect(page.locator('#cartonCount')).toContainText('정상 1 / 전체 예정 3');
});

test('the same invalid picking sheet without a previous source never enables outbound search', async ({beam: page}) => {
  await page.getByRole('button',{name:/Returns/}).click();
  await chooseReferenceFile(page,await referenceSettings(page),invalidPickingWorkbook());
  await mapConfirm(await mapWorkbook(page,'Fictional Annex',annexMapping)).click();
  await expectImported(page,1);

  await page.locator('#beamHomeBack').click();
  await openCartons(page,'Outbound');
  await expect(page.locator('#cartonSource')).toHaveText('이 작업의 시트에서 읽을 수 없는 값이 있어요.');
  await expect(page.locator('#cartonSearchButton')).toBeDisabled();
  await expect(page.locator('#cartonMapButton')).toBeVisible();
});

test('combined RAW manual carton mapping reads its own SKU pack size and restores completed FULL scans', async ({beam: page}) => {
  const workbook=invalidPickingWorkbook({
    pickingName:'Custom Picking Export',
    picking:[
      ['Order ID','Carton Label ID','Product Barcode','SKU','Product Name','Picked Units','Destination Store','Verification Unit','Units per Case','Case Barcode'],
      ['CASE-ORDER','CASE-CARTON','0001234567890','SKU-A','Fictional article','10','Gamma Annex','CASE','','CASE-10'],
      ['CASE-ORDER','CONFLICT-CARTON','0001234567890','SKU-A','Fictional article','10','Gamma Annex','CASE','5','CASE-5'],
    ],
    catalog:[
      ['Product Barcode','SKU','Product Name','Units per Case'],
      ['0001234567890','SKU-A','Fictional article','10'],
    ],
  });
  async function connect() {
    await page.getByRole('button',{name:/Returns/}).click();
    await chooseReferenceFile(page,await referenceSettings(page),workbook);
  }
  await connect();
  await page.getByRole('combobox',{name:'SKU Master'}).selectOption({label:'Product Catalog'});
  await mapConfirm(await mapWorkbook(page,'Fictional Annex',annexMapping)).click();
  const catalog=page.getByRole('dialog',{name:'SKU Master · 열 연결'});
  await catalog.getByRole('combobox',{name:'헤더 행'}).selectOption('0');
  for(const [name,label] of [
    ['상품 바코드','A · Product Barcode'],['상품 코드','B · SKU'],['상품명','C · Product Name'],['박스당 수량 (선택)','D · Units per Case'],
  ])await catalog.getByRole('combobox',{name,exact:true}).selectOption({label});
  await mapConfirm(catalog).click();
  await expect(page.locator('#beamRawAnnounce')).toContainText('RAW 연결 완료 · 반품 예정 1행');

  await page.locator('#beamHomeBack').click();
  await openCartons(page,'Outbound');
  await page.locator('#cartonMapButton').click();
  const dialog=page.locator('#cartonImportDialog');
  await dialog.locator('select').selectOption({label:'Custom Picking Export'});
  await page.locator('#cartonImportApply').click();
  await expect(dialog.locator('.mapping-fields')).toBeVisible();
  await page.locator('#cartonImportApply').click();

  await chooseOutboundCarton(page,'CASE-ORDER','CONFLICT-CARTON');
  await expect(page.locator('#cartonScan')).toBeEnabled();
  await expect(page.locator('#cartonScanCase')).toBeDisabled();
  await page.locator('#cartonBack').click();
  await page.locator('.outbound-carton').filter({hasText:'CASE-CARTON'}).click();
  await page.locator('#cartonScanCase').click();
  await enterScan(page.locator('#cartonScan'),'CASE-10');
  await expect(page.locator('#cartonCount')).toContainText('정상 10 / 전체 예정 10');
  await page.locator('#cartonFinish').click();
  await expect(page.locator('#cartonFeedback')).toHaveText('검수를 완료했어요.');
  await expect(page.locator('#cartonFinish')).toBeDisabled();

  await page.reload();
  await connect();
  await expect(page.locator('#beamRawAnnounce')).toContainText('RAW 연결 완료 · 반품 예정 1행');
  await page.locator('#beamHomeBack').click();
  await openCartons(page,'Outbound');
  await expect(page.locator('#cartonMapButton')).toBeHidden();
  await chooseOutboundCarton(page,'CASE-ORDER','CASE-CARTON');
  await expect(page.locator('#cartonCount')).toContainText('정상 10 / 전체 예정 10');
  await expect(page.locator('#cartonScan')).toBeDisabled();
});

function invalidPickingWorkbook({pickingName="Picking Results",picking,catalog}={}) {
  const spreadsheet='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationship='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const sheets=[
    ['Fictional Annex', [
      ['Synthetic combined import'],
      ['Annex units','Annex shop','Annex key','Annex code','Annex title','Annex barcode','Annex waybill'],
      ['2','Gamma Annex','ANNEX-1','SKU-A','Fictional article','0001234567890','1234567890'],
    ]],
    [pickingName, picking??[
      ['Order ID','Carton Label ID','Product Barcode','SKU','Product Name','Picked Units','Destination Store'],
      ['NEW-ORDER','NEW-CARTON','0001234567890','SKU-A','Fictional article','not a quantity','Gamma Annex'],
    ]],
  ];
  if(catalog)sheets.push(['Product Catalog',catalog]);
  const sheetXml=rows=>`<worksheet xmlns="${spreadsheet}"><sheetData>${rows.map((values,i)=>
    `<row r="${i+1}">${values.map((value,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" t="inlineStr"><is><t>${value}</t></is></c>`).join('')}</row>`
  ).join('')}</sheetData></worksheet>`;
  return {name:catalog?'synthetic-case-reference.xlsx':'synthetic-partial-refresh.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:zip({
    'xl/workbook.xml':`<workbook xmlns="${spreadsheet}" xmlns:r="${relationship}"><sheets>${sheets.map(([name],i)=>`<sheet name="${name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${relationship}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}</Relationships>`,
    ...Object.fromEntries(sheets.map(([,rows],i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(rows)])),
  })};
}
