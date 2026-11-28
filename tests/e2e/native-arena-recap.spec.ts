import {test, expect} from '@playwright/test';
import {buildRecapHarness, openRecapHarness, recapStats, recapId, expectPrivateFieldsAbsent} from './arena-recap-browser-fixture';

let bundle: string;
test.beforeAll(async () => {bundle = await buildRecapHarness('native');});
test('native recap hooks prepare an anonymous snapshot and export only after explicit confirmation', async ({page}) => {
  const probe = await openRecapHarness(page, bundle); expect(probe.reads()).toBe(0);
  await page.getByRole('button', {name: 'Open native recap', exact: true}).click();
  await expect(page.getByTestId('recap-text')).toContainText('Completed games: 2');
  await expect(page.getByTestId('recap-text')).not.toContainText('Alice private'); expect((await recapStats(page)).shares).toEqual([]);
  await page.evaluate(() => window.arenaRecapHarness.names(true));
  await expect(page.getByTestId('recap-text')).toContainText('Alice private');
  expectPrivateFieldsAbsent((await page.getByTestId('recap-text').textContent())!);
  await page.evaluate(() => window.arenaRecapHarness.names(false));
  expect(await page.evaluate(() => window.arenaRecapHarness.exportText('share'))).toBe(true);
  const stats = await recapStats(page); expect(stats.shares).toHaveLength(1); expect(stats.shares[0].message).not.toContain('Alice private');
  expectPrivateFieldsAbsent(stats.shares[0].message!); expect(stats.snapshot.feedback).toBeNull(); expect(probe.writes()).toBe(0);
});
test('native dismissal is neutral, and renewing the same account JWT preserves the preview', async ({page}) => {
  const probe = await openRecapHarness(page, bundle); await page.getByRole('button', {name: 'Open native recap', exact: true}).click();
  await expect(page.getByTestId('recap-text')).toContainText('Completed games: 2');
  await page.evaluate(() => window.arenaRecapHarness.names(true));
  await page.evaluate(() => window.arenaRecapHarness.render(undefined, undefined, 'en', 'renewed-token'));
  await expect(page.getByTestId('recap-text')).toContainText('Alice private'); expect(probe.reads()).toBe(1);
  await page.evaluate(() => window.arenaRecapIo.configure({share: 'cancel'}));
  expect(await page.evaluate(() => window.arenaRecapHarness.exportText('share'))).toBe(false);
  expect((await recapStats(page)).snapshot).toMatchObject({open: true, includeNames: true, error: null, feedback: null});
  await page.evaluate(() => window.arenaRecapHarness.close());
  await page.evaluate(() => window.arenaRecapHarness.open());
  expect((await recapStats(page)).snapshot.includeNames).toBe(false);
});
test('native period changes abort obsolete reads and expose correct calendar filters', async ({page}) => {
  const probe = await openRecapHarness(page, bundle, {hold: true});
  try {
    await page.getByRole('button', {name: 'Open native recap', exact: true}).click(); await expect.poll(probe.reads).toBe(1);
    expect(await page.evaluate(() => window.arenaRecapHarness.days(30))).toBe(true);
    await expect.poll(probe.aborted).toBe(1); probe.release();
    expect((await recapStats(page)).snapshot.days).toBe(30);
    expect(Date.parse(probe.requests[1].p_since)).toBeLessThan(Date.parse(probe.requests[0].p_since));
    expect(probe.requests.every(request => request.p_day_key === null && request.p_boundary_hour === 0)).toBe(true);
  } finally {probe.release();}
});
for (const transition of ['close', 'account', 'group', 'unmount'] as const) test(`native recap hooks reject late data on ${transition}`, async ({page}) => {
  const probe = await openRecapHarness(page, bundle, {hold: true});
  try {
    await page.getByRole('button', {name: 'Open native recap', exact: true}).click(); await expect.poll(probe.reads).toBe(1);
    await page.evaluate(({transition, actor, group}) => {
      if (transition === 'close') window.arenaRecapHarness.close();
      else if (transition === 'unmount') window.arenaRecapHarness.unmount();
      else window.arenaRecapHarness.render(actor, group);
    }, {transition, actor: transition === 'account' ? recapId(9) : recapId(1), group: transition === 'group' ? recapId(8) : recapId(2)});
    await expect.poll(probe.aborted).toBe(1); probe.release();
    expect((await recapStats(page)).snapshot).toMatchObject({open: false, summary: null, includeNames: false});
  } finally {probe.release();}
});
