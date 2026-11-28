import React, {StrictMode, useLayoutEffect} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {useWebArenaRecap} from '../../hooks/use-web-arena-recap';
import {ArenaRecapDialog} from '../../components/arena/arena-recap-dialog';
import {installArenaRecapIo, type RecapHarness} from './arena-recap-io';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let root: Root | null = null, current: ReturnType<typeof useWebArenaRecap>;
window.arenaRecapIo = installArenaRecapIo();
function Owner({actor, group, language}: {actor: string; group: string; language: string}) {
  const recap = useWebArenaRecap(actor, group, 'Private Pod');
  useLayoutEffect(() => {current = recap;}, [recap]);
  return <div lang={language}>
    <button type="button" onClick={() => void recap.controller.open()}>{recap.labels.open}</button>
    <ArenaRecapDialog recap={recap} />
    <output data-testid="recap-state">{JSON.stringify(recap.snapshot)}</output>
  </div>;
}
window.arenaRecapHarness = {
  render: (actor = id(1), group = id(2), language = 'en') => {
    window.recapActor = actor; window.recapLanguage = language;
    root ??= createRoot(document.getElementById('root')!);
    flushSync(() => root!.render(<StrictMode><Owner actor={actor} group={group} language={language} /></StrictMode>));
  },
  open: () => current.controller.open(), close: () => flushSync(() => current.controller.close()),
  days: days => current.controller.setDays(days), names: value => flushSync(() => current.controller.setIncludeNames(value)),
  exportText: kind => current.controller.exportText(kind),
  unmount: () => flushSync(() => {root?.unmount(); root = null;}),
  stats: () => ({snapshot: current.controller.view.getSnapshot(), shares: window.arenaRecapIo.shares,
    copies: window.arenaRecapIo.copies, active: window.arenaRecapIo.active}),
} satisfies RecapHarness;
