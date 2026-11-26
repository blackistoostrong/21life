import type {Page} from '@playwright/test';
import {fixtureLogin} from './fixture-login';

export async function configureTracker(page:Page){
  const groupId=process.env.E2E_GROUP_ID!;
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${groupId}"]`).first().click();
  await page.getByRole('button',{name:/Play Game|Gioca live/}).click();
  await page.getByRole('button',{name:'2',exact:true}).click();
  await page.getByRole('button',{name:/Step 4|Passaggio 4/}).click();
  for(let seat=1;seat<=2;seat++){
    await page.getByRole('button',{name:new RegExp(`^(Seat|Posto) ${seat}`)}).click();
    const select=page.getByTestId('live-player-select');
    const option=select.locator('option:not([disabled])').filter({hasNotText:/Choose player|Scegli giocatore/}).first();
    await select.selectOption((await option.getAttribute('value'))!);
    await page.getByTestId('live-deck-option').first().click();
  }
  return groupId;
}
