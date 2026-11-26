'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { subscribeToArenaCatalog } from '@/lib/arena-catalog-realtime';
import { readWebLiveCatalog, type WebLiveCatalogResult } from '@/lib/web-live-catalog-read';
import { withRequestDeadline } from '@/packages/data/request-deadline';
import { useCommandScope } from '@/hooks/use-command-scope';
type Result = WebLiveCatalogResult | {
    kind: 'loading' | 'error';
};
/** Private reads belong to one committed account/group, independent of JWT renewal. */
export function useWebLiveCatalog(groupId: string, userId: string | null) {
    const router = useRouter();
    const { context, begin, committed } = useCommandScope<'catalog'>(userId && groupId ? `${userId}:${groupId}` : null, Boolean(userId && groupId));
    const [snapshot, setSnapshot] = useState<{
        context: typeof context;
        result: Result;
    } | null>(null);
    const result: Result = snapshot?.context === context ? snapshot.result : { kind: 'loading' };
    const load = useCallback(async () => {
        if (!userId || !groupId)
            return;
        const job = begin('catalog');
        if (!job)
            return;
        const publish = (next: Result) => {
            if (!job.active())
                return;
            setSnapshot(previous => {
                if (!job.active())
                    return previous;
                // Background failures must never unmount or eject a running game.
                if (next.kind !== 'ready' && previous?.context === context && previous.result.kind === 'ready')
                    return previous;
                return { context, result: next };
            });
        };
        publish({ kind: 'loading' });
        try {
            publish(await withRequestDeadline({ abortSignal: signal => readWebLiveCatalog(supabase, groupId, userId, signal) }, 15000, job.signal));
        }
        catch {
            publish({ kind: 'error' });
        }
        finally {
            job.finish();
        }
    }, [begin, context, groupId, userId]);
    useEffect(() => { void load(); }, [load]);
    useEffect(() => {
        if (!userId || !groupId)
            return;
        return subscribeToArenaCatalog(supabase, groupId, () => {
            if (committed())
                void load();
        }, { scopeKey: context.key ?? '' });
    }, [committed, context, groupId, load, userId]);
    useEffect(() => {
        if (result.kind === 'denied' && committed())
            router.replace(`/table/${groupId}`);
    }, [committed, groupId, result.kind, router]);
    return {
        loading: result.kind === 'loading' || result.kind === 'denied',
        loadError: result.kind === 'error' || result.kind === 'missing',
        arenaName: result.kind === 'ready' ? result.arenaName : '',
        participants: result.kind === 'ready' ? result.participants : [],
        load,
    };
}
