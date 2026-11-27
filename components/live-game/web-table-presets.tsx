'use client';

import {useId, useState} from 'react';
import {useLanguage} from '@/components/language-provider';
import {Button} from '@/components/ui/button';
import {ModalCard, ModalOverlay} from '@/components/ui/modal-shell';
import {useWebTablePresets} from '@/hooks/use-web-table-presets';
import type {WebTrackerSetupController} from '@/hooks/use-web-tracker-setup';
import {tablePresetLabels} from '@/lib/table-preset-labels';
import {TABLE_PRESET_LIMIT, TABLE_PRESET_NAME_LIMIT} from '../../packages/domain/table-presets';

type Props = {groupId: string; userId: string; setup: WebTrackerSetupController; online: boolean; disabled: boolean};

/** The keyed opening discards private form state immediately on account/group change. */
export function WebTablePresets(props: Props) {
  return <ScopedWebTablePresets key={`${props.userId}:${props.groupId}`} {...props} />;
}

function ScopedWebTablePresets({groupId, userId, setup, online, disabled}: Props) {
  const {language} = useLanguage();
  const labels = tablePresetLabels(language);
  const {controller, snapshot} = useWebTablePresets(groupId, userId, setup, online);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const busy = snapshot.pending !== null;
  const close = () => {controller.cancel(); setOpen(false); setEditingId(null); setDeletingId(null); setName('');};
  const save = async () => {
    if (await (editingId ? controller.rename(editingId, name) : controller.save(name))) {
      setName(''); setEditingId(null);
    }
  };
  const preview = snapshot.preview;
  const deleting = snapshot.presets.find(preset => preset.id === deletingId);
  return <>
    <Button type="button" variant="outline" className="min-h-11" disabled={disabled || !userId}
      onClick={() => {setOpen(true); void controller.refresh();}}>{labels.title}</Button>
    {setup.presetMissingReferences > 0 && <p role="status" className="text-sm text-amber-300">{labels.missing(setup.presetMissingReferences)}</p>}
    {open && <ModalOverlay onClose={close} title={labels.title}>
      <ModalCard size="lg" className="gap-4 overflow-y-auto p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold">{labels.title}</h2>
          <Button type="button" variant="ghost" className="min-h-11" onClick={close}>{labels.close}</Button>
        </div>
        <p className="text-sm text-muted-foreground">{labels.browserHint}</p>
        <p aria-live="polite">{snapshot.loaded ? snapshot.presets.length : '—'}/{TABLE_PRESET_LIMIT}</p>
        {snapshot.error && <p role="alert" className="text-sm text-red-300">{labels.errors[snapshot.error]}</p>}
        {busy && <p role="status">{labels.working}</p>}
        {preview ? <section className="space-y-3" aria-label={labels.preview}>
          <h3 className="font-bold">{labels.preview}: {preview.name}</h3>
          <p>{labels.summary(preview)}</p>
          <ol className="space-y-2">
            {preview.seats.map((seat, index) => {
              const participant = setup.participants.find(item => item.key === seat.participantKey);
              const deck = participant?.decks.find(item => item.id === seat.deckId);
              return <li key={index} className="rounded-lg border border-border p-3 text-sm">
                {labels.seat} {index + 1}: {seat.participantKey ? participant?.displayName || labels.selectedPlayer : labels.emptySeat}
                {' · '}{seat.deckId ? deck?.name || labels.selectedDeck : labels.missingDeck}
              </li>;
            })}
          </ol>
          <p className="text-sm text-muted-foreground">{labels.previewHint}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" disabled={busy || disabled} onClick={async () => {if (await controller.confirmLoad()) close();}}>{labels.apply}</Button>
            <Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={() => controller.cancel()}>{labels.cancel}</Button>
          </div>
        </section> : <>
          <form className="space-y-3" onSubmit={event => {event.preventDefault(); void save();}}>
            <label htmlFor={inputId} className="block text-sm font-semibold">{labels.name}</label>
            <input id={inputId} aria-describedby={hintId} value={name} disabled={busy} onChange={event => setName(event.target.value)}
              className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-base" autoComplete="off" />
            <p id={hintId} className="text-xs text-muted-foreground">{Array.from(name.trim().normalize('NFC')).length}/{TABLE_PRESET_NAME_LIMIT}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-11" disabled={busy || disabled || (!editingId && snapshot.loaded && snapshot.presets.length >= TABLE_PRESET_LIMIT)}>{editingId ? labels.rename : labels.save}</Button>
              {editingId && <Button type="button" className="min-h-11" variant="ghost" disabled={busy} onClick={() => {setEditingId(null); setName('');}}>{labels.cancel}</Button>}
            </div>
          </form>
          {snapshot.loaded && snapshot.presets.length === 0 && <p>{labels.empty}</p>}
          <ul className="space-y-3">
            {snapshot.presets.map(preset => <li key={preset.id} className="space-y-2 rounded-xl border border-border p-3">
              <h3 className="break-words font-semibold">{preset.name}</h3>
              <p className="text-sm text-muted-foreground">{labels.summary(preset)}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" className="min-h-11" disabled={busy || disabled} aria-label={`${labels.load} ${preset.name}`} onClick={() => {setDeletingId(null); void controller.requestLoad(preset.id);}}>{labels.load}</Button>
                <Button type="button" size="sm" className="min-h-11" variant="outline" disabled={busy} aria-label={`${labels.rename} ${preset.name}`} onClick={() => {setEditingId(preset.id); setName(preset.name); setDeletingId(null);}}>{labels.rename}</Button>
                <Button type="button" size="sm" className="min-h-11" variant="ghost" disabled={busy} aria-label={`${labels.remove} ${preset.name}`} onClick={() => setDeletingId(preset.id)}>{labels.remove}</Button>
              </div>
              {deleting?.id === preset.id && <div className="space-y-2" role="group" aria-label={labels.confirmRemove}>
                <p>{labels.removeQuestion(preset.name)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" className="min-h-11" variant="destructive" disabled={busy} onClick={async () => {if (await controller.remove(preset.id)) {setDeletingId(null); if (editingId === preset.id) {setEditingId(null); setName('');}}}}>{labels.confirmRemove}</Button>
                  <Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={() => setDeletingId(null)}>{labels.cancel}</Button>
                </div>
              </div>}
            </li>)}
          </ul>
          <Button type="button" className="min-h-11" variant="outline" disabled={busy} onClick={() => void controller.refresh()}>{labels.retry}</Button>
        </>}
      </ModalCard>
    </ModalOverlay>}
  </>;
}
