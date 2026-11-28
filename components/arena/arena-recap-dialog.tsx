'use client';

import {useId} from 'react';
import {Button} from '@/components/ui/button';
import {ModalCard, ModalOverlay} from '@/components/ui/modal-shell';
import type {useWebArenaRecap} from '@/hooks/use-web-arena-recap';

export function ArenaRecapDialog({recap}: {recap: ReturnType<typeof useWebArenaRecap>}) {
  const {controller, snapshot, payload, labels, canShare} = recap;
  const periodId = useId(), privacyId = useId();
  if (!snapshot.open) return null;
  const busy = snapshot.pending !== null, exporting = busy && snapshot.pending !== 'read';
  return <ModalOverlay onClose={controller.close} title={labels.title}>
    <ModalCard size="lg" className="gap-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">{labels.title}</h2>
        <Button type="button" variant="ghost" className="min-h-11" onClick={controller.close}>{labels.close}</Button>
      </div>
      <p className="text-sm text-muted-foreground">{labels.privacy}</p>
      <label htmlFor={periodId} className="text-sm font-semibold">{labels.period}</label>
      <select id={periodId} className="min-h-11 rounded-lg border border-border bg-background px-3" value={snapshot.days}
        disabled={exporting} onChange={event => void controller.setDays(event.target.value === '30' ? 30 : 7)}>
        <option value="7">{labels.days7}</option><option value="30">{labels.days30}</option>
      </select>
      <label htmlFor={privacyId} className="flex min-h-11 items-center gap-3 text-sm">
        <input id={privacyId} type="checkbox" className="h-5 w-5 accent-emerald-500" checked={snapshot.includeNames}
          disabled={busy || !payload} onChange={event => controller.setIncludeNames(event.target.checked)} />
        {labels.includeNames}
      </label>
      {snapshot.pending === 'read' && <p role="status">{labels.loading}</p>}
      {snapshot.error && <div className="space-y-2">
        <p role="alert" className="text-sm text-red-300">{labels.errors[snapshot.error]}</p>
        {!['share', 'copy', 'download'].includes(snapshot.error) && <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => void controller.retry()}>{labels.retry}</Button>}
      </div>}
      {payload && <pre aria-label={labels.title} className="max-h-[45dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-background p-3 font-sans text-sm">{payload.text}</pre>}
      {snapshot.feedback && <p role="status">{snapshot.feedback === 'copied' ? labels.copied : labels.downloaded}</p>}
      <div className="flex flex-wrap gap-2">
        {canShare && <Button type="button" className="min-h-11" disabled={busy || !payload} onClick={() => void controller.exportText('share')}>{labels.share}</Button>}
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || !payload} onClick={() => void controller.exportText('copy')}>{labels.copy}</Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={busy || !payload} onClick={() => void controller.exportText('download')}>{labels.download}</Button>
      </div>
    </ModalCard>
  </ModalOverlay>;
}
