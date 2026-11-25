import { useCallback, useRef, useState } from 'react';
import type { useLanguage } from '@/contexts/language-context';
import type { ArenaProfile } from '@/lib/types/arena';
import type { ParticipantKey } from '@/lib/participant-keys';
import { ArenaSyncError, syncAndRefreshArenaMember } from '@/lib/arena-archidekt-sync';
type Args = { groupId: string; currentUserId: string | undefined;
 members: readonly Pick<ArenaProfile, 'id' | 'archidekt_auto_import'>[];
 refreshMemberDecks: (userId: string) => Promise<boolean | void>;
 copy: ReturnType<typeof useLanguage>['copy']; language: ReturnType<typeof useLanguage>['language']; };
/** Owns native live setup member-import progress and confirmed-save refresh retry. */
export function useLiveSetupMemberSync({groupId,currentUserId,members,refreshMemberDecks,copy,language}: Args) {
  const [archidektSyncRequest, setArchidektSyncRequest] = useState<{
    userId: string;
    status: 'syncing' | 'completed' | 'partial' | 'failed' | 'refresh_failed' | 'limited' | 'empty';
    message?: string;
    wasPartial?: boolean;
    wasEmpty?: boolean;
    requestId?: string;
    skipped?: number;
  } | null>(null);
  const archidektSyncGeneration = useRef(0);
  const handleSelectSetupParticipant = useCallback((participantKey: ParticipantKey) => {
    const generation = ++archidektSyncGeneration.current;
    const targetUserId = participantKey.startsWith('user:')
      ? participantKey.slice('user:'.length)
      : null;
    if (!groupId || !currentUserId || !targetUserId
      || !members.some((member) => member.id === targetUserId && member.archidekt_auto_import)) {
      setArchidektSyncRequest(null);
      return;
    }
    setArchidektSyncRequest({ userId: targetUserId, status: 'syncing' });
    void (async () => {
      try {
        const outcome = await syncAndRefreshArenaMember(groupId, targetUserId, refreshMemberDecks, currentUserId);
        if (generation === archidektSyncGeneration.current) setArchidektSyncRequest({
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
        if (generation === archidektSyncGeneration.current) {
          const reference = error instanceof ArenaSyncError && error.requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${error.requestId}` : '';
          setArchidektSyncRequest({ userId: targetUserId, status: 'failed', message: message + reference });
        }
      }
    })();
  }, [copy, currentUserId, groupId, language, members, refreshMemberDecks]);
  const handleRetryArchidektSync = useCallback((participantKey: ParticipantKey) => {
    const target = participantKey.startsWith('user:') ? participantKey.slice('user:'.length) : null;
    if (!target || archidektSyncRequest?.userId !== target || archidektSyncRequest.status !== 'refresh_failed') {
      handleSelectSetupParticipant(participantKey);
      return;
    }
    const generation = ++archidektSyncGeneration.current;
    const partial = archidektSyncRequest.wasPartial;
    const empty = archidektSyncRequest.wasEmpty;
    const requestId = archidektSyncRequest.requestId;
    const skipped = archidektSyncRequest.skipped;
    setArchidektSyncRequest({ userId: target, status: 'syncing' });
    void refreshMemberDecks(target).then((limited) => {
      if (generation === archidektSyncGeneration.current) setArchidektSyncRequest({ userId: target, status: partial ? 'partial' : limited ? 'limited' : empty ? 'empty' : 'completed', ...(partial ? { message: language === 'it' ? `Sincronizzazione parziale: ${skipped} ${skipped === 1 ? 'mazzo non aggiornato' : 'mazzi non aggiornati'}. Riprova.` : `Partial sync: ${skipped} ${skipped === 1 ? 'deck was' : 'decks were'} not updated. Retry.` } : {}) });
    }).catch(() => {
      if (generation === archidektSyncGeneration.current) setArchidektSyncRequest({ userId: target, status: 'refresh_failed', wasPartial: partial, wasEmpty: empty, skipped, requestId, message: copy('liveGameArchidektSyncRefreshFailed') + (requestId ? `\n${language === 'it' ? 'Riferimento' : 'Reference'}: ${requestId}` : '') });
    });
  }, [archidektSyncRequest, copy, handleSelectSetupParticipant, language, refreshMemberDecks]);
 return {archidektSyncRequest,handleSelectSetupParticipant,handleRetryArchidektSync};
}
