'use client';

import { useEffect, useRef, useState } from 'react';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { Pencil, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { setArenaSeasonSettings } from '@/lib/arena-seasons';
import { ArenaSeasonSettings } from '@/components/arena-season-settings';
import { ModalCard, ModalOverlay } from '@/components/ui/modal-shell';
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

export type ArenaSettingsUpdate = {
  name: string;
  description: string | null;
  is_public: boolean;
  seasons_enabled: boolean;
  season_reset_month: number;
};

type ArenaSettingsGroup = {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  is_public?: boolean;
  seasons_enabled?: boolean;
  season_reset_month?: number;
};

/** Owns the editor draft and its writes. Mount on open to snapshot current metadata. */
export function ArenaSettingsEditor({ group, seasonResetMonth, reloadSeason, onSaved, onClose }: {
  group: ArenaSettingsGroup;
  seasonResetMonth?: number;
  reloadSeason: () => Promise<void>;
  onSaved: (update: ArenaSettingsUpdate) => void;
  onClose: () => void;
}) {
  const { copy: t, language } = useLanguage();
  const { toast } = useToast();
  const [editArenaName, setEditArenaName] = useState(group.name);
  const [editArenaDescription, setEditArenaDescription] = useState(group.description || '');
  const [editArenaIsPublic, setEditArenaIsPublic] = useState(Boolean(group.is_public));
  const [editArenaSeasonsEnabled, setEditArenaSeasonsEnabled] = useState(group.seasons_enabled ?? true);
  const [editArenaResetMonth, setEditArenaResetMonth] = useState(group.season_reset_month ?? seasonResetMonth ?? 1);
  const [savingArena, setSavingArena] = useState(false);

  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  const close = () => {
    request.current?.abort();
    onClose();
  };

  const handleSaveArena = async () => {
    if (!editArenaName.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const current = () => request.current === controller && !controller.signal.aborted;
    setSavingArena(true);
    try {
      const { error } = await withRequestDeadline(supabase
        .from('groups')
        .update({
          name: editArenaName.trim(),
          description: editArenaDescription.trim() || null,
          is_public: editArenaIsPublic,
        })
        .eq('id', group.id), 15000, controller.signal);
      if (!current()) return;
      if (error) throw error;
      const seasonSettingsChanged = editArenaSeasonsEnabled !== (group.seasons_enabled ?? true)
        || editArenaResetMonth !== (seasonResetMonth ?? group.season_reset_month ?? 1);
      if (seasonSettingsChanged) {
        const client = {
          rpc: (name: string, args: Record<string, unknown>) =>
            withRequestDeadline(supabase.rpc(name, args), 15000, controller.signal),
        };
        await setArenaSeasonSettings(client, group.id, editArenaSeasonsEnabled, editArenaResetMonth);
        if (!current()) return;
        await reloadSeason();
      }
      if (!current()) return;
      toast({ title: t({ it: 'Playgroup aggiornato!', en: 'Playgroup updated!' }) });
      onSaved({
        name: editArenaName.trim(),
        description: editArenaDescription.trim() || null,
        is_public: editArenaIsPublic,
        seasons_enabled: editArenaSeasonsEnabled,
        season_reset_month: editArenaResetMonth,
      });
    } catch (error: unknown) {
      if (!current()) return;
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: error instanceof Error ? error.message : t({ it: 'Impossibile aggiornare il playgroup', en: 'Failed to update playgroup' }), variant: 'destructive' });
    } finally {
      if (current()) setSavingArena(false);
      if (request.current === controller) request.current = null;
    }
  };

  return (
    <ModalOverlay>
      <ModalCard>
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <Pencil className="w-5 h-5" /> {t({ it: 'Modifica playgroup', en: 'Edit Playgroup' })}
          </CardTitle>
          <CardDescription className="text-muted-foreground">{t({ it: 'Aggiorna nome e descrizione del playgroup', en: 'Update the playgroup name and description' })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t({ it: 'Nome playgroup', en: 'Playgroup Name' })}</label>
              <Input
                value={editArenaName}
                onChange={(e) => setEditArenaName(e.target.value)}
                placeholder={t({ it: 'Il mio playgroup', en: 'My Playgroup' })}
                className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t({ it: 'Descrizione (opzionale)', en: 'Description (optional)' })}</label>
              <Textarea
                value={editArenaDescription}
                onChange={(e) => setEditArenaDescription(e.target.value)}
                placeholder={t({ it: 'Descrizione del playgroup...', en: 'A description of this playgroup...' })}
                className="bg-background/50 border-border text-foreground placeholder:text-muted-foreground resize-none"
                rows={3}
              />
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-background/30 p-3">
              <Checkbox
                id="arena-is-public"
                checked={editArenaIsPublic}
                onCheckedChange={(checked) => setEditArenaIsPublic(checked === true)}
              />
              <div className="space-y-1">
                <label htmlFor="arena-is-public" className="text-sm font-medium text-foreground">
                  {t({ it: 'Profilo playgroup pubblico', en: 'Public playgroup profile' })}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t({
                    it: 'Chi ha il link puo vedere statistiche e partite in sola lettura.',
                    en: 'Anyone with the link can view read-only stats and match history.',
                  })}
                </p>
                {editArenaIsPublic && group?.invite_code && (
                  <a
                    href={`/arena/${group.invite_code}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
                  >
                    {t({ it: 'Apri pagina pubblica', en: 'Open public page' })}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
            <ArenaSeasonSettings
              enabled={editArenaSeasonsEnabled}
              resetMonth={editArenaResetMonth}
              locale={language === 'it' ? 'it-IT' : 'en-US'}
              labels={{
                enabled: t({ it: 'Abilita le season', en: 'Enable seasons' }),
                enabledHint: t({
                  it: 'Classifiche e statistiche ripartono ogni anno. Disabilitando, l’Arena usa tutto lo storico.',
                  en: 'Leaderboards and stats restart yearly. When disabled, the Arena uses its full history.',
                }),
                startMonth: t({ it: 'Mese di inizio season', en: 'Season start month' }),
                resetHint: t({
                  it: 'La season dura un anno. Cambiare mese ricalcola gli archivi senza eliminare partite o score personali.',
                  en: 'A season lasts one year. Changing the month rebuilds archives without deleting matches or personal scores.',
                }),
              }}
              onEnabledChange={setEditArenaSeasonsEnabled}
              onResetMonthChange={setEditArenaResetMonth}
            />
            <div className="flex gap-3 pt-2">
              <Button variant="outline" className="flex-1 border-border text-foreground" onClick={close}>
                {t({ it: 'Annulla', en: 'Cancel' })}
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-700"
                onClick={handleSaveArena}
                disabled={savingArena || !editArenaName.trim()}
              >
                {savingArena ? t({ it: 'Salvataggio...', en: 'Saving...' }) : t({ it: 'Salva modifiche', en: 'Save Changes' })}
              </Button>
            </div>
          </div>
        </CardContent>
      </ModalCard>
    </ModalOverlay>
  );
}
