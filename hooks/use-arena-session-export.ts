'use client';
import { useLanguage } from '@/components/language-provider';
import { useToast } from '@/hooks/use-toast';
import type { ArenaHistoryScope } from '@/packages/domain/arena-history';
import type { Match } from '@/lib/types/arena-match';
import { useArenaDayExport } from '@/hooks/use-arena-day-export';
import { useCommandScope } from '@/hooks/use-command-scope';
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { getParticipantDeckSnapshot, getParticipantDisplayName } from '@/lib/arena-participants';
import { groupMatchesByDay } from '@/lib/arena-session';
import { buildArenaSessionExportText, type ArenaSessionExportMatch } from '@/lib/arena-session-export';
import { format, parse } from 'date-fns';
import { enUS, it as itLocale } from 'date-fns/locale';

/** Arena-day presentation and the complete export draft retain the page lifetime. */
export function useArenaSessionExport(userId: string | null, groupId: string, scope: ArenaHistoryScope | null, matches: Match[]) {
  const { copy: t, language } = useLanguage();
  const { toast } = useToast();
  const [expandedDayKeys, setExpandedDayKeys] = useState<Set<string>>(new Set());

  const contextKey = userId ? JSON.stringify([userId, groupId]) : null;
  const commands = useCommandScope<'share'>(contextKey, true, scope);
  const { epoch } = commands;
  const opening = useRef(0);
  const [draft, setDraft] = useState<{
    epoch: typeof epoch; opening: number; dayKey: string; intro: string;
  } | null>(null);
  const current = draft?.epoch === epoch ? draft : null;
  const exportDayKey = current?.dayKey ?? null;
  const activeExportDayKey = exportDayKey;
  const exportIntro = current?.intro ?? '';
  const setExportIntro = (intro: string) => {
    if (!commands.committed() || !current) return;
    setDraft(previous => previous?.epoch === epoch && previous.opening === current.opening
      ? { ...previous, intro } : previous);
  };
  useLayoutEffect(() => {
    setDraft(null);
    setExpandedDayKeys(new Set());
  }, [epoch]);

  const dayExport=useArenaDayExport(userId ?? undefined,scope,activeExportDayKey);

  const matchDayGroups=useMemo(()=>groupMatchesByDay(matches,{
    formatLabel:dayKey=>format(parse(dayKey,'yyyy-MM-dd',new Date()),'d MMM yyyy',{locale:language==='it'?itLocale:enUS}),
    unknownDateLabel:t({it:'Data non disponibile',en:'Date unavailable'}),
  }),[matches,language,t]);

  const latestDayKey = matchDayGroups[0]?.dayKey ?? null;

  useEffect(() => {
    if (!latestDayKey) {
      setExpandedDayKeys(new Set());
      return;
    }

    setExpandedDayKeys((current) => {
      if (current.size === 0) {
        return new Set([latestDayKey]);
      }

      const next = new Set(current);
      next.add(latestDayKey);
      return next;
    });

  }, [latestDayKey, epoch]);

  const toggleDayGroup = (dayKey: string, open: boolean) => {
    setExpandedDayKeys((current) => {
      const next = new Set(current);
      if (open) {
        next.add(dayKey);
      } else {
        next.delete(dayKey);
      }
      return next;
    });
  };

  const buildSessionExportMatch = (match: Match): ArenaSessionExportMatch => ({
    participants: match.match_participants.map((participant) => {
      const deck = getParticipantDeckSnapshot(participant);
      const commanderLabel = deck?.commander?.trim() || deck?.name?.trim() || '—';
      return {
        displayName: getParticipantDisplayName(participant),
        commanderLabel,
      };
    }),
    notes: match.notes,
  });

  const openDayExportModal = (dayKey: string) => {
    if (!commands.committed()) return;
    commands.cancel();
    setDraft({ epoch, opening: ++opening.current, dayKey, intro: '' });
  };

  const closeDayExportModal = () => {
    commands.cancel();
    setDraft(null);
  };

  const handleExportDayMatches = async () => {
    if(!activeExportDayKey || !dayExport.ready)return;
    const dayMatches=dayExport.matches as unknown as Match[];
    if(!dayMatches.length)return;
    const job = commands.begin('share');
    if (!job) return;

    const dayGroup = matchDayGroups.find((entry) => entry.dayKey === activeExportDayKey);
    const exportMatches = [...dayMatches]
      .reverse()
      .map((match) => buildSessionExportMatch(match));
    const text = buildArenaSessionExportText(exportIntro, exportMatches);

    try {
      if (navigator.share) {
        await navigator.share({
          title: dayGroup?.label || activeExportDayKey,
          text,
        });
        if (!job.active()) return;
        closeDayExportModal();
        return;
      }

      await navigator.clipboard.writeText(text);
      if (!job.active()) return;
      toast({
        title: t({ it: 'Export copiato', en: 'Export copied' }),
        description: t({
          it: 'Il testo del giorno è negli appunti.',
          en: 'The day export is in your clipboard.',
        }),
      });
      closeDayExportModal();
    } catch (error) {
      if (!job.active()) return;
      if ((error as DOMException)?.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(text);
        if (!job.active()) return;
        toast({
          title: t({ it: 'Export copiato', en: 'Export copied' }),
          description: t({
            it: 'Il testo del giorno è negli appunti.',
            en: 'The day export is in your clipboard.',
          }),
        });
        closeDayExportModal();
      } catch {
        if (!job.active()) return;
        toast({
          title: t({ it: 'Errore', en: 'Error' }),
          description: t({ it: 'Impossibile esportare le partite', en: 'Unable to export matches' }),
          variant: 'destructive',
        });
      }
    } finally {
      job.finish();
    }
  };
  return { expandedDayKeys, exportDayKey, exportIntro, setExportIntro, activeExportDayKey, dayExport, matchDayGroups, toggleDayGroup, openDayExportModal, closeDayExportModal, handleExportDayMatches };
}
