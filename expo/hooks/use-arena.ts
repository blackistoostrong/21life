import {useArenaHistory} from '@/hooks/use-arena-history';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArenaGuest } from '@/lib/arena-participants';
import {
  fetchArenaGroup,
  fetchArenaGuests,
  fetchArenaMemberDecks,
} from '@/lib/arena-queries';
import { getParticipantDeckSnapshot } from '@/lib/arena-participants';
import { calculatePlayerStats } from '@/lib/arena-stats';
import { refreshMissingImportedDeckImages } from '@/lib/arena-deck-images';
import { prefetchCommanderNames, prefetchDeckImageUrls } from '@/lib/deck-image-cache';
import type { CommanderSearchResult } from '@/lib/commander-types';
import { addDeckToGuest, createGuestWithDeck } from '@/lib/guest-arena';
import { getSupabaseErrorMessage } from '@/lib/supabase-errors';
import { supabase } from '@/lib/supabase';
import { deleteArenaMatch } from '@/lib/arena-match-write';
import { useArenaMatchWrite } from '@/hooks/use-arena-match-write';
import type { ArenaDetail, ArenaMatch, ArenaProfile, MemberDeck } from '@/lib/types/arena';
import { subscribeToArenaCatalog } from '@/lib/arena-catalog-realtime';
import {
  clearArenaCache,
  loadArenaCache,
  saveArenaCache,
  type ArenaCacheSnapshot,
} from '@/lib/arena-cache';

export function useArena(groupId: string | undefined, userId: string | undefined) {
  const contextKey=groupId && userId?`${userId}:${groupId}`:null;
  const activeContext=useRef<string|null>(null);
  const [loadedContext,setLoadedContext]=useState<string|null>(null);
  const [readError,setReadError]=useState<string|null>(null);
  const isCurrent=useCallback(()=>contextKey!==null && activeContext.current===contextKey,[contextKey]);
  useEffect(()=>{activeContext.current=contextKey;return()=>{activeContext.current=null;};},[contextKey]);
  const [group, setGroup] = useState<ArenaDetail | null>(null);
  const [members, setMembers] = useState<ArenaProfile[]>([]);
  const history=useArenaHistory(groupId,userId);
  const {matches,seed:seedHistory,reload:reloadHistory,loadMore:loadMoreMatches}=history;
  const [guests, setGuests] = useState<ArenaGuest[]>([]);
  const [decks, setDecks] = useState<MemberDeck[]>([]);
  const [loading, setLoading] = useState(true);
  const memberIdsRef = useRef<string[]>([]);

  const applySnapshot = useCallback((snapshot: ArenaCacheSnapshot) => {
    if(!isCurrent())return;
    setLoadedContext(contextKey);
    setGroup(snapshot.group);
    setMembers(snapshot.members);
    seedHistory(snapshot.matches);
    setGuests(snapshot.guests);
    setDecks(snapshot.decks);
    memberIdsRef.current = snapshot.members.map((member) => member.id);
  }, [contextKey,isCurrent,seedHistory]);

  const refreshMatches = useCallback(async () => {
    const rows=await reloadHistory();
    if(rows && groupId && userId && isCurrent()){
      const cached=await loadArenaCache(groupId,userId);
      if(cached)await saveArenaCache({...cached,matches:rows});
    }
    return rows??[];
  },[groupId,userId,reloadHistory,isCurrent]);

  const loadMemberDecks = useCallback(async (memberIds: string[]) => {
    if (!groupId) return [] as MemberDeck[];
    const loadedDecks = await fetchArenaMemberDecks(supabase, groupId, memberIds);
    if(isCurrent())setDecks(loadedDecks);
    return loadedDecks;
  }, [groupId,isCurrent]);

  const refreshMemberDecks = useCallback(async (memberId: string) => {
    if (!groupId) throw new Error('ARENA_DECKS_READ_FAILED');
    const loaded = await fetchArenaMemberDecks(supabase, groupId, [memberId], { strict: true });
    if(!isCurrent())throw new Error('ARENA_CONTEXT_CHANGED');
    setDecks((current) => [...current.filter((deck) => deck.user_id !== memberId), ...loaded]);
    return loaded.length >= 120;
  }, [groupId,isCurrent]);

  const refresh = useCallback(async (showLoading = true) => {
    if(!isCurrent())return null;
    setReadError(null);
    if (!groupId || !userId) {
      setLoading(false);
      return null;
    }

    if (showLoading) setLoading(true);
    try {
      const [groupData, matchesPage, guestData] = await Promise.all([
        fetchArenaGroup(supabase, groupId),
        reloadHistory(),
        fetchArenaGuests(supabase, groupId),
      ]);
      if(!isCurrent())return null;
      const loadedMatches = matchesPage ?? [];

      if (!groupData) {
        setLoadedContext(contextKey);
        setGroup(null);
        setMembers([]);
        setGuests([]);
        setDecks([]);
        await clearArenaCache(groupId, userId);
        return null;
      }

      setGroup(groupData);
      setMembers(groupData.group_members.map((member) => member.profiles));
      if(isCurrent())setGuests(guestData);

      const memberIds = groupData.group_members.map((member) => member.user_id);
      memberIdsRef.current = memberIds;
      const loadedDecks = await loadMemberDecks(memberIds);
      if(!isCurrent())return null;
      setLoadedContext(contextKey);

      const cacheMatches=matchesPage ?? (await loadArenaCache(groupId,userId))?.matches ?? [];
      await saveArenaCache({
        groupId,
        userId,
        group: groupData,
        members: groupData.group_members.map((member) => member.profiles),
        matches: cacheMatches,
        guests: guestData,
        decks: loadedDecks,
      });

      const participantDecks = loadedMatches.flatMap((match) =>
        match.match_participants.map((participant) => getParticipantDeckSnapshot(participant)),
      );

      void prefetchDeckImageUrls([
        ...participantDecks.map((deck) => deck?.commander_image),
        ...loadedDecks.map((deck) => deck.commander_image),
        ...guestData.flatMap((guest) =>
          (guest.arena_guest_decks || []).map((deck) => deck.commander_image),
        ),
      ], { background: true });

      void prefetchCommanderNames([
        ...participantDecks.map((deck) => deck?.commander),
        ...loadedDecks.map((deck) => deck.commander),
        ...guestData.flatMap((guest) =>
          (guest.arena_guest_decks || []).map((deck) => deck.commander),
        ),
      ], { background: true });

      void refreshMissingImportedDeckImages(loadedDecks).then(async () => {
        if(!isCurrent())return;
        const repairedDecks = await loadMemberDecks(memberIds);
        const cached = await loadArenaCache(groupId, userId);
        if (cached) await saveArenaCache({ ...cached, decks: repairedDecks });
      });

      return groupData;
    } catch (error) {
      if(isCurrent()){setLoadedContext(contextKey);setReadError('ARENA_READ_UNAVAILABLE');}
      console.error('Error fetching arena:', getSupabaseErrorMessage(error, 'Failed to fetch arena'));
      return null;
    } finally {
      if(isCurrent())setLoading(false);
    }
  }, [contextKey,isCurrent,groupId, loadMemberDecks, reloadHistory, userId]);

  useEffect(() => {
    if (!groupId || !userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    memberIdsRef.current=[];
    setGroup(null);
    setMembers([]);
    setGuests([]);
    setDecks([]);
    setLoading(true);
    void (async () => {
      const cached = await loadArenaCache(groupId, userId);
      if (cancelled) return;
      if (cached) {
        applySnapshot(cached);
        setLoading(false);
      }
      await refresh(!cached);
    })();
    return () => { cancelled = true; };
  }, [applySnapshot, groupId, refresh, userId]);

  useEffect(() => {
    if (!groupId || !userId) return;
    return subscribeToArenaCatalog(supabase, groupId, (event) => {
      if(!isCurrent())return;
      if (event.entity === 'deck') {
        void loadMemberDecks(memberIdsRef.current);
        return;
      }
      if (event.entity === 'guest' || event.entity === 'guest_deck') {
        void fetchArenaGuests(supabase, groupId).then(rows=>{if(isCurrent())setGuests(rows);});
        return;
      }
      void refresh(false);
    }, { scopeKey: userId });
  }, [groupId, loadMemberDecks, refresh, userId,isCurrent]);

  const writeMatch = useArenaMatchWrite(groupId, userId);

  const playerStats = useMemo(() => calculatePlayerStats(matches), [matches]);

  const createMatch = useCallback(async (input: {
    selectedParticipantKeys: string[];
    winnerKey: string | null;
    isDraw: boolean;
    participantDecks: Record<string, string>;
    matchPlayedAtIso: string;
    matchNotes: string;
    winCondition: NonNullable<import('@/lib/types/arena').ArenaMatch['win_condition']>;
    signal?: AbortSignal;
    requestScope?: unknown;
  }) => {
    if (!groupId || !userId) {
      throw new Error('Missing arena context');
    }

    await writeMatch({ mode: 'create', isDraw: input.isDraw, winnerKey: input.winnerKey,
      notes: input.matchNotes, playedAt: input.matchPlayedAtIso, winCondition: input.winCondition,
      players: input.selectedParticipantKeys.map(key => ({ key, deckId: input.participantDecks[key] || null })) }, undefined, input.signal, input.requestScope);
    const hasGuests = input.selectedParticipantKeys.some(key => key.startsWith('guest:'));
    if (!isCurrent()) return;

    await Promise.allSettled([refreshMatches(), ...(hasGuests ? [fetchArenaGuests(supabase, groupId).then(guestData => {
      if (isCurrent()) setGuests(guestData);
    })] : [])]);
  }, [groupId, refreshMatches, userId, isCurrent, writeMatch]);

  const updateGroup = useCallback(async (name: string, description: string, isPublic?: boolean) => {
    if (!groupId) return;

    const payload: {
      name: string;
      description: string | null;
      is_public?: boolean;
    } = {
      name: name.trim(),
      description: description.trim() || null,
    };

    if (typeof isPublic === 'boolean') {
      payload.is_public = isPublic;
    }

    const { error } = await supabase
      .from('groups')
      .update(payload)
      .eq('id', groupId);

    if (error) throw error;
    await refresh();
  }, [groupId, refresh]);

  const updateMatch = useCallback(async (input: {
    matchId: string;
    winnerKey: string | null;
    isDraw: boolean;
    participantDecks: Record<string, string>;
    matchPlayedAtIso: string | null;
    matchNotes: string;
    winCondition: import('@/lib/types/arena').ArenaMatch['win_condition'];
    isArenaManager: boolean;
    signal?: AbortSignal;
    participants: Array<{
      id: string;
      participantKey: string | null;
      isGuest: boolean;
      replacementKey: string | null;
    }>;
  }) => {
    if (input.participants.some((participant) => participant.replacementKey) && !input.isArenaManager) {
      throw new Error('Only the arena manager can replace match participants');
    }
    const winnerKey = input.participants.find(participant => participant.participantKey === input.winnerKey)?.replacementKey || input.winnerKey;
    await writeMatch({ mode: 'edit', isDraw: input.isDraw, winnerKey, notes: input.matchNotes,
      playedAt: input.matchPlayedAtIso, winCondition: input.winCondition ?? null,
      players: input.participants.map(participant => {
        const key = participant.replacementKey || participant.participantKey;
        return { id: participant.id, key, deckId: key ? input.participantDecks[key] || null : null };
      }) }, input.matchId, input.signal);
    if (!isCurrent()) return;

    await Promise.allSettled([refreshMatches()]);
  }, [refreshMatches, isCurrent, writeMatch]);

  const kickMember = useCallback(async (memberId: string) => {
    if (!groupId) return;

    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', memberId);

    if (error) throw error;
    await refresh();
  }, [groupId, refresh]);

  const deleteArena = useCallback(async () => {
    if (!groupId) return;

    const { error } = await supabase
      .from('groups')
      .delete()
      .eq('id', groupId);

    if (error) throw error;
  }, [groupId]);

  const leaveArena = useCallback(async () => {
    if (!groupId || !userId) return;

    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId);

    if (error) throw error;
  }, [groupId, userId]);

  const deleteMatch = useCallback(async (matchId: string) => {
    if (!groupId || !isCurrent()) throw new Error('ARENA_CONTEXT_CHANGED');
    await deleteArenaMatch(supabase, groupId, matchId);
    if (isCurrent()) await refreshMatches();
  }, [groupId, isCurrent, refreshMatches]);

  const addGuest = useCallback(async (input: {
    displayName: string;
    commander: CommanderSearchResult;
    partnerCommander?: CommanderSearchResult | null;
    deckName?: string;
    selectedArtUrl?: string | null;
  }) => {
    if (!groupId) throw new Error('Missing arena');

    await createGuestWithDeck(supabase, {
      groupId,
      displayName: input.displayName,
      commander: input.commander,
      partnerCommander: input.partnerCommander,
      deckName: input.deckName,
      selectedArtUrl: input.selectedArtUrl,
      existingGuests: guests,
    });

    const guestData = await fetchArenaGuests(supabase, groupId);
    if(isCurrent())setGuests(guestData);
  }, [groupId, guests,isCurrent]);

  const addGuestDeck = useCallback(async (input: {
    guestId: string;
    commander: CommanderSearchResult;
    partnerCommander?: CommanderSearchResult | null;
    deckName?: string;
    selectedArtUrl?: string | null;
  }) => {
    if (!groupId) throw new Error('Missing arena');

    await addDeckToGuest(supabase, {
      groupId,
      guestId: input.guestId,
      commander: input.commander,
      partnerCommander: input.partnerCommander,
      deckName: input.deckName,
      selectedArtUrl: input.selectedArtUrl,
    });

    const guestData = await fetchArenaGuests(supabase, groupId);
    if(isCurrent())setGuests(guestData);
  }, [groupId,isCurrent]);

  const removeGuest = useCallback(async (guestId: string) => {
    if (!groupId) return;

    const { error } = await supabase
      .from('arena_guests')
      .delete()
      .eq('id', guestId)
      .eq('group_id', groupId);

    if (error) throw error;

    const guestData = await fetchArenaGuests(supabase, groupId);
    if(isCurrent())setGuests(guestData);
    await refreshMatches();
  }, [groupId, refreshMatches,isCurrent]);

  const visible=contextKey!==null && loadedContext===contextKey;
  return {
    arenaError:visible?readError:null,
    group:visible?group:null,
    members:visible?members:[],
    matches,
    hasMoreMatches:history.hasMore,
    loadingMoreMatches:history.loadingMore,
    historyRevision:history.revision,
    historyTotal:history.total,
    historyLoading:history.loading,
    historyError:history.error,
    historyCached:history.cached,
    retryHistory:history.reload,
    guests:visible?guests:[],
    decks:visible?decks:[],
    playerStats,
    loading:Boolean(groupId && userId) && (!visible || loading),
    refresh,
    refreshMemberDecks,
    loadMoreMatches,
    refreshMatches,
    createMatch,
    updateGroup,
    updateMatch,
    kickMember,
    deleteArena,
    leaveArena,
    deleteMatch,
    addGuest,
    addGuestDeck,
    removeGuest,
  };
}
