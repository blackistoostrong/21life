import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { useLiveGameCommandScope } from './use-live-game-command-scope';
import type { useLanguage } from '@/contexts/language-context';
import type { ArenaProfile } from '@/lib/types/arena';
import type { ParticipantKey } from '@/lib/participant-keys';
import { ArenaSyncError, syncAndRefreshArenaMember } from '@/lib/arena-archidekt-sync';
type Args = { groupId: string; currentUserId: string | undefined;
 members: readonly Pick<ArenaProfile, 'id' | 'archidekt_auto_import'>[];
 refreshMemberDecks: (userId: string) => Promise<boolean | void>;
 copy: ReturnType<typeof useLanguage>['copy']; language: ReturnType<typeof useLanguage>['language'];
 scope: Pick<ReturnType<typeof useLiveGameCommandScope>, 'epoch' | 'isCurrent' | 'bindClient'>; };
/** Owns native live setup member-import progress and confirmed-save refresh retry. */
export function useLiveSetupMemberSync({groupId,currentUserId,members,refreshMemberDecks,copy,language,
 scope: {epoch,isCurrent,bindClient}}: Args) {
  const [archidektSyncRequest, setArchidektSyncRequest] = useState<{
    userId: string;
    status: 'syncing' | 'completed' | 'partial' | 'failed' | 'refresh_failed' | 'limited' | 'empty';
    message?: string;
    wasPartial?: boolean;
    wasEmpty?: boolean;
    requestId?: string;
    skipped?: number;
  } | null>(null);
  const pending = useRef<{target:string;controller:AbortController}|null>(null);
  const cancel = useCallback(() => {
    const previous=pending.current;pending.current=null;previous?.controller.abort();
  },[]);
  useLayoutEffect(()=>{cancel();setArchidektSyncRequest(null);return cancel;},[epoch,cancel]);
  const begin = useCallback((target:string)=>{
    if(!isCurrent() || pending.current?.target===target)return null;
    cancel();const job={target,controller:new AbortController()};pending.current=job;
    return {job,active:()=>isCurrent()&&pending.current===job&&!job.controller.signal.aborted,
      release:()=>{if(pending.current===job)pending.current=null;}};
  },[cancel,isCurrent]);
  const handleSelectSetupParticipant = useCallback((participantKey: ParticipantKey) => {
    if(!isCurrent())return;
    const targetUserId = participantKey.startsWith('user:')
      ? participantKey.slice('user:'.length)
      : null;
    if (!groupId || !currentUserId || !targetUserId
      || !members.some((member) => member.id === targetUserId && member.archidekt_auto_import)) {
      cancel();
      setArchidektSyncRequest(null);
      return;
    }
    const command=begin(targetUserId);if(!command)return;
    setArchidektSyncRequest({ userId: targetUserId, status: 'syncing' });
    void (async () => {
      try {
        const outcome = await syncAndRefreshArenaMember(groupId, targetUserId, refreshMemberDecks, currentUserId,
          {accessToken:bindClient().accessToken,signal:command.job.controller.signal});
        if (command.active()) setArchidektSyncRequest({
          userId: targetUserId,
          ...outcome,
          ...(outcome.status === 'partial' ? { message: language === 'it' ? `Sincronizzazione parziale: ${outcome.skipped} ${outcome.skipped === 1 ? 'mazzo non aggiornato' : 'mazzi non aggiornati'}. Riprova.` : `Partial sync: ${outcome.skipped} ${outcome.skipped === 1 ? 'deck was' : 'decks were'} not updated. Retry.` } : {}),
          ...(outcome.status === 'refresh_failed' ? { message: copy('liveGameArchidektSyncRefreshFailed') + (outcome.requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${outcome.requestId}` : '') } : {}),
        });
      } catch (error) {
        const reason = error instanceof ArenaSyncError ? error.reason : 'uncertain';
        const message = reason === 'authentication' ? copy('liveGameArchidektSyncAuth')
          : reason === 'permission' ? copy('liveGameArchidektSyncPermission')
            : reason === 'configuration' ? copy('liveGameArchidektSyncConfiguration')
              : reason === 'rate_limit' ? copy('liveGameArchidektSyncRateLimit')
                : reason === 'upstream' ? copy('liveGameArchidektSyncUpstream')
                  : reason === 'upstream_timeout' ? copy('liveGameArchidektSyncUpstreamTimeout')
                  : reason === 'save' ? copy('liveGameArchidektSyncSave')
                    : copy('liveGameArchidektSyncUncertain');
        if (command.active()) {
          const reference = error instanceof ArenaSyncError && error.requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${error.requestId}` : '';
          setArchidektSyncRequest({ userId: targetUserId, status: 'failed', message: message + reference });
        }
      } finally {command.release();}
    })();
  }, [begin,bindClient,cancel,copy,currentUserId,groupId,isCurrent,language,members,refreshMemberDecks]);
  const handleRetryArchidektSync = useCallback((participantKey: ParticipantKey) => {
    if(!isCurrent())return;
    const target = participantKey.startsWith('user:') ? participantKey.slice('user:'.length) : null;
    if(pending.current?.target===target)return;
    if (!target || archidektSyncRequest?.userId !== target || archidektSyncRequest.status !== 'refresh_failed') {
      handleSelectSetupParticipant(participantKey);
      return;
    }
    const command=begin(target);if(!command)return;
    const partial = archidektSyncRequest.wasPartial;
    const empty = archidektSyncRequest.wasEmpty;
    const requestId = archidektSyncRequest.requestId;
    const skipped = archidektSyncRequest.skipped;
    setArchidektSyncRequest({ userId: target, status: 'syncing' });
    void refreshMemberDecks(target).then((limited) => {
      if (command.active()) setArchidektSyncRequest({ userId: target, skipped, requestId, status: partial ? 'partial' : limited ? 'limited' : empty ? 'empty' : 'completed', ...(partial ? { message: language === 'it' ? `Sincronizzazione parziale: ${skipped} ${skipped === 1 ? 'mazzo non aggiornato' : 'mazzi non aggiornati'}. Riprova.` : `Partial sync: ${skipped} ${skipped === 1 ? 'deck was' : 'decks were'} not updated. Retry.` } : {}) });
    }).catch(() => {
      if (command.active()) setArchidektSyncRequest({ userId: target, status: 'refresh_failed', wasPartial: partial, wasEmpty: empty, skipped, requestId, message: copy('liveGameArchidektSyncRefreshFailed') + (requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${requestId}` : '') });
    }).finally(command.release);
  }, [archidektSyncRequest,begin,copy,handleSelectSetupParticipant,isCurrent,language,refreshMemberDecks]);
 return {archidektSyncRequest,handleSelectSetupParticipant,handleRetryArchidektSync};
}
