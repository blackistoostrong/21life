'use client';
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { User } from '@supabase/supabase-js';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/components/language-provider';
import { supabase } from '@/lib/supabase';
import { canKickArenaMember } from '@/lib/arena-membership';
import { getProfileDisplayName } from '@/lib/profile-display';
import type { Group, Profile } from '@/lib/types/arena-catalog';

export function useArenaMembership(user: User | null, group: Group | null, adminMode: boolean,
  canLeaveCurrentArena: boolean, setMembers: Dispatch<SetStateAction<Profile[]>>) {
  const router = useRouter();
  const { toast } = useToast();
  const { copy: t } = useLanguage();
  const [showDeleteArenaModal, setShowDeleteArenaModal] = useState(false);

  const [showLeaveArenaModal, setShowLeaveArenaModal] = useState(false);

  const [leaveArenaConfirmation, setLeaveArenaConfirmation] = useState('');

  const [deleteArenaConfirmation, setDeleteArenaConfirmation] = useState('');

  const [leavingArena, setLeavingArena] = useState(false);

  const [kickingMemberIds, setKickingMemberIds] = useState<string[]>([]);

  const [deletingArena, setDeletingArena] = useState(false);

  const handleDeleteGroup = async () => {
    if (!group || !user || (!adminMode && group.created_by !== user.id)) return;
    if (deleteArenaConfirmation !== group.name) return;

    setDeletingArena(true);
    try {
      const { error } = await supabase.from('groups').delete().eq('id', group.id);
      if (error) throw error;
      toast({
        title: t({ it: 'Playgroup eliminato', en: 'Playgroup deleted' }),
        description: t({ it: 'Playgroup, partite e iscrizioni collegate sono stati rimossi.', en: 'The playgroup and all related battles have been removed.' }),
      });
      router.push('/dashboard');
    } catch (error: unknown) {
      toast({ title: t({ it: 'Errore', en: 'Error' }), description: error instanceof Error ? error.message : t({ it: 'Impossibile eliminare il playgroup', en: 'Failed to delete playgroup' }), variant: 'destructive' });
    } finally {
      setDeletingArena(false);
    }
  };

  const openDeleteArenaModal = () => {
    setDeleteArenaConfirmation('');
    setShowDeleteArenaModal(true);
  };

  const openLeaveArenaModal = () => {
    setLeaveArenaConfirmation('');
    setShowLeaveArenaModal(true);
  };

  const handleLeaveArena = async () => {
    if (!group || !user || !canLeaveCurrentArena) {
      toast({
        title: t({ it: 'Impossibile uscire', en: 'Unable to leave' }),
        description: t({
          it: 'Se sei l\'ultimo membro, elimina il playgroup con il pulsante esistente.',
          en: 'If you are the last member, delete the playgroup using the existing button.',
        }),
        variant: 'destructive',
      });
      return;
    }

    setLeavingArena(true);
    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', group.id)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: t({ it: 'Sei uscito dal playgroup', en: 'You left the playgroup' }),
        description: t({
          it: 'Non vedrai più questo playgroup nella dashboard.',
          en: 'This playgroup will no longer appear on your dashboard.',
        }),
      });
      setShowLeaveArenaModal(false);
      setLeaveArenaConfirmation('');
      router.push('/dashboard');
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error
          ? error.message
          : t({ it: 'Impossibile uscire dal playgroup', en: 'Failed to leave playgroup' }),
        variant: 'destructive',
      });
    } finally {
      setLeavingArena(false);
    }
  };

  const handleKickMember = async (member: Profile) => {
    if (!group || !user) return;

    if (!canKickArenaMember({
      actorId: user.id,
      targetId: member.id,
      group,
      isPlatformAdmin: adminMode,
    })) {
      return;
    }

    setKickingMemberIds((ids) => [...ids, member.id]);
    try {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', group.id)
        .eq('user_id', member.id);

      if (error) throw error;

      setMembers((current) => current.filter((entry) => entry.id !== member.id));
      toast({
        title: t({ it: 'Giocatore rimosso', en: 'Player removed' }),
        description: t({
          it: `${getProfileDisplayName(member)} non fa più parte del playgroup.`,
          en: `${getProfileDisplayName(member)} is no longer part of this playgroup.`,
        }),
      });
    } catch (error: unknown) {
      toast({
        title: t({ it: 'Errore', en: 'Error' }),
        description: error instanceof Error
          ? error.message
          : t({ it: 'Impossibile rimuovere il giocatore', en: 'Failed to remove player' }),
        variant: 'destructive',
      });
    } finally {
      setKickingMemberIds((ids) => ids.filter((id) => id !== member.id));
    }
  };
  return { showDeleteArenaModal, setShowDeleteArenaModal, showLeaveArenaModal, setShowLeaveArenaModal, leaveArenaConfirmation, setLeaveArenaConfirmation, deleteArenaConfirmation, setDeleteArenaConfirmation, leavingArena, setLeavingArena, kickingMemberIds, setKickingMemberIds, deletingArena, setDeletingArena, handleDeleteGroup, openDeleteArenaModal, openLeaveArenaModal, handleLeaveArena, handleKickMember };
}
