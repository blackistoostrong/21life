import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchScryfall } from '@/packages/data/scryfall-transport';
import { lookupCommanderCmcInBrowser, primeCommanderCmcCache } from '@/lib/commander-cmc-client';

vi.mock('@/packages/data/scryfall-transport', () => ({ fetchScryfall: vi.fn() }));

describe('browser commander CMC cache', () => {
  beforeEach(() => vi.mocked(fetchScryfall).mockReset());

  it('does not cache a temporary provider failure as a missing commander', async () => {
    vi.mocked(fetchScryfall).mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(lookupCommanderCmcInBrowser('Temporary CMC failure')).rejects.toThrow('503');
    vi.mocked(fetchScryfall).mockResolvedValueOnce(new Response(JSON.stringify({ name: 'Temporary CMC failure', cmc: 4 })));
    await expect(lookupCommanderCmcInBrowser('Temporary CMC failure')).resolves.toBe(4);
    await expect(lookupCommanderCmcInBrowser('Temporary CMC failure')).resolves.toBe(4);
    expect(fetchScryfall).toHaveBeenCalledTimes(2);
  });

  it('preserves primed zero values and expires negative results', async () => {
    primeCommanderCmcCache({ 'Primed zero': 0 });
    await expect(lookupCommanderCmcInBrowser('  Primed zero ')).resolves.toBe(0);
    vi.useFakeTimers();
    try {
      primeCommanderCmcCache({ 'Negative CMC fixture': null });
      await expect(lookupCommanderCmcInBrowser('Negative CMC fixture')).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(10_001);
      vi.mocked(fetchScryfall).mockResolvedValueOnce(new Response(JSON.stringify({ name: 'Negative CMC fixture', cmc: 2 })));
      await expect(lookupCommanderCmcInBrowser('Negative CMC fixture')).resolves.toBe(2);
    } finally { vi.useRealTimers(); }
  });
});
