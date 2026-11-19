'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeToArenaCatalogBatch } from '@/lib/arena-catalog-realtime';
import { supabase } from '@/lib/supabase';
import { fetchArenaMemberDecks } from '@/lib/arena-catalog-read';
import { runWhenIdle } from '@/lib/idle-work';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import type { Deck, Group, Profile } from '@/lib/types/arena-catalog';
import type { ArenaGuest } from '@/lib/arena-participants';

type Context = { key: string | null };
type Resource = 'group' | 'guests' | 'decks';
type State = {
  group: Group | null; members: Profile[]; guests: ArenaGuest[]; decks: Deck[];
  deckColorOverrides: Record<string, string[]>;
  loading: boolean; decksLoading: boolean; catalogError: boolean; guestsError: boolean; decksError: boolean;
};
type Owner = { context: Context; reads: Map<Resource, AbortController>; cancelIdle?: () => void };
const EMPTY: State = { group: null, members: [], guests: [], decks: [], deckColorOverrides: {},
  loading: true, decksLoading: false, catalogError: false, guestsError: false, decksError: false };
const GUEST_COLUMNS = `id,group_id,display_name,last_played_at,
  arena_guest_decks(id,guest_id,group_id,name,commander,commander_image,color_identity,bracket,created_at)`;

/** The committed account/group/role owns catalog reads, snapshots and deferred loading.
 * Mutations and metadata enrichment remain separate command owners. */
export function useArenaCatalog(userId: string | null, groupId: string, adminMode: boolean) {
  const router = useRouter();
  const key = userId && groupId ? `${userId}:${groupId}:${adminMode}` : null;
  const context = useMemo<Context>(() => ({ key }), [key]);
  const ownerRef = useRef<Owner | null>(null);
  const connectionRef = useRef<{ context: Context; status: 'connecting' | 'ready' | 'failed'; restart: () => void } | null>(null);
  const memberIdsRef = useRef<string[]>([]);
  const [state, setState] = useState<{ context: Context; data: State } | null>(null);
  useLayoutEffect(() => {
    const owner: Owner = { context, reads: new Map() };
    ownerRef.current = owner;
    return () => {
      owner.cancelIdle?.();
      owner.reads.forEach(controller => controller.abort());
      if (ownerRef.current === owner) ownerRef.current = null;
    };
  }, [context]);
  const update = useCallback((change: (data: State) => State) => {
    if (ownerRef.current?.context !== context) return;
    setState(current => ownerRef.current?.context === context
      ? { context, data: change(current?.context === context ? current.data : EMPTY) } : current);
  }, [context]);
  const setField = useCallback(<K extends keyof State>(field: K, action: SetStateAction<State[K]>) => {
    update(data => ({ ...data, [field]: typeof action === 'function'
      ? (action as (value: State[K]) => State[K])(data[field]) : action }));
  }, [update]);
  const setGroup = useCallback((action: SetStateAction<Group | null>) => setField('group', action), [setField]);
  const setMembers = useCallback((action: SetStateAction<Profile[]>) => setField('members', action), [setField]);
  const setDecks = useCallback((action: SetStateAction<Deck[]>) => setField('decks', action), [setField]);
  const updateDeckColors = useCallback((action: (colors: Record<string, string[]>, decks: Deck[]) => Record<string, string[]>) => {
    update(data => ({ ...data, deckColorOverrides: action(data.deckColorOverrides, data.decks) }));
  }, [update]);
  const begin = useCallback((resource: Resource) => {
    const owner = ownerRef.current;
    if (!context.key || owner?.context !== context) return null;
    owner.reads.get(resource)?.abort();
    const controller = new AbortController();
    owner.reads.set(resource, controller);
    const active = () => ownerRef.current === owner && owner.reads.get(resource) === controller && !controller.signal.aborted;
    // A replaced read may already have queued a React update: check inside it too.
    const commit = (change: (data: State) => State) => update(data => active() ? change(data) : data);
    return { owner, signal: controller.signal, active, commit };
  }, [context, update]);
  const loadArenaDecks = useCallback(async (memberIds: string[]) => {
    const job = begin('decks');
    if (!job) return;
    job.owner.cancelIdle?.();
    job.commit(data => ({ ...data, decksLoading: true, decksError: false }));
    try {
      const decks = await withRequestDeadline({ abortSignal: signal => fetchArenaMemberDecks(groupId, memberIds, signal) }, 15000, job.signal);
      job.commit(data => {
        const deckColorOverrides = { ...data.deckColorOverrides };
        decks.forEach(deck => { if (deck.color_identity?.length) deckColorOverrides[deck.id] = deck.color_identity; });
        return { ...data, decks, deckColorOverrides };
      });
    } catch {
      job.commit(data => ({ ...data, decksError: true }));
    } finally { job.commit(data => ({ ...data, decksLoading: false })); }
  }, [begin, groupId]);
  const reloadGuests = useCallback(async () => {
    const job = begin('guests');
    if (!job) return;
    try {
      const { data, error } = await withRequestDeadline({ abortSignal: signal => supabase.from('arena_guests')
        .select(GUEST_COLUMNS).eq('group_id', groupId)
        .order('last_played_at', { ascending: false, nullsFirst: false }).abortSignal(signal) }, 15000, job.signal);
      if (error) throw error;
      const guests = (data ?? []) as ArenaGuest[];
      job.commit(current => {
        const deckColorOverrides = { ...current.deckColorOverrides };
        guests.forEach(guest => guest.arena_guest_decks?.forEach(deck => {
          if (deck.color_identity?.length) deckColorOverrides[deck.id] = deck.color_identity;
        }));
        return { ...current, guests, guestsError: false, deckColorOverrides };
      });
    } catch { job.commit(data => ({ ...data, guestsError: true })); }
  }, [begin, groupId]);
  const fetchData = useCallback(async () => {
    const connection = connectionRef.current;
    if (connection?.context === context && connection.status === 'failed') connection.restart();
    const job = begin('group');
    if (!job) return;
    job.owner.cancelIdle?.();
    // Superseded membership must not leave an earlier deck read in flight.
    job.owner.reads.get('decks')?.abort();
    job.commit(data => ({ ...data, catalogError: false, decksLoading: false }));
    try {
      const [{ data, error }] = await Promise.all([
        withRequestDeadline({ abortSignal: signal => supabase.from('groups')
          .select('*,profiles:created_by(id,username,display_name),group_members(user_id,profiles(id,username,display_name))')
          .eq('id', groupId).abortSignal(signal).maybeSingle() }, 15000, job.signal),
        reloadGuests(),
      ]);
      if (!job.active()) return;
      if (error) throw error;
      if (!data) { router.push('/dashboard'); return; }
      const group = data as unknown as Group;
      job.commit(current => ({ ...current, group, members: group.group_members.map(member => member.profiles) }));
      job.owner.cancelIdle = runWhenIdle(async () => {
        if (job.active()) await loadArenaDecks(group.group_members.map(member => member.user_id));
      }, { timeoutMs: 2500 });
    } catch { job.commit(data => ({ ...data, catalogError: true })); }
    finally { job.commit(data => ({ ...data, loading: false })); }
  }, [begin, context, groupId, loadArenaDecks, reloadGuests, router]);
  const current = state?.context === context ? state.data : EMPTY;
  useLayoutEffect(() => { memberIdsRef.current = current.members.map(member => member.id); }, [context, current.members]);
  useEffect(() => {
    if (!context.key) return;
    let disposed = false;
    let disconnect = () => {};
    const connection = { context, status: 'connecting' as 'connecting' | 'ready' | 'failed', restart: () => {} };
    const active = () => !disposed && ownerRef.current?.context === context;
    const start = () => {
      if (!active()) return;
      connection.status = 'connecting';
      disconnect = subscribeToArenaCatalogBatch(supabase, groupId, events => {
        if (!active()) return;
        if (events.some(event => event.entity === 'member')) { void fetchData(); return; }
        if (events.some(event => event.entity === 'deck')) void loadArenaDecks(memberIdsRef.current);
        if (events.some(event => event.entity === 'guest' || event.entity === 'guest_deck')) void reloadGuests();
      }, { scopeKey: context.key ?? '', onReady: () => {
        if (!active()) return;
        connection.status = 'ready'; void fetchData();
      }, onError: () => { if (active()) connection.status = 'failed'; } });
    };
    connection.restart = () => { disconnect(); start(); };
    connectionRef.current = connection; start();
    const recover = () => { if (document.visibilityState === 'visible' && active()) void fetchData(); };
    window.addEventListener('focus', recover); window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      disposed = true; disconnect();
      window.removeEventListener('focus', recover); window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', recover);
      if (connectionRef.current === connection) connectionRef.current = null;
    };
  }, [context, fetchData, groupId, loadArenaDecks, reloadGuests]);
  const ensureArenaMemberDecksLoaded = useCallback(() => {
    if (current.decksLoading || current.decks.length || !current.members.length) return;
    void loadArenaDecks(current.members.map(member => member.id));
  }, [current.decksLoading, current.decks.length, current.members, loadArenaDecks]);
  return { ...current, setGroup, setMembers, setDecks, updateDeckColors,
    fetchData, reloadGuests, loadArenaDecks, ensureArenaMemberDecksLoaded };
}
