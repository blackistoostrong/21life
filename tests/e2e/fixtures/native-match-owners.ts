import { createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useArenaMatchWrite } from '../../../expo/hooks/use-arena-match-write';
import { useArenaMatchFormCommand } from '../../../expo/hooks/use-arena-match-form-command';
import type { ArenaMatchWriteInput } from '../../../packages/domain/arena-match-write';

type Call = { args: Record<string, unknown>; signal: AbortSignal; reply: (data: unknown, error: unknown) => void };
const calls: Call[] = [];
const completed: Promise<unknown>[] = [];
let successes = 0, failures = 0;
let current!: { write: ReturnType<typeof useArenaMatchWrite>; form: ReturnType<typeof useArenaMatchFormCommand> };
const port = { rpc: (_name: string, args: Record<string, unknown>) => ({ abortSignal: (signal: AbortSignal) =>
  new Promise(resolve => calls.push({ args, signal, reply: (data, error) => resolve({ data, error }) })) }) };
// The test bundler replaces only the installed SDK boundary and native RNG.
Object.assign(window, { nativeMatchTestPort: port });
const input: ArenaMatchWriteInput = { mode: 'create', isDraw: true, winnerKey: null,
  notes: '', playedAt: '2026-11-20T12:00:00Z', winCondition: null,
  players: [{ key: 'user:alice' }, { key: 'guest:bob' }] };
function App({ actor, opening }: { actor: string; opening: boolean }) {
  const write = useArenaMatchWrite('group', actor);
  const form = useArenaMatchFormCommand(actor + ':group', opening);
  useLayoutEffect(() => { current = { write, form }; }, [write, form]);
  return createElement('output', { 'data-testid': 'busy' }, String(form.saving));
}
const root = createRoot(document.getElementById('root')!);
Object.assign(window, { nativeMatchTest: {
  render(actor = 'actor-a', opening = true) { flushSync(() => root.render(createElement(App, { actor, opening }))); },
  start() { const { write, form } = current; completed.push(form.run(signal => write(input, undefined, signal, form.opening), () => { successes++; }, () => { failures++; })); },
  reply(index: number, outcome: 'ok' | 'error' | 'bad-ack') {
    const call = calls[index]; call.reply(outcome === 'ok' ? call.args.p_match_id : outcome === 'bad-ack' ? 'wrong-id' : null,
      outcome === 'error' ? { code: '503' } : null);
  },
  snapshot() { return { successes, failures, calls: calls.map(call => ({ args: call.args, aborted: call.signal.aborted })) }; },
  async settle() { await Promise.all(completed); },
  unmount() { flushSync(() => root.unmount()); },
} });
