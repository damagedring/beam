import { expect } from '@playwright/test';
import { openCartons, test } from './beam-fixture.mjs';

test('Cry Later B2B labels target a single carton directly across different orders', async ({beam:page})=>{
  await page.getByRole('button',{name:'Settings'}).click();
  await page.locator('#helpLauncher').click();
  const help=page.getByRole('dialog',{name:'도움말 · 예제'});
  await help.getByRole('button',{name:'Cry Later 예제 체험'}).click();
  await expect(help.getByRole('status')).toHaveText('Cry Later 예제를 불러왔습니다.');
  await help.getByRole('button',{name:'닫기',exact:true}).click();
  await page.locator('#beamHomeBack').click();
  await openCartons(page,'Outbound');
  const query=page.locator('#cartonQuery');
  for(const label of ['CL-OB-0001-C01','CL-OB-0005-C01']){
    await query.fill(label);
    await query.press('Enter');
    if(await query.isVisible()) await query.press('Enter');
    await expect(page.locator('#cartonCurrent')).toHaveText(label);
    await expect(page.locator('#cartonScopes button')).toHaveCount(0);
    await page.locator('#cartonBack').click();
    if(!await query.isVisible()) await page.locator('#cartonBack').click();
  }
});
