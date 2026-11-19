import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import { transitionFixtureSession } from './profile-auth-fixture';

const commander = { id: 'guest-commander-fixture', name: 'Talrand, Sky Summoner', imageUrl: null,
  typeLine: 'Legendary Creature — Merfolk Wizard', colorIdentity: ['U'], oracleText: '', keywords: [] };

async function openGuests(page: Page, withGuest = false) {
  const groupId = process.env.E2E_GROUP_ID!, guestId = randomUUID();
  const guest = { id: guestId, group_id: groupId, display_name: 'Guest command fixture', last_played_at: null, arena_guest_decks: [] };
  await page.route('**/rest/v1/arena_guests?*', route => route.request().method() === 'GET'
    ? route.fulfill({ status: 200, json: withGuest ? [guest] : [] }) : route.fallback());
  await fixtureLogin(page);
  await page.locator(`a[href="/table/${groupId}"]`).first().click();
  await page.getByRole('tab', { name: /Players/ }).click();
  await expect(page.getByRole('heading', { name: 'Playgroup guests and decks', exact: true })).toBeVisible();
  return guest;
}

async function prepareGuest(page: Page) {
  await page.route('**/api/scryfall-commanders?*', route => route.fulfill({ status: 200, json: { data: [commander] } }));
  await page.getByRole('button', { name: 'Add guest', exact: true }).click();
  await page.getByPlaceholder('e.g. Marco', { exact: true }).fill('Guest command fixture');
  await page.getByPlaceholder('Card name...', { exact: true }).fill('talrand');
  await page.getByRole('button', { name: /Talrand, Sky Summoner.*Legendary Creature/ }).click();
  return page.getByRole('button', { name: 'Add guest', exact: true });
}

for (const stage of ['guest', 'deck', 'delete'] as const) {
  for (const departure of ['navigate', 'account'] as const) {
    test(`arena guest command ${stage} cancels on ${departure}`, async ({ page }) => {
      test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
      const guest = await openGuests(page, stage === 'delete');
      let started = 0, aborted = 0;
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const requests = new Set<import('@playwright/test').Request>();
      page.on('requestfailed', request => { if (requests.has(request)) aborted += 1; });
      await page.route('**/rest/v1/arena_guests?*', async route => {
        const method = route.request().method();
        if (method === 'GET') return route.fallback();
        if (stage === 'deck' && method === 'POST') return route.fulfill({ status: 201, json: guest });
        if (method === 'PATCH') return route.fulfill({ status: 204 });
        requests.add(route.request()); started += 1; await pending;
        await route.fulfill({ status: 503, json: { message: 'Synthetic guest command failure' } }).catch(() => { /* Disposed command. */ });
      });
      if (stage === 'deck') await page.route('**/rest/v1/arena_guest_decks?*', async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        requests.add(route.request()); started += 1; await pending;
        await route.fulfill({ status: 503, json: { message: 'Synthetic guest deck failure' } }).catch(() => { /* Disposed command. */ });
      });
      try {
        if (stage === 'delete') {
          page.on('dialog', dialog => dialog.accept());
          await page.getByRole('button', { name: `Delete guest: ${guest.display_name}`, exact: true }).click();
        } else await (await prepareGuest(page)).click();
        await expect.poll(() => started).toBe(1);
        if (departure === 'navigate') {
          await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/);
        } else {
          await transitionFixtureSession(page, true);
          await expect(page.getByRole('button', { name: 'Back to home', exact: true })).toBeVisible();
        }
        await expect.poll(() => aborted).toBe(1);
        release();
        await expect(page.getByText('Synthetic guest command failure', { exact: true })).toHaveCount(0);
        await expect(page.getByText('Synthetic guest deck failure', { exact: true })).toHaveCount(0);
        if (departure === 'account') await expect(page.getByRole('heading', { name: 'Add guest', exact: true })).toHaveCount(0);
      } finally { release(); }
    });
  }
}

for (const departure of ['close', 'navigate'] as const) {
  test(`arena guest search cancels on ${departure}`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    await openGuests(page);
    let started = 0, aborted = 0;
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    page.on('requestfailed', request => { if (request.url().includes('/api/scryfall-commanders?')) aborted += 1; });
    await page.route('**/api/scryfall-commanders?*', async route => {
      started += 1; await pending;
      await route.fulfill({ status: 200, json: { data: [commander] } }).catch(() => { /* Disposed search. */ });
    });
    try {
      await page.getByRole('button', { name: 'Add guest', exact: true }).click();
      await page.getByPlaceholder('Card name...', { exact: true }).fill('talrand');
      await expect.poll(() => started).toBe(1);
      if (departure === 'close') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      else { await page.goBack(); await expect(page).toHaveURL(/\/dashboard$/); }
      await expect.poll(() => aborted).toBe(1);
    } finally { release(); }
  });
}
