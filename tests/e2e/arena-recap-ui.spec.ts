import {test, expect} from '@playwright/test';
import {buildRecapHarness, openRecapHarness, recapStats, recapId, expectPrivateFieldsAbsent} from './arena-recap-browser-fixture';

let bundle: string;
test.beforeAll(async () => {bundle = await buildRecapHarness('web');});
test('recap UI previews anonymously, explicitly includes names and copies the current choice only after acknowledgement', async ({page}) => {
  const probe = await openRecapHarness(page, bundle); expect(probe.reads()).toBe(0);
  await page.getByRole('button', {name: 'Share recap', exact: true}).click();
  const preview = page.getByRole('dialog', {name: 'Playgroup recap'}).locator('pre');
  await expect(preview).toContainText('Completed games: 2'); await expect(preview).toContainText('1 win · 1 draw');
  await expect(preview).toContainText('Player 1'); await expect(preview).not.toContainText('Alice private');
  expectPrivateFieldsAbsent((await preview.textContent())!);
  expect((await recapStats(page)).shares).toEqual([]); expect((await recapStats(page)).copies).toEqual([]);
  const names = page.getByLabel('Include player names', {exact: true});
  await names.check(); await expect(preview).toContainText('Alice private');
  expectPrivateFieldsAbsent((await preview.textContent())!);
  await names.uncheck(); await expect(preview).not.toContainText('Alice private'); expect(probe.reads()).toBe(1);
  await page.evaluate(() => window.arenaRecapIo.configure({copy: 'hold'}));
  await page.getByRole('button', {name: 'Copy text', exact: true}).click();
  expect((await recapStats(page)).copies).toHaveLength(1);
  await expect(page.getByText('Text copied.', {exact: true})).toHaveCount(0);
  await page.evaluate(() => window.arenaRecapIo.release());
  await expect(page.getByText('Text copied.', {exact: true})).toBeVisible();
  const copied = (await recapStats(page)).copies[0]; expect(copied).not.toContain('Alice private'); expectPrivateFieldsAbsent(copied);
  expect(probe.writes()).toBe(0);
});
test('recap UI changes calendar period and restores anonymous defaults after Escape/reopen', async ({page}) => {
  const probe = await openRecapHarness(page, bundle);
  const trigger = page.getByRole('button', {name: 'Share recap', exact: true}); await trigger.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Completed games: 2');
  await page.getByLabel('Include player names', {exact: true}).check();
  await page.getByLabel('Period', {exact: true}).selectOption('30');
  await expect.poll(probe.reads).toBe(2);
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Completed games: 2');
  expect(Date.parse(probe.requests[1].p_since)).toBeLessThan(Date.parse(probe.requests[0].p_since));
  expect(probe.requests.every(request => request.p_day_key === null && request.p_boundary_hour === 0)).toBe(true);
  await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await trigger.click();
  await expect(page.getByLabel('Period', {exact: true})).toHaveValue('7');
  await expect(page.getByLabel('Include player names', {exact: true})).not.toBeChecked();
  await expect(page.getByRole('dialog').locator('pre')).not.toContainText('Alice private');
});
test('Web Share keeps activation, handles cancellation neutrally and does not automatically copy', async ({page}) => {
  await openRecapHarness(page, bundle); await page.getByRole('button', {name: 'Share recap', exact: true}).click();
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Completed games: 2');
  await page.evaluate(() => window.arenaRecapIo.configure({share: 'cancel'}));
  await page.getByRole('button', {name: 'Open share sheet', exact: true}).click();
  await expect.poll(async () => (await recapStats(page)).snapshot.pending).toBeNull();
  const stats = await recapStats(page); expect(stats.shares).toHaveLength(1); expect(stats.active).toEqual([true]);
  expect(stats.copies).toEqual([]); expect(stats.snapshot).toMatchObject({error: null, feedback: null});
  expectPrivateFieldsAbsent(stats.shares[0].text!);
});
test('clipboard denial stays visible and retry does not pretend that text was copied', async ({page}) => {
  await openRecapHarness(page, bundle); await page.getByRole('button', {name: 'Share recap', exact: true}).click();
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Completed games: 2');
  await page.evaluate(() => window.arenaRecapIo.configure({copy: 'error'}));
  await page.getByRole('button', {name: 'Copy text', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('Cannot copy.');
  await expect(page.getByText('Text copied.', {exact: true})).toHaveCount(0);
  await page.evaluate(() => window.arenaRecapIo.configure({copy: 'ok'}));
  await page.getByRole('button', {name: 'Copy text', exact: true}).click();
  await expect(page.getByText('Text copied.', {exact: true})).toBeVisible();
});
test('web fallback downloads the exact anonymous UTF-8 text without opening external services', async ({page}) => {
  const probe = await openRecapHarness(page, bundle);
  await page.evaluate(() => window.arenaRecapIo.configure({unavailableShare: true}));
  await page.getByRole('button', {name: 'Share recap', exact: true}).click();
  const preview = page.getByRole('dialog').locator('pre'); await expect(preview).toContainText('Completed games: 2');
  await expect(page.getByRole('button', {name: 'Open share sheet', exact: true})).toHaveCount(0);
  const waiting = page.waitForEvent('download'); await page.getByRole('button', {name: 'Download .txt', exact: true}).click();
  const download = await waiting; expect(download.suggestedFilename()).toMatch(/^21life-recap-\d{4}-\d\d-\d\d-\d{4}-\d\d-\d\d\.txt$/);
  const stream = await download.createReadStream(); if (!stream) throw Error('Missing text download');
  const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8'); expect(text).toBe(await preview.textContent());
  expectPrivateFieldsAbsent(text); expect(text).not.toContain('Alice private'); expect(probe.writes()).toBe(0);
});
for (const failure of ['forbidden', 'schema', 'large'] as const) test(`recap UI refuses ${failure} data and retries without a partial preview`, async ({page}) => {
  const probe = await openRecapHarness(page, bundle, {failure});
  await page.getByRole('button', {name: 'Share recap', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText(failure === 'forbidden' ? 'Playgroup access' : failure === 'large' ? 'Too much data' : 'Cannot prepare');
  await expect(page.getByRole('dialog').locator('pre')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Copy text', exact: true})).toBeDisabled();
  expectPrivateFieldsAbsent((await page.locator('body').textContent())!);
  probe.recover(); await page.getByRole('button', {name: 'Retry', exact: true}).click();
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Completed games: 2');
});
for (const transition of ['close', 'account', 'group', 'unmount'] as const) test(`recap UI cancels held reads on ${transition}`, async ({page}) => {
  const probe = await openRecapHarness(page, bundle, {hold: true});
  try {
    await page.getByRole('button', {name: 'Share recap', exact: true}).click(); await expect.poll(probe.reads).toBe(1);
    if (transition === 'close') await page.getByRole('button', {name: 'Close', exact: true}).click();
    else await page.evaluate(({transition, actor, group}) => {
      if (transition === 'unmount') window.arenaRecapHarness.unmount(); else window.arenaRecapHarness.render(actor, group);
    }, {transition, actor: transition === 'account' ? recapId(9) : recapId(1), group: transition === 'group' ? recapId(8) : recapId(2)});
    await expect.poll(probe.aborted).toBe(1); probe.release();
    await expect(page.getByRole('dialog')).toHaveCount(0); expect((await recapStats(page)).snapshot.summary).toBeNull();
    expect((await recapStats(page)).shares).toEqual([]);
  } finally {probe.release();}
});
test('thirty-day selection supersedes a held seven-day read without accepting its late response', async ({page}) => {
  const probe = await openRecapHarness(page, bundle, {hold: true});
  try {
    await page.getByRole('button', {name: 'Share recap', exact: true}).click(); await expect.poll(probe.reads).toBe(1);
    await page.getByLabel('Period', {exact: true}).selectOption('30'); await expect.poll(probe.aborted).toBe(1);
    await expect(page.getByRole('dialog').locator('pre')).toContainText('Completed games: 2');
    probe.release(); expect((await recapStats(page)).snapshot.days).toBe(30);
  } finally {probe.release();}
});
test('Italian preview and a late copy acknowledgement remain scoped to their opening', async ({page}) => {
  await openRecapHarness(page, bundle); await page.evaluate(() => window.arenaRecapHarness.render(undefined, undefined, 'it'));
  await page.getByRole('button', {name: 'Condividi riepilogo', exact: true}).click();
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Partite concluse: 2');
  await expect(page.getByRole('dialog').locator('pre')).toContainText('Giocatore 1');
  await page.evaluate(() => window.arenaRecapIo.configure({copy: 'hold'}));
  await page.getByRole('button', {name: 'Copia testo', exact: true}).click();
  await page.evaluate(actor => window.arenaRecapHarness.render(actor, undefined, 'it'), recapId(9));
  await page.evaluate(() => window.arenaRecapIo.release());
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByText('Testo copiato.', {exact: true})).toHaveCount(0);
  expect((await recapStats(page)).snapshot).toMatchObject({includeNames: false, summary: null, feedback: null});
});
