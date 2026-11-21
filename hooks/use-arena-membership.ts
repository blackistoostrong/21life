'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useCommandScope, type CommandJob } from '@/hooks/use-command-scope';
import { useLanguage } from '@/components/language-provider';
import { supabase } from '@/lib/supabase';
import { canKickArenaMember } from '@/lib/arena-membership';
import { getProfileDisplayName } from '@/lib/profile-display';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { isLeaveArenaConfirmationValid } from '@/lib/leave-arena-confirm';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { Group, Profile } from '@/lib/types/arena-catalog';

type Kind = 'leave' | 'delete' | 'kick';
type Dialog = { epoch: CommandJob['epoch']; mode: 'leave' | 'delete'; confirmation: string };
type Pending = { job: CommandJob; kind: Kind; targetId: string };
function assertActive(job: CommandJob) {
  job.signal.throwIfAborted();
  if (!job.active()) throw new DOMException('Operation aborted', 'AbortError');
}

/** Owns membership drafts and commands for one authenticated arena/permission snapshot. */
export function useArenaMembership(user: User | null, group: Group | null, adminMode: boolean,
  canLeaveCurrentArena: boolean, setMembers: Dispatch<SetStateAction<Profile[]>>) {
  const router = useRouter();
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const key = user && group ? JSON.stringify([user.id, group.id, group.created_by, group.name, adminMode]) : null;
  const { epoch, begin, cancel, committed, pending } = useCommandScope<'membership'>(key, true);
  const [draft, setDraft] = useState<Dialog | null>(null);
  const [current, setCurrent] = useState<Pending | null>(null);
  const dialog = draft?.epoch === epoch ? draft : null;
  const busy = current?.job.epoch === epoch && current.job.active() ? current : null;
  const open = (mode: Dialog['mode']) => {
    if (!key || !committed() || pending('membership')) return;
    setDraft({ epoch, mode, confirmation: '' });
  };
  const closeDialog = () => {
    if (!committed()) return;
    cancel();
    setDraft(previous => previous?.epoch === epoch ? null : previous);
    setCurrent(previous => previous?.job.epoch === epoch ? null : previous);
  };
  const setConfirmation = (confirmation: string) => {
    if (!committed() || pending('membership')) return;
    setDraft(previous => previous?.epoch === epoch ? { ...previous, confirmation } : previous);
  };
  const run = async (kind: Kind, targetId: string, task: (job: CommandJob) => Promise<void>) => {
    const job = begin('membership');
    if (!job) return;
    setCurrent({ job, kind, targetId });
    try { await task(job); }
    catch (error) {
      if (job.active()) toast({ title: t({ it: 'Errore', en: 'Error' }), variant: 'destructive',
        description: getSupabaseErrorMessage(error, t(kind === 'delete'
          ? { it: 'Impossibile eliminare il playgroup', en: 'Failed to delete playgroup' }
          : kind === 'leave' ? { it: 'Impossibile uscire dal playgroup', en: 'Failed to leave playgroup' }
            : { it: 'Impossibile rimuovere il giocatore', en: 'Failed to remove player' })) });
    } finally {
      if (job.active()) setCurrent(previous => job.active() && previous?.job === job ? null : previous);
      job.finish();
    }
  };
  const removeMember = async (groupId: string, targetId: string, job: CommandJob) => {
    const { data, error } = await withRequestDeadline({ abortSignal: signal => {
      assertActive(job);
      return supabase.from('group_members').delete().eq('group_id', groupId)
        .eq('user_id', targetId).select('user_id').abortSignal(signal);
    } }, 15000, job.signal);
    if (error) throw error;
    assertActive(job);
    if (!data?.some(row => row.user_id === targetId)) throw new Error(t({
      it: 'Iscrizione non rimossa. Aggiorna il playgroup e riprova.',
      en: 'Membership was not removed. Refresh the playgroup and retry.',
    }));
  };
  const handleDeleteGroup = async () => {
    if (!group || !user || (!adminMode && group.created_by !== user.id)
      || dialog?.mode !== 'delete' || dialog.confirmation !== group.name) return;
    await run('delete', group.id, async job => {
      const { data, error } = await withRequestDeadline({ abortSignal: signal => {
        assertActive(job);
        return supabase.from('groups').delete().eq('id', group.id).select('id').abortSignal(signal);
      } }, 15000, job.signal);
      if (error) throw error;
      assertActive(job);
      if (!data?.some(row => row.id === group.id)) throw new Error(t({
        it: 'Playgroup non eliminato. Aggiorna e riprova.', en: 'Playgroup was not deleted. Refresh and retry.',
      }));
      toast({ title: t({ it: 'Playgroup eliminato', en: 'Playgroup deleted' }),
        description: t({ it: 'Playgroup, partite e iscrizioni collegate sono stati rimossi.',
          en: 'The playgroup and all related battles have been removed.' }) });
      router.push('/dashboard');
    });
  };
  const handleLeaveArena = async () => {
    if (dialog?.mode !== 'leave' || !isLeaveArenaConfirmationValid(dialog.confirmation)) return;
    if (!group || !user || !canLeaveCurrentArena) {
      toast({ title: t({ it: 'Impossibile uscire', en: 'Unable to leave' }), variant: 'destructive',
        description: t({ it: "Se sei l'ultimo membro, elimina il playgroup con il pulsante esistente.",
          en: 'If you are the last member, delete the playgroup using the existing button.' }) });
      return;
    }
    await run('leave', user.id, async job => {
      await removeMember(group.id, user.id, job);
      assertActive(job);
      toast({ title: t({ it: 'Sei uscito dal playgroup', en: 'You left the playgroup' }),
        description: t({ it: 'Non vedrai più questo playgroup nella dashboard.',
          en: 'This playgroup will no longer appear on your dashboard.' }) });
      setDraft(previous => job.active() && previous?.epoch === epoch ? null : previous);
      router.push('/dashboard');
    });
  };
  const handleKickMember = async (member: Profile) => {
    if (!group || !user || !canKickArenaMember({ actorId: user.id, targetId: member.id, group, isPlatformAdmin: adminMode })) return;
    await run('kick', member.id, async job => {
      await removeMember(group.id, member.id, job);
      assertActive(job);
      setMembers(previous => job.active() ? previous.filter(entry => entry.id !== member.id) : previous);
      toast({ title: t({ it: 'Giocatore rimosso', en: 'Player removed' }), description: t({
        it: `${getProfileDisplayName(member)} non fa più parte del playgroup.`,
        en: `${getProfileDisplayName(member)} is no longer part of this playgroup.`,
      }) });
    });
  };
  return {
    showDeleteArenaModal: dialog?.mode === 'delete', showLeaveArenaModal: dialog?.mode === 'leave',
    deleteArenaConfirmation: dialog?.mode === 'delete' ? dialog.confirmation : '',
    leaveArenaConfirmation: dialog?.mode === 'leave' ? dialog.confirmation : '',
    deletingArena: busy?.kind === 'delete', leavingArena: busy?.kind === 'leave',
    kickingMemberIds: busy?.kind === 'kick' ? [busy.targetId] : [], membershipBusy: Boolean(busy),
    openDeleteArenaModal: () => open('delete'), openLeaveArenaModal: () => open('leave'),
    closeDialog, setConfirmation, handleDeleteGroup, handleLeaveArena, handleKickMember,
  };
}
