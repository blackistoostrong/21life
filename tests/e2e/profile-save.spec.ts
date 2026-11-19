import { expect, test } from '@playwright/test';
import { commander, image, firstUrl, secondUrl, deckId, openProfileSaveFixture } from './profile-save-fixture';

for (const source of ['URL', 'manual'] as const) {
  test(`profile persistence ${source} retains failed drafts and retries the owned insert`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    const save = await openProfileSaveFixture(page, source);
    let attempts = 0;
    await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
      if (route.request().method() !== 'POST') return route.continue();
      expect(route.request().postDataJSON()).toMatchObject({ user_id: process.env.E2E_USER_ID, group_id: null,
        commander, commander_image: image, commander_cmc: 4, color_identity: ['U'],
        source_type: source === 'manual' ? 'manual' : 'archidekt', source_url: source === 'manual' ? null : firstUrl });
      attempts += 1;
      return attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Synthetic persistence failure' } }) : route.fulfill({ status: 201, json: [] });
    });
    await save.click();
    await expect(page.getByText('Synthetic persistence failure', { exact: true })).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(source === 'manual' ? 'Deck created!' : 'Deck added!', { exact: true })).toBeVisible();
    expect(attempts).toBe(2);
  });
}

test('profile persistence URL overwrite cancels without writing then retries the correct owned update', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const save = await openProfileSaveFixture(page, 'URL', true);
  let attempts = 0;
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${deckId}`);
    expect(route.request().postDataJSON()).toMatchObject({ name: 'Save fixture', commander, source_url: firstUrl, commander_cmc: 4 });
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Synthetic persistence failure' } }) : route.fulfill({ status: 204 });
  });
  await save.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  expect(attempts).toBe(0);
  for (let attempt = 0; attempt < 2; attempt++) {
    await save.click();
    await page.getByRole('button', { name: 'Replace', exact: true }).click();
    if (!attempt) await expect(page.getByText('Synthetic persistence failure', { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Deck updated!', { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});

test('profile persistence bulk cancel, new-only and overwrite use one own-account RPC with preserved selections on error', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const save = await openProfileSaveFixture(page, 'bulk', true);
  let attempts = 0;
  await page.route('**/rest/v1/rpc/sync_archidekt_decks', route => {
    const rows = route.request().postDataJSON().p_decks;
    expect(rows).toHaveLength(attempts === 0 ? 1 : 2);
    expect(rows[0]).toMatchObject({ user_id: process.env.E2E_USER_ID, group_id: null,
      source_url: secondUrl, commander, commander_cmc: 4, color_identity: ['U'] });
    attempts += 1;
    return attempts === 1 ? route.fulfill({ status: 503, json: { message: 'Synthetic bulk save failure' } }) : route.fulfill({ status: 200, json: [] });
  });
  await save.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();
  expect(attempts).toBe(0);
  await save.click();
  await page.getByRole('button', { name: 'Import new only', exact: true }).click();
  await expect(page.getByText('Synthetic bulk save failure', { exact: true })).toBeVisible();
  await expect(page.getByText('2/2 decks selected', { exact: true })).toBeVisible();
  await save.click();
  await page.getByRole('button', { name: 'Replace', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Decks imported!', { exact: true })).toBeVisible();
  expect(attempts).toBe(2);
});
