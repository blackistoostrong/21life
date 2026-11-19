import { expect, test } from '@playwright/test';
import { openProfileRefreshFixture } from './profile-refresh-fixture';
import { mockEmptySecondAccountCatalog, transitionFixtureSession } from './profile-auth-fixture';

for (const action of ['favorite', 'archive', 'delete'] as const) {
  test(`profile catalog command ${action} aborts a pending mutation on navigation`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    await openProfileRefreshFixture(page, 'single');
    let started = 0; let aborted = 0; const releases: Array<() => void> = [];
    page.on('requestfailed', request => { if (/\/rest\/v1\/decks(?:\?|$)/.test(request.url())) aborted += 1; });
    await page.route(/\/rest\/v1\/decks(?:\?|$)/, async route => {
      if (!['PATCH', 'DELETE'].includes(route.request().method())) return route.fulfill({ status: 403 });
      started += 1; await new Promise<void>(resolve => releases.push(resolve));
      await route.fulfill({ status: 204 }).catch(() => { /* Disposed mutation. */ });
    });
    if (action === 'delete') page.on('dialog', dialog => dialog.accept());
    try {
      for (let opening = 0; opening < 2; opening += 1) {
        if (opening) await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
        await page.getByTitle(action === 'favorite' ? 'Add to favorites' : action === 'archive' ? 'Archive deck' : 'Delete deck', { exact: true }).click();
        await expect.poll(() => started).toBe(opening + 1);
        await page.getByRole('button', { name: 'Back to home', exact: true }).click();
        await expect.poll(() => aborted).toBe(opening + 1);
        releases.splice(0).forEach(release => release());
        await expect(page.getByText(action === 'favorite' ? 'Favorite not updated'
          : action === 'archive' ? 'Deck archived' : 'Deck deleted', { exact: true })).toHaveCount(0);
      }
    } finally { releases.forEach(release => release()); }
  });
}

test('profile catalog command favorite rollback preserves a newer server snapshot', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const fixture = await openProfileRefreshFixture(page, 'single');
  let started = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, async route => {
    expect(route.request().method()).toBe('PATCH'); started += 1; await pending;
    await route.fulfill({ status: 503, json: { message: 'Older favorite write failed' } })
      .catch(() => { /* A failed test may already have disposed its request. */ });
  });
  try {
    await page.getByTitle('Add to favorites', { exact: true }).click();
    await expect.poll(() => started).toBe(1);
    await expect(page.getByTitle('Remove from favorites', { exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => route.fulfill({ status: 200, json: {
      schemaVersion: 2, scope: 'personal', userId: process.env.E2E_USER_ID!, revision: 'f'.repeat(32),
      total: 1, next: null, decks: fixture.decks.map(deck => ({ ...deck, name: 'Authoritative updated deck',
        is_favorite: true, updated_at: '2026-11-19T12:00:00Z' })),
    } }));
    await transitionFixtureSession(page);
    await expect(page.getByRole('heading', { name: 'Authoritative updated deck', exact: true })).toBeVisible();
    release();
    await expect(page.getByText('Favorite not updated', { exact: true })).toBeVisible();
    await expect(page.getByTitle('Remove from favorites', { exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally { release(); }
});

for (const action of ['favorite', 'archive', 'delete'] as const) {
  test(`profile catalog command ${action} preserves error retry and the owned mutation contract`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    const fixture = await openProfileRefreshFixture(page, 'single');
    let writes = 0; let deleted = false;
    await page.route('**/rest/v1/rpc/get_profile_catalog_page_v2', route => deleted
      ? route.fulfill({ status: 200, json: { schemaVersion: 2, scope: 'personal', userId: process.env.E2E_USER_ID!,
        revision: 'e'.repeat(32), total: 0, next: null, decks: [] } }) : route.fallback());
    await page.route(/\/rest\/v1\/decks(?:\?|$)/, route => {
      const params = new URL(route.request().url()).searchParams;
      expect(params.get('id')).toBe(`eq.${fixture.deckId}`);
      expect(route.request().method()).toBe(action === 'delete' ? 'DELETE' : 'PATCH');
      if (action !== 'delete') {
        expect(params.get('user_id')).toBe(`eq.${process.env.E2E_USER_ID}`);
        expect(route.request().postDataJSON()).toEqual(action === 'favorite' ? { is_favorite: true } : { is_archived: true });
        if (action === 'archive') expect(params.get('group_id')).toBe('is.null');
      }
      writes += 1;
      if (writes === 1) return route.fulfill({ status: 503, json: { message: 'Synthetic private mutation failure' } });
      if (action === 'delete') deleted = true;
      return route.fulfill({ status: 204 });
    });
    const control = page.getByTitle(action === 'favorite' ? 'Add to favorites' : action === 'archive' ? 'Archive deck' : 'Delete deck', { exact: true });
    if (action === 'delete') {
      page.once('dialog', dialog => dialog.dismiss());
      await control.click(); await expect(control).toBeEnabled(); expect(writes).toBe(0);
      page.on('dialog', dialog => dialog.accept());
    }
    await control.click();
    await expect(page.getByText(action === 'favorite' ? 'Favorite not updated' : action === 'archive'
      ? 'Synthetic private mutation failure' : 'Failed to delete deck', { exact: true })).toBeVisible();
    await expect(control).toBeEnabled(); expect(writes).toBe(1);
    await control.click();
    if (action === 'favorite') {
      await expect(page.getByTitle('Remove from favorites', { exact: true })).toHaveAttribute('aria-pressed', 'true');
    } else {
      await expect(page.getByRole('heading', { name: 'External refresh fixture', exact: true })).toHaveCount(0);
      await expect(page.getByText(action === 'archive' ? 'Deck archived' : 'Deck deleted', { exact: true })).toBeVisible();
    }
    await expect.poll(() => writes).toBe(2);
  });
}

test('profile catalog command favorite synchronously blocks duplicate submission', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  await openProfileRefreshFixture(page, 'single');
  let started = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, async route => {
    started += 1; await pending;
    await route.fulfill({ status: 204 }).catch(() => { /* Navigation cancels the owned write. */ });
  });
  try {
    await page.getByTitle('Add to favorites', { exact: true }).evaluate(element => {
      (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click();
    });
    await expect.poll(() => started).toBe(1);
    await expect(page.getByTitle('Remove from favorites', { exact: true })).toBeDisabled();
    await expect(page.getByTitle('Archive deck', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Back to home', exact: true }).click();
  } finally { release(); }
});

test('profile catalog command account switch cancels archive without old feedback', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  await openProfileRefreshFixture(page, 'single'); await mockEmptySecondAccountCatalog(page);
  let started = 0; let aborted = 0; let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => { if (/\/rest\/v1\/decks(?:\?|$)/.test(request.url())) aborted += 1; });
  await page.route(/\/rest\/v1\/decks(?:\?|$)/, async route => {
    started += 1; await pending;
    await route.fulfill({ status: 204 }).catch(() => { /* Old-account mutation. */ });
  });
  try {
    await page.getByTitle('Archive deck', { exact: true }).click(); await expect.poll(() => started).toBe(1);
    await transitionFixtureSession(page, true);
    await expect(page.getByText('No decks yet', { exact: true })).toBeVisible();
    await expect.poll(() => aborted).toBe(1); release();
    await expect(page.getByText('Deck archived', { exact: true })).toHaveCount(0);
  } finally { release(); }
});
