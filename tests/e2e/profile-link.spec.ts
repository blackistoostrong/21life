import { expect, test } from '@playwright/test';
import { openProfileRefreshFixture } from './profile-refresh-fixture';

test('profile external link preserves identity, discarded input and failed drafts through retry', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const { commander, deckId } = await openProfileRefreshFixture(page, 'single');
  const targetUrl = 'https://archidekt.com/decks/456789';
  let previews = 0; let writes = 0;
  await page.route('**/api/deck-import', route => {
    expect(route.request().postDataJSON()).toEqual({ url: targetUrl }); previews += 1;
    return route.fulfill({ status: 200, json: { name: 'External source name', commander,
      commanderImageUrl: '/favicon.ico?linked-source', commanderOptions: [{ name: commander,
        imageUrl: '/favicon.ico?linked-source', colorIdentity: ['U'] }], colorIdentity: ['U'],
      bracket: '4', sourceType: 'archidekt', sourceUrl: targetUrl } });
  });
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ status: 403 });
    expect(new URL(route.request().url()).searchParams.get('id')).toBe(`eq.${deckId}`);
    const payload = route.request().postDataJSON();
    expect(payload).toMatchObject({ source_url: targetUrl, source_type: 'archidekt', bracket: '4',
      commander_cmc: 4, color_identity: ['U'] });
    expect(payload).not.toHaveProperty('name'); expect(payload).not.toHaveProperty('commander');
    writes += 1;
    return writes === 1 ? route.fulfill({ status: 503, json: { message: 'Synthetic external link failure' } })
      : route.fulfill({ status: 204 });
  });
  const open = page.getByTitle('Link an Archidekt or Moxfield list', { exact: true });
  const dialog = page.getByRole('dialog');
  const input = dialog.getByPlaceholder('https://archidekt.com/decks/... oppure https://moxfield.com/decks/...', { exact: true });
  await open.click();
  await expect(input).toHaveValue('https://archidekt.com/decks/345678');
  await input.fill(targetUrl);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(previews).toBe(0); expect(writes).toBe(0);
  await open.click();
  await expect(input).toHaveValue('https://archidekt.com/decks/345678');
  await input.fill(targetUrl);
  await dialog.getByRole('button', { name: 'Link list', exact: true }).click();
  await expect(page.getByText('Synthetic external link failure', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(targetUrl);
  await expect(dialog.getByRole('button', { name: 'Link list', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Link list', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('List linked', { exact: true })).toBeVisible();
  const card = page.locator('[data-web-card]').filter({ has: page.getByRole('heading', { name: 'External refresh fixture', exact: true }) });
  await expect(card.getByRole('link', { name: /View on Archidekt/ })).toHaveAttribute('href', targetUrl);
  await expect(card.getByText(commander, { exact: true })).toBeVisible();
  expect(writes).toBe(2); expect(previews).toBe(2);
});
