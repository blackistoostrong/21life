import { expect, test } from '@playwright/test';
import { fixtureLogin } from './fixture-login';
import AxeBuilder from '@axe-core/playwright';

declare global {
  interface Window {
    trackerDisplayMonitor?: { created: number; active: number };
    trackerFullscreenMonitor?: { requests: number; locks: number; exits: number };
    settleTrackerFullscreen?: (outcome: 'resolve' | 'reject') => void;
  }
}

test('wizard → damage → Last Standing → recap', async ({ page, browser }) => {
  test.setTimeout(90_000);
  test.skip(process.env.E2E_LIVE_GAME_FLOW !== '1', 'Set E2E_LIVE_GAME_FLOW=1 for the state-changing live flow.');
  const identifier = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD;
  test.skip(!identifier || !password, 'E2E credentials are required.');

  const checkDisplay = process.env.E2E_DISPLAY_LIFECYCLE === '1';
  if (checkDisplay) await page.addInitScript(() => {
    const monitor = { created: 0, active: 0 };
    window.trackerDisplayMonitor = monitor;
    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      private tracked = false;
      observe(target: Element, options?: ResizeObserverOptions) {
        // Identify the real table surface without changing production markup.
        if (!this.tracked && target.querySelector('button[aria-label^="Reduce life for"], button[aria-label^="Riduci punti vita di"]')) {
          this.tracked = true;
          monitor.created++;
          monitor.active++;
        }
        super.observe(target, options);
      }
      disconnect() {
        if (this.tracked) { monitor.active--; this.tracked = false; }
        super.disconnect();
      }
    };
  });

  await fixtureLogin(page);
  await page.getByRole('button', { name: /Open|Apri/ }).first().click();
  await page.getByRole('button', { name: /Play Game|Gioca live/ }).click();
  const playerCount = Number(process.env.E2E_PLAYER_COUNT || 2);
  await page.getByRole('button', { name: String(playerCount), exact: true }).click();
  await page.getByRole('button', { name: /Step 4|Passaggio 4/ }).click();
  const wizardA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(wizardA11y.violations.filter((entry) => ['serious', 'critical'].includes(entry.impact ?? ''))).toEqual([]);

  for (let seatIndex = 0; seatIndex < playerCount; seatIndex += 1) {
    await page.getByRole('button', { name: new RegExp(`^(Seat|Posto) ${seatIndex + 1}`) }).click();
    const select = page.getByTestId('live-player-select');
    const option = select.locator('option:not([disabled])').filter({ hasNotText: /Choose player|Scegli giocatore/ }).first();
    await select.selectOption((await option.getAttribute('value'))!);
    await page.getByTestId('live-deck-option').first().click();
  }

  await page.evaluate(() => localStorage.setItem('live-onboarding-v1', 'done'));
  await page.getByTestId('live-start').click();
  await expect(page.getByTestId('live-end')).toBeVisible({ timeout: 20_000 });
  const arenaA11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(arenaA11y.violations.filter((entry) => ['serious', 'critical'].includes(entry.impact ?? ''))).toEqual([]);
  const journal = () => page.evaluate(({ groupId, userId }) => {
    const key = `phyrexian-arena:web-live-game:v2:${userId}:${groupId}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).journal : null;
  }, { groupId: process.env.E2E_GROUP_ID, userId: process.env.E2E_USER_ID });
  if (process.env.E2E_GROUP_ID) {
    await expect.poll(async () => (await journal())?.mutations.length).toBe(0);
    if (checkDisplay) await expect.poll(() => page.evaluate(() => window.trackerDisplayMonitor?.active)).toBe(1);
    const displayBefore = checkDisplay ? await page.evaluate(() => window.trackerDisplayMonitor!.created) : null;
    const before = (await journal()).record.state.players[0].life;
    await page.route('**/rest/v1/rpc/apply_live_game_mutation*', (route) => route.abort());
    await page.getByRole('button', { name: /Reduce life for|Riduci punti vita di/ }).first().click();
    await expect.poll(async () => (await journal())?.mutations.length).toBe(1);
    await expect.poll(async () => (await journal())?.record.state.players[0].life).toBe(before - 1);
    if (checkDisplay) {
      // Let the actual React commit and passive effects settle after the mutation.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(() => window.trackerDisplayMonitor)).toEqual({ created: displayBefore, active: 1 });
    }
    await page.reload();
    await expect(page.getByTestId('live-end')).toBeVisible();
    if (checkDisplay) await expect.poll(() => page.evaluate(() => window.trackerDisplayMonitor?.active)).toBe(1);
    await expect.poll(async () => (await journal())?.mutations.length).toBe(1);
    await page.unroute('**/rest/v1/rpc/apply_live_game_mutation*');
    await page.getByRole('button', { name: /Retry sync|Riprova sync/ }).click();
    await expect.poll(async () => (await journal())?.mutations.length, { timeout: 20_000 }).toBe(0);
    expect((await journal()).serverRecord.state.players[0].life).toBe(before - 1);
    await page.route('**/rest/v1/rpc/apply_live_game_mutation*', (route) => route.fulfill({
      status: 401, contentType: 'application/json',
      body: JSON.stringify({ code: 'PGRST301', message: 'JWT expired', details: null, hint: null }),
    }));
    await page.getByRole('button', { name: /Reduce life for|Riduci punti vita di/ }).first().click();
    await expect(page.getByRole('button', { name: /Sign-in required|Accesso richiesto/ })).toBeVisible();
    expect((await journal()).mutations.length).toBe(1);
    expect((await journal()).record.state.players[0].life).toBe(before - 2);
    await page.unroute('**/rest/v1/rpc/apply_live_game_mutation*');
    await page.getByRole('button', { name: /Sign-in required|Accesso richiesto/ }).click();
    await expect.poll(async () => (await journal())?.mutations.length).toBe(0);
    const secondContext = await browser.newContext({ storageState: await page.context().storageState() });
    try {
      const secondPage = await secondContext.newPage();
      const diagnostics: unknown[] = [];
      for (const [index, clientPage] of [[0, page], [1, secondPage]] as const) {
        clientPage.on('response', async (response) => {
          if (!response.url().includes('/rpc/apply_live_game_mutation')) return;
          const result = await response.json().catch(() => null);
          diagnostics.push({ client: index, status: response.status(), applied: result?.applied, version: result?.record?.state?.version, life: result?.record?.state?.players?.[0]?.life });
        });
        clientPage.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
          try {
            const message = JSON.parse(String(payload));
            diagnostics.push({ client: index, realtimeEvent: message.event, status: message.payload?.status, version: message.payload?.data?.record?.state?.version });
          } catch { /* Binary frames have no diagnostic state. */ }
        }));
      }
      await secondPage.goto(new URL(`/table/${process.env.E2E_GROUP_ID}/play`, page.url()).href);
      await expect(secondPage.getByTestId('live-end')).toBeVisible();
      await Promise.all([page, secondPage].map((clientPage) =>
        clientPage.getByRole('button', { name: /Reduce life for|Riduci punti vita di/ }).first().click()
      ));
      try { for (const clientPage of [page, secondPage]) {
        await expect.poll(() => clientPage.evaluate(({ groupId, userId }) => {
          const value = JSON.parse(localStorage.getItem(`phyrexian-arena:web-live-game:v2:${userId}:${groupId}`)!).journal;
          return { life: value.serverRecord.state.players[0].life, pending: value.mutations.length };
        }, { groupId: process.env.E2E_GROUP_ID, userId: process.env.E2E_USER_ID }), { timeout: 20_000 }).toEqual({ life: before - 4, pending: 0 });
      }
      } finally {
        console.log('Synthetic sync boundaries:', JSON.stringify(diagnostics));
        await test.info().attach('sync-boundaries', { body: JSON.stringify(diagnostics), contentType: 'application/json' });
      }
    } finally {
      await secondContext.close();
    }
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('phyrexian-arena:web-live-game:v2:') && sessionStorage.getItem('qa-journal-quota') === '1') {
          throw new DOMException('Synthetic full storage', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
      sessionStorage.setItem('qa-journal-quota','1');
    });
    await page.route('**/rest/v1/rpc/apply_live_game_mutation*', route => route.abort());
    await page.getByRole('button', { name: /Reduce life for|Riduci punti vita di/ }).first().click();
    await expect(page.getByTestId('live-journal-warning')).toContainText('Local saving unavailable');
    // The durable snapshot remains unchanged; the unsaved action is still in memory.
    expect((await journal()).record.state.players[0].life).toBe(before - 4);
    await page.evaluate(() => sessionStorage.setItem('qa-journal-quota','0'));
    await page.unroute('**/rest/v1/rpc/apply_live_game_mutation*');
    await page.getByRole('button', { name: /Local saving unavailable/ }).click();
    await expect(page.getByTestId('live-journal-warning')).toHaveCount(0);
    await expect.poll(async () => (await journal())?.serverRecord.state.players[0].life).toBe(before - 5);
  }
  await page.getByRole('button', { name: /Reduce life for|Riduci punti vita di/ }).first().click();
  await page.getByTestId('live-end').focus();
  await page.keyboard.press('Enter');
  const endDialog = page.getByRole('dialog');
  await expect(endDialog).toBeVisible();
  await endDialog.getByRole('button', { name: /^Close$|^Chiudi$/ }).click();
  await expect(page.getByTestId('live-end')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByTestId('live-winner').first().click();
  await page.getByTestId('live-win-last_standing').click();
  let lostFinalizationResponse = false;
  if (process.env.E2E_GROUP_ID) {
    await page.route('**/rest/v1/rpc/finalize_live_game*', async (route) => {
      if (lostFinalizationResponse) return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      lostFinalizationResponse = true;
      await route.abort();
    });
  }
  await page.getByTestId('live-save').click();
  if (process.env.E2E_GROUP_ID) {
    await expect.poll(() => lostFinalizationResponse).toBe(true);
    await expect.poll(async () => (await journal())?.pendingFinalization != null).toBe(true);
    await page.unroute('**/rest/v1/rpc/finalize_live_game*');
    await page.reload();
  }
  await expect(page.getByText(/Game saved|Partita salvata/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Share|Condividi/ })).toBeVisible();
  if (checkDisplay) await expect.poll(() => page.evaluate(() => window.trackerDisplayMonitor?.active)).toBe(0);
});

for (const { outcome, resume } of [
  { outcome: 'resolve', resume: false }, { outcome: 'reject', resume: false },
  { outcome: 'resolve', resume: true },
] as const) {
  test(`tracker display fullscreen ${outcome} after pause respects ${resume ? 'new owner' : 'unmount'}`, async ({ page }) => {
    test.skip(!process.env.E2E_ACCESS_TOKEN, 'Requires disposable Dev authentication.');
    const groupId = process.env.E2E_GROUP_ID!;
    let gameId: string | null = null;
    await page.addInitScript(() => {
      const monitor = { requests: 0, locks: 0, exits: 0 };
      window.trackerFullscreenMonitor = monitor;
      let fullscreen: Element | null = null;
      Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
      Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: () => {
        monitor.requests++;
        return new Promise<void>((resolve, reject) => {
          window.settleTrackerFullscreen = (result) => {
            if (result === 'reject') reject(new Error('Synthetic fullscreen rejection'));
            else { fullscreen = document.documentElement; resolve(); }
          };
        });
      } });
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: async () => {
        monitor.exits++; fullscreen = null;
      } });
      Object.defineProperty(screen.orientation, 'lock', { configurable: true, value: async () => { monitor.locks++; } });
      Object.defineProperty(screen.orientation, 'unlock', { configurable: true, value: () => {} });
    });
    try {
      await fixtureLogin(page);
      await page.goto(`/table/${groupId}/play`);
      await page.getByRole('button', { name: '2', exact: true }).click();
      await page.getByRole('button', { name: /Step 4|Passaggio 4/ }).click();
      for (let seat = 1; seat <= 2; seat++) {
        await page.getByRole('button', { name: new RegExp(`^(Seat|Posto) ${seat}`) }).click();
        const select = page.getByTestId('live-player-select');
        const option = select.locator('option:not([disabled])').filter({ hasNotText: /Choose player|Scegli giocatore/ }).first();
        await select.selectOption((await option.getAttribute('value'))!);
        await page.getByTestId('live-deck-option').first().click();
      }
      await page.evaluate(() => localStorage.setItem('live-onboarding-v1', 'done'));
      await page.getByTestId('live-start').click();
      await expect(page.getByTestId('live-end')).toBeVisible();
      const journal = () => page.evaluate(({ group, user }) => {
        const raw = localStorage.getItem(`phyrexian-arena:web-live-game:v2:${user}:${group}`);
        return raw ? JSON.parse(raw).journal : null;
      }, { group: groupId, user: process.env.E2E_USER_ID });
      await expect.poll(async () => (await journal())?.needsCreate).toBe(false);
      gameId = (await journal()).record.id;
      await expect.poll(() => page.evaluate(() => window.trackerFullscreenMonitor?.requests)).toBe(1);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: /^Pause game|^Pausa partita/ }).click();
      await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
      if (resume) {
        await page.getByRole('button', { name: /Live game in progress|Partita live in corso/ }).click();
        await expect(page.getByTestId('live-end')).toBeVisible();
      }
      const before = await page.evaluate(() => window.trackerFullscreenMonitor!.locks);
      await page.evaluate((result) => window.settleTrackerFullscreen!(result), outcome);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await page.evaluate(() => window.trackerFullscreenMonitor!.locks)).toBe(before);
      expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(!resume);
      await expect(page.getByText('The browser did not allow fullscreen. Try again from the tracker button.', { exact: true })).toHaveCount(0);
      if (resume) {
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await page.getByRole('button', { name: /^Pause game|^Pausa partita/ }).click();
        await expect(page).toHaveURL(new RegExp(`/table/${groupId}$`));
        expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
      }
    } finally {
      if (gameId) {
        // Only the disposable fixture game; use its actual authenticated policy.
        const response = await page.request.patch(`${process.env.SUPABASE_URL}/rest/v1/live_games?id=eq.${gameId}&group_id=eq.${groupId}`, {
          headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, Authorization: `Bearer ${process.env.E2E_ACCESS_TOKEN}` },
          data: { status: 'cancelled', ended_at: new Date().toISOString() },
        });
        expect(response.ok()).toBe(true);
      }
    }
  });
}
