import { expect, test } from '@playwright/test';
import { openProfileLinkFixture } from './profile-link-fixture';
import { mockEmptySecondAccountCatalog, transitionFixtureSession } from './profile-auth-fixture';

test('profile external link preserves identity, discarded input and failed drafts through retry', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const { commander, targetUrl, open, dialog, input, counts } = await openProfileLinkFixture(page);
  await open.click();
  await expect(input).toHaveValue('https://archidekt.com/decks/345678');
  await input.fill(targetUrl);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(counts().previews).toBe(0); expect(counts().writes).toBe(0);
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
  expect(counts().writes).toBe(2); expect(counts().previews).toBe(2);
});

for (const stage of ['import', 'CMC', 'write'] as const) {
  test(`profile external link lifecycle cancels ${stage} on browser Back across two mounts`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    const fixture = await openProfileLinkFixture(page);
    let started = 0; let aborted = 0; const releases: Array<() => void> = [];
    const matches = (url: string) => stage === 'import' ? url.includes('/api/deck-import')
      : stage === 'CMC' ? url.startsWith('https://api.scryfall.com/cards/named?') : /\/rest\/v1\/decks(?:\?|$)/.test(url);
    page.on('requestfailed', request => { if (matches(request.url())) aborted += 1; });
    await page.route(stage === 'import' ? '**/api/deck-import' : stage === 'CMC'
      ? 'https://api.scryfall.com/cards/named?*' : /\/rest\/v1\/decks(?:\?|$)/, async route => {
      started += 1; await new Promise<void>(resolve => releases.push(resolve));
      await (stage === 'write' ? route.fulfill({ status: 204 }) : route.fulfill({ status: 503, json: {} }))
        .catch(() => { /* Disposed route. */ });
    });
    try {
      for (let opening = 0; opening < 2; opening += 1) {
        if (opening) {
          await page.getByRole('banner').getByRole('button', { name: 'Profile', exact: true }).click();
          await expect(fixture.open).toBeVisible();
        }
        await fixture.open.click(); await fixture.input.fill(fixture.targetUrl);
        await fixture.dialog.getByRole('button', { name: 'Link list', exact: true }).click();
        await expect.poll(() => started).toBe(opening + 1);
        await page.goBack();
        await expect.poll(() => aborted).toBe(opening + 1);
        expect(fixture.counts().writes).toBe(0);
        releases.splice(0).forEach(release => release());
      }
    } finally { releases.forEach(release => release()); }
  });
}

test('profile external link closes pending preparation, freezes input and dispatches once', async ({ page }) => {
  test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
  const fixture = await openProfileLinkFixture(page);
  let started = 0; let aborted = 0; const releases: Array<() => void> = [];
  page.on('requestfailed', request => { if (request.url().includes('/api/deck-import')) aborted += 1; });
  await page.route('**/api/deck-import', async route => {
    started += 1; await new Promise<void>(resolve => releases.push(resolve));
    await route.fulfill({ status: 503, json: {} }).catch(() => { /* Closed preparation. */ });
  });
  try {
    await fixture.open.click(); await fixture.input.fill(fixture.targetUrl);
    await fixture.dialog.getByRole('button', { name: 'Link list', exact: true }).evaluate(element => {
      (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click();
    });
    await expect.poll(() => started).toBe(1);
    await expect(fixture.input).toBeDisabled();
    await fixture.dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.poll(() => aborted).toBe(1);
    await expect(fixture.dialog).toHaveCount(0);
    expect(fixture.counts().writes).toBe(0);
    await fixture.open.click();
    await expect(fixture.input).toHaveValue('https://archidekt.com/decks/345678');
  } finally { releases.forEach(release => release()); }
});

for (const stage of ['import', 'write'] as const) {
  test(`profile external link account switch clears the old target and cancels ${stage}`, async ({ page }) => {
    test.skip(process.env.E2E_ANALYTICS_FLOW !== '1', 'Requires disposable authentication.');
    const fixture = await openProfileLinkFixture(page);
    await mockEmptySecondAccountCatalog(page);
    let started = 0; let aborted = 0; let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const matches = (url: string) => stage === 'import' ? url.includes('/api/deck-import') : /\/rest\/v1\/decks(?:\?|$)/.test(url);
    page.on('requestfailed', request => { if (matches(request.url())) aborted += 1; });
    await page.route(stage === 'import' ? '**/api/deck-import' : /\/rest\/v1\/decks(?:\?|$)/, async route => {
      started += 1; await pending;
      await (stage === 'write' ? route.fulfill({ status: 204 }) : route.fulfill({ status: 503, json: {} }))
        .catch(() => { /* Old-account response. */ });
    });
    try {
      await fixture.open.click(); await fixture.input.fill(fixture.targetUrl);
      await fixture.dialog.getByRole('button', { name: 'Link list', exact: true }).click();
      await expect.poll(() => started).toBe(1);
      await transitionFixtureSession(page, true);
      await expect(page.getByText('No decks yet', { exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { includeHidden: true })).toHaveCount(0);
      await expect.poll(() => aborted).toBe(1);
      release();
      await expect(page.getByText('List linked', { exact: true })).toHaveCount(0);
    } finally { release(); }
  });
}
