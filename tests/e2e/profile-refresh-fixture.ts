import { expect, type Page } from '@playwright/test';
import { openPasswordFixture } from './profile-fixture';
import { profileCatalogFixture } from '../fixtures/profile-catalog';

export async function openProfileRefreshFixture(page: Page, mode: 'single' | 'bulk', count = 1) {
  const userId = process.env.E2E_USER_ID!;
  const deckId = '00000000-0000-4000-8000-000000000020';
  const commander = 'External refresh commander';
  let writes = 0;
  let imports = 0;
  let budgetAllowed = false;
  let budgetRequests = 0;
  await openPasswordFixture(page);
  const decks = Array.from({ length: count }, (_, index) => ({ id: index === 0 ? deckId : `00000000-0000-4000-8000-${String(index + 20).padStart(12, '0')}`, user_id: userId, group_id: null, name: 'External refresh fixture', commander,
      commander_image: '/favicon.ico?refresh-current', commander_cmc: 4,
      commander_options: [{ name: commander, imageUrl: '/favicon.ico?refresh-current', colorIdentity: ['U'] }],
      color_identity: ['U'], bracket: '3', source_type: 'archidekt', source_url: 'https://archidekt.com/decks/345678',
      is_favorite: false, is_archived: false, created_at: '2026-01-01T00:00:00Z', updated_at: null }));
  await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => route.fulfill({ status: 200, json: {
    schemaVersion: 2, scope: 'personal', userId, revision: 'd'.repeat(32), total: count, next: null,
    decks,
  } }));
  await page.route('**/rest/v1/rpc/get_profile_deck_performance_v2', route => {
    const report = profileCatalogFixture(); report.userId = userId; report.total = count;
    report.decks = decks.map(deck => ({ ...report.decks[0], deck_id: deck.id }));
    return route.fulfill({ status: 200, json: report });
  });
  await page.route('**/api/profile/deck-refresh-budget', route => {
    budgetRequests += 1;
    return route.fulfill({ status: budgetAllowed ? 200 : 429, json: {} });
  });
  await page.route('**/api/deck-import', route => {
    expect(route.request().postDataJSON()).toEqual({ url: 'https://archidekt.com/decks/345678', fresh: true });
    imports += 1;
    return route.fulfill({ status: 200, json: { name: 'Refreshed external fixture', commander,
      commanderImageUrl: '/favicon.ico?refresh-source', commanderOptions: [{ name: commander,
        imageUrl: '/favicon.ico?refresh-source', colorIdentity: ['U'] }], colorIdentity: ['U'],
      bracket: '4', sourceType: 'archidekt', sourceUrl: 'https://archidekt.com/decks/345678' } });
  });
  await page.route('https://api.scryfall.com/cards/named?*', route => route.fulfill({ status: 200,
    json: { object: 'card', name: commander, cmc: 4 } }));
  await page.route('**/api/edhrec-*', route => route.fulfill({ status: 404, json: {} }));
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
    if (route.request().method() !== 'PATCH') return route.fulfill({ status: 403 });
    expect(decks.map(deck => `eq.${deck.id}`)).toContain(new URL(route.request().url()).searchParams.get('id'));
    expect(route.request().postDataJSON()).toMatchObject({ name: 'Refreshed external fixture', commander,
      commander_image: '/favicon.ico?refresh-current', commander_cmc: 4, bracket: '4', color_identity: ['U'] });
    writes += 1;
    return mode === 'single' && writes === 1
      ? route.fulfill({ status: 503, json: { message: 'Synthetic external refresh failure' } })
      : route.fulfill({ status: 204 });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'External refresh fixture', exact: true }).first()).toBeVisible();

  return { commander, deckId, decks, counts: () => ({ writes, imports, budgetRequests }),
  allowBudget: () => { budgetAllowed = true; } };
}
