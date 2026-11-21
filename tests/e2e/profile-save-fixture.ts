import { expect, type Page, type Route } from '@playwright/test';
import { openPasswordFixture } from './profile-fixture';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

export const commander = 'Persistence Commander';
export const image = '/favicon.ico?save-preview';
export const firstUrl = 'https://archidekt.com/decks/123456';
export const secondUrl = 'https://archidekt.com/decks/234567';
export const deckId = '00000000-0000-4000-8000-000000000004';
const imported = (sourceUrl = firstUrl) => ({ name: sourceUrl === firstUrl ? 'Save fixture' : 'Second save fixture',
  commander, commanderImageUrl: image, commanderOptions: [{ name: commander, imageUrl: image, colorIdentity: ['U'] }],
  colorIdentity: ['U'], bracket: '3', sourceUrl, sourceType: 'archidekt' });

export async function openProfileSaveFixture(page: Page, source: 'URL' | 'manual' | 'bulk', duplicate = false,
  optionalArts?: (route: Route) => Promise<void>) {
  await openPasswordFixture(page);
  // Cover both queryless inserts and filtered updates; deny writes unless the
  // individual test explicitly mocks its persistence boundary afterwards.
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => ['POST', 'PATCH', 'DELETE'].includes(route.request().method())
    ? route.fulfill({ status: 403, json: { message: 'Unexpected fixture write' } }) : route.continue());
  await page.route('**/rest/v1/rpc/sync_archidekt_decks', route => route.fulfill({ status: 403, json: { message: 'Unexpected fixture RPC' } }));
  const userId = process.env.E2E_USER_ID!;
  await page.route('**/api/edhrec-*', route => route.fulfill({ status: 404, json: {} }));
  await page.route('**/api/deck-import', route => route.fulfill({ status: 200, json: imported() }));
  await page.route('**/api/archidekt-user-decks', route => route.fulfill({ status: 200, json: { decks: [imported(), imported(secondUrl)] } }));
  await page.route('**/api/scryfall-card-arts?*', route => route.fulfill({ status: 200, json: { data: [] } }));
  await page.route('https://api.scryfall.com/cards/named?*', route => route.fulfill({ status: 200, json: { object: 'card', name: commander, cmc: 4 } }));
  await page.route('https://api.scryfall.com/cards/search?*', route => {
    if (optionalArts && new URL(route.request().url()).searchParams.get('unique') === 'art') return optionalArts(route);
    return route.fulfill({ status: 200, json: {
    data: new URL(route.request().url()).searchParams.get('unique') === 'art' ? [] : [{
      id: 'save-commander', name: commander, type_line: 'Legendary Creature', color_identity: ['U'],
      oracle_text: '', keywords: [], image_uris: { art_crop: image },
    }],
  } }); });
  const subject = (authorization: string) => {
    const id = JSON.parse(Buffer.from(authorization.split(' ')[1].split('.')[1], 'base64url').toString()).sub as string;
    if (![userId, process.env.E2E_SECOND_USER_ID].includes(id)) throw new Error('Unexpected disposable Auth subject');
    return id;
  };
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => { const id = subject(route.request().headers().authorization);
    return route.fulfill({ status: 200, json: {
    schemaVersion: 2, scope: 'personal', userId: id, revision: 'c'.repeat(32), total: duplicate && id === userId ? 1 : 0, next: null,
    decks: duplicate && id === userId ? [{ id: deckId, user_id: userId, group_id: null, name: 'Existing save fixture', commander,
      commander_image: image, commander_cmc: 4, commander_options: [{ name: commander, imageUrl: image, colorIdentity: ['U'] }],
      color_identity: ['U'], bracket: '3', source_type: 'archidekt', source_url: firstUrl,
      is_favorite: false, is_archived: false, created_at: '2026-01-01T00:00:00Z', updated_at: null }] : [],
  } }); });
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    const report = profileCatalogFixture(); report.userId = subject(route.request().headers().authorization);
    if (duplicate && report.userId === userId) report.decks[0].deck_id = deckId; else { report.total = 0; report.decks = []; }
    return route.fulfill({ status: 200, json: report });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Add Deck', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add Deck', exact: true }).click();
  if (source === 'URL') {
    await page.getByRole('button', { name: /^Import from URL/ }).click();
    await page.getByRole('dialog').getByPlaceholder('https://archidekt.com/decks/123456 o https://www.moxfield.com/decks/...', { exact: true }).fill(firstUrl);
    await page.getByRole('button', { name: 'Import Deck', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Save fixture', exact: true })).toBeVisible();
  } else if (source === 'bulk') {
    await page.getByRole('button', { name: /^Import by Archidekt username/ }).click();
    await page.getByRole('dialog').getByPlaceholder('Archidekt username', { exact: true }).fill('save_owner');
    await page.getByRole('button', { name: 'Load Decks', exact: true }).click();
    await expect(page.getByText('2/2 decks selected', { exact: true })).toBeVisible();
  } else {
    await page.getByRole('button', { name: /Add manually|Aggiungi manualmente/ }).click();
    await page.getByRole('dialog').getByPlaceholder(/Search commander|Cerca comandante/).fill('Persistence');
    await page.getByRole('button', { name: new RegExp(`^${commander}`) }).click();
  }
  return page.getByRole('dialog').getByRole('button', { name: source === 'bulk' ? 'Save Decks' : source === 'manual' ? 'Add Deck' : 'Save Deck', exact: true });
}

