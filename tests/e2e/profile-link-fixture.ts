import { expect, type Page } from '@playwright/test';
import { openProfileRefreshFixture } from './profile-refresh-fixture';

export async function openProfileLinkFixture(page: Page) {
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
  return { commander, deckId, targetUrl, open, dialog, input, counts: () => ({ previews, writes }) };
}
