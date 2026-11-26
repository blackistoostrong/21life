import { NativeLiveRoundResultDialog } from '@/components/live-game/native-live-round-result-dialog';
import { nativeLiveScreenStyles as styles } from '@/components/live-game/native-live-screen-styles';
import { SetupRestoreGate } from '@/components/live-game/setup-restore-gate';
import { useLiveGameCommandScope } from '@/hooks/use-live-game-command-scope';
import { useLiveSetupMemberSync } from '@/hooks/use-live-setup-member-sync';
import { useNativeLiveRoundCommands,type NativeRoundPresentationEvent } from '@/hooks/use-native-live-round-commands';
import { useNativeLiveSession } from '@/hooks/use-native-live-session';
import { useNativeLiveSetup } from '@/hooks/use-native-live-setup';
import { useFocusEffect,useLocalSearchParams,useRouter } from 'expo-router';


import { LiveGameConfigurator } from '@/components/live-game/live-game-configurator';
import { LiveGameRecapView } from '@/components/live-game/live-game-recap';
import { LiveGameRecoveryPanel } from '@/components/live-game/recovery-panel';
import { TableArena } from '@/components/live-game/table-arena';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Modal } from '@/components/ui/modal';
import { ModalHeader } from '@/components/ui/modal-header';
import { PhyrexianPanel } from '@/components/ui/phyrexian-panel';
import { Screen } from '@/components/ui/screen';
import { ArenaSkeleton } from '@/components/ui/screen-skeletons';
import { colors } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import { useRuntimeConfig } from '@/contexts/runtime-config-context';
import { useArena } from '@/hooks/use-arena';
import { useScreenInsets } from '@/hooks/use-screen-insets';
import { hapticLight,hapticMedium,hapticSuccess,hapticWarning } from '@/lib/haptics';
import { Ionicons } from '@expo/vector-icons';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { Platform,Pressable,ScrollView,Text,View } from 'react-native';

import {
getDefaultWinCondition,
getLiveGameResultWarnings,
getSuggestedWinner,
pickRandomPlayer,
type DamageMode,
type LiveGameMutation,
type LiveGamePlayer,
type LiveGameRecord,
type LiveGameState,
type WinCondition
} from '@/lib/live-game';
import { formatGameDuration,getGameDurationSeconds } from '@/lib/live-game-duration';
import {
applyLiveGameImmersive,
clearLiveGameImmersive,
} from '@/lib/live-game-immersive';
import { getDiscardConfirmationVisibility } from '@/lib/live-game-modal-state';
import {
applyLiveGameOrientationLock,
clearLiveGameOrientationLock,
} from '@/lib/live-game-orientation';
import { buildRouletteSequence } from '@/lib/live-game-roulette';
import { countLiveGamePendingOperations,getLiveGameSyncCopy,getLiveGameSyncIndicator,getLiveGameSyncState } from '@/lib/live-game-sync-presentation';
import { type ParticipantKey } from '@/lib/participant-keys';

export default function LiveGameScreen() {
  useKeepAwake();
  const { id } = useLocalSearchParams<{ id: string }>();
  const groupId = Array.isArray(id) ? id[0] : id;
  const router = useRouter();
  const { user, session } = useAuth();
  const currentUserId = user?.id;
  const { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient, beginCommand: beginLiveCommand } =
    useLiveGameCommandScope(currentUserId, groupId, session);
  const { copy, language } = useLanguage();
  const { featureFlags } = useRuntimeConfig();
  const { scrollContentStyle } = useScreenInsets();

  const { members, guests, decks, matches, loading, group, refreshMemberDecks } = useArena(groupId, user?.id);

  const liveSetup=useNativeLiveSetup(groupId, user, { members, guests, decks, matches, loading },
    { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient });
const {playerCount, layoutVariant, setLayoutVariant, seatSetups, setupReadyKey, setupRestoreError, setSetupRetry, startingLife, setOccasionalDecks, setupParticipants, applyStartingLife, handlePlayerCountChange, handleAssignSeat, resetSetup}=liveSetup;

  const {archidektSyncRequest,handleSelectSetupParticipant,handleRetryArchidektSync} = useLiveSetupMemberSync({
    groupId,currentUserId,members,refreshMemberDecks,copy,language,
    scope:{epoch:liveScopeEpoch,isCurrent:isLiveScopeCurrent,bindClient:bindLiveClient}});
  const [damagePulse, setDamagePulse] = useState<Record<string, number>>({});
  const [randomHighlight, setRandomHighlight] = useState<ParticipantKey | null>(null);
  const [startingHighlight, setStartingHighlight] = useState<ParticipantKey | null>(null);
  const [pendingEliminate, setPendingEliminate] = useState<ParticipantKey | null>(null);
  const [showEndGame, setShowEndGame] = useState(false);
  const [endWinnerKey, setEndWinnerKey] = useState<ParticipantKey | ''>('');
  const [endIsDraw, setEndIsDraw] = useState(false);
  const [endWinCondition, setEndWinCondition] = useState<WinCondition | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showExitChoice, setShowExitChoice] = useState(false);
  const [showRematch, setShowRematch] = useState(false);
  const [completedGame, setCompletedGame] = useState<LiveGameRecord | null>(null);
  const [completedDurationSeconds, setCompletedDurationSeconds] = useState(0);
  const [showClearRecoveryConfirm, setShowClearRecoveryConfirm] = useState(false);
  const rouletteTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousActivePlayerCountRef = useRef<number | null>(null);
  const onRemoteCompleted=useCallback((remote:LiveGameRecord)=>{
 setCompletedGame(remote);setCompletedDurationSeconds(getGameDurationSeconds(remote.started_at,remote.ended_at??new Date().toISOString()));
 setShowEndGame(false);setShowRematch(true);
},[setCompletedGame,setCompletedDurationSeconds,setShowEndGame,setShowRematch]);
const liveSession=useNativeLiveSession({groupId,currentUserId,hasCompletedGame:Boolean(completedGame),setSetupRetry,onRemoteCompleted,
 scope:{epoch:liveScopeEpoch,isCurrent:isLiveScopeCurrent,bindClient:bindLiveClient}});
const {journal, liveGame, undoDepth, redoDepth, pendingSyncCount, localPersistenceAvailable, booting, syncStatus, syncError, authenticationRequired, networkOnline, recoveryCount, archivedPendingCount, syncJournal, enqueueMutation, handleUndo, handleRedo, discardRecovery, discardingRecovery}=liveSession;


  const openEndGameModal = useCallback((state: LiveGameState) => {
    const suggested = getSuggestedWinner(state);
    setEndWinnerKey(suggested?.participantKey || '');
    setEndIsDraw(false);
    setEndWinCondition(getDefaultWinCondition(state));
    setShowEndGame(true);
  }, [setEndWinnerKey, setEndIsDraw, setEndWinCondition, setShowEndGame]);

  const openDiscardConfirm = useCallback(() => {
    // React Native must never keep two native modals stacked here. The flag
    // flow used to leave the end-game modal mounted below the confirmation,
    // trapping all touches on iOS after the destructive action.
    const next = getDiscardConfirmationVisibility();
    setShowExitChoice(next.showExitChoice);
    setShowEndGame(next.showEndGame);
    setShowDiscardConfirm(next.showDiscardConfirm);
  }, [setShowExitChoice, setShowEndGame, setShowDiscardConfirm]);

  useEffect(() => {
    if (!liveGame) {
      previousActivePlayerCountRef.current = null;
      return;
    }

    const activePlayerCount = liveGame.state.players.filter((player) => !player.isEliminated).length;
    const previousActivePlayerCount = previousActivePlayerCountRef.current;
    previousActivePlayerCountRef.current = activePlayerCount;

    if (previousActivePlayerCount !== null && previousActivePlayerCount > 1 && activePlayerCount === 1) {
      openEndGameModal(liveGame.state);
    }
  }, [liveGame, openEndGameModal]);

  useLayoutEffect(() => {
    setShowEndGame(false); setShowRematch(false); setCompletedGame(null);
    setShowDiscardConfirm(false); setShowExitChoice(false); setShowClearRecoveryConfirm(false);
    setEndWinnerKey(''); setEndIsDraw(false); setEndWinCondition(null);

    setPendingEliminate(null); setDamagePulse({}); setRandomHighlight(null); setStartingHighlight(null);
    rouletteTimersRef.current.forEach(clearTimeout); rouletteTimersRef.current = [];
  }, [liveScopeEpoch]);

  const liveGameId = liveGame?.id ?? null;
  const liveGamePlayerCount = liveGame?.state.players.length ?? 0;

  useEffect(() => {
    if (!liveGameId) {
      void clearLiveGameOrientationLock();
      return undefined;
    }

    void applyLiveGameOrientationLock(liveGamePlayerCount, {
      platform: Platform.OS,
      isPad: Platform.OS === 'ios' && Platform.isPad,
    });
    return () => {
      void clearLiveGameOrientationLock();
    };
  }, [liveGameId, liveGamePlayerCount]);

  useEffect(() => {
    if (!liveGameId) {
      clearLiveGameImmersive();
      return undefined;
    }

    applyLiveGameImmersive();
    return () => {
      clearLiveGameImmersive();
    };
  }, [liveGameId]);

  useFocusEffect(
    useCallback(() => {
      if (liveGameId) {
        void applyLiveGameOrientationLock(liveGamePlayerCount, {
          platform: Platform.OS,
          isPad: Platform.OS === 'ios' && Platform.isPad,
        });
        applyLiveGameImmersive();
      }
      return () => {
        void clearLiveGameOrientationLock();
        clearLiveGameImmersive();
      };
    }, [liveGameId, liveGamePlayerCount]),
  );

  const pulseDamage = useCallback((key: ParticipantKey) => {
    setDamagePulse((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
  }, [setDamagePulse]);

  const clearRouletteTimers = useCallback(() => {
    rouletteTimersRef.current.forEach(clearTimeout);
    rouletteTimersRef.current = [];
  }, []);

  useEffect(() => clearRouletteTimers, [clearRouletteTimers]);

  const runRoulette = useCallback((
    pool: ParticipantKey[],
    winner: ParticipantKey,
    tone: 'random' | 'starting',
  ) => {
    clearRouletteTimers();
    setRandomHighlight(null);
    setStartingHighlight(null);
    const sequence = buildRouletteSequence(pool, winner);
    const setHighlight = tone === 'starting' ? setStartingHighlight : setRandomHighlight;
    sequence.forEach((key, index) => {
      rouletteTimersRef.current.push(setTimeout(() => {
        setHighlight(key);
        if (index === sequence.length - 1) void hapticSuccess();
      }, index * 120));
    });
    rouletteTimersRef.current.push(setTimeout(() => {
      setHighlight(null);
      rouletteTimersRef.current = [];
    }, (sequence.length - 1) * 120 + 4200));
  }, [clearRouletteTimers, setRandomHighlight, setStartingHighlight]);

  const revealStartingPlayer = useCallback((key: ParticipantKey | null, pool: ParticipantKey[]) => {
    if (!key) return;
    runRoulette(pool, key, 'starting');
  }, [runRoulette]);
 const onRoundEvent=useCallback((event:NativeRoundPresentationEvent)=>{
  if(event.type==='finalizing'){setCompletedGame(event.record);setCompletedDurationSeconds(event.durationSeconds);}
  else if(event.type==='completed')setShowRematch(true);
  else if(event.type==='rematch-prepared')setShowRematch(false);
  else{setShowEndGame(false);if(event.type==='discard-finished')setShowDiscardConfirm(false);}
 },[setCompletedGame,setCompletedDurationSeconds,setShowRematch,setShowEndGame,setShowDiscardConfirm]);
 const {starting,endingGame,discardingGame,handleStart,handleDiscardGame,handleEndGame,handleRematchSameDecks,handleRematchReselect}
  =useNativeLiveRoundCommands({groupId,user,completedGame,setup:liveSetup,session:liveSession,catalog:{members,guests},
   scope:{epoch:liveScopeEpoch,isCurrent:isLiveScopeCurrent,bindClient:bindLiveClient,beginCommand:beginLiveCommand},
   result:{isDraw:endIsDraw,winnerKey:endWinnerKey,winCondition:endWinCondition},presentation:{onEvent:onRoundEvent,pulseDamage,revealStartingPlayer}});


  const handleAdjust = (playerKey: ParticipantKey, delta: number) => {
    if (delta < 0) {
      pulseDamage(playerKey);
      void (Math.abs(delta) >= 10 ? hapticMedium() : hapticLight());
    }
    const mutation: LiveGameMutation = {
      type: 'adjust',
      targetKey: playerKey,
      // UI deltas describe the life-total change, while positive mutations describe damage.
      amount: -delta,
      mode: 'life',
    };
    const player = journal.getSnapshot().record?.state.players.find(
      (entry) => entry.participantKey === playerKey,
    );
    enqueueMutation(mutation, player ? { type: 'restore-player', player } : undefined);
  };

  const handleApplyDragDamage = (input: {
    sourceKey: ParticipantKey;
    targetKey: ParticipantKey;
    amount: number;
    mode: DamageMode;
    scope: 'single' | import('@/lib/live-game').GroupDamageScope;
    drain: boolean;
  }) => {
    if (input.sourceKey === input.targetKey || input.amount <= 0) return;
    const effectiveScope = input.drain && input.scope === 'all_players' ? 'opponents' : input.scope;
    if (effectiveScope !== 'single' && input.mode !== 'commander') {
      const targets = journal.getSnapshot().record?.state.players
        .filter((player) => !player.isEliminated && (effectiveScope === 'all_players' || player.participantKey !== input.sourceKey)) ?? [];
      targets.forEach((player) => pulseDamage(player.participantKey));
      const drainAmount = input.drain ? input.amount * targets.length : undefined;
      enqueueMutation({
        type: 'adjust_many',
        sourceKey: input.sourceKey,
        amount: input.amount,
        scope: effectiveScope,
        mode: input.mode,
        drain: input.drain,
        drainAmount,
      }, {
        type: 'adjust_many',
        sourceKey: input.sourceKey,
        amount: -input.amount,
        scope: effectiveScope,
        mode: input.mode,
        drain: input.drain,
        drainAmount,
      });
    } else {
      pulseDamage(input.targetKey);
      const mutation: LiveGameMutation = {
        type: 'adjust',
        targetKey: input.targetKey,
        amount: input.amount,
        mode: input.mode,
        sourceKey: input.sourceKey,
        drain: input.drain,
        drainAmount: input.drain ? input.amount : undefined,
      };
      const player = journal.getSnapshot().record?.state.players.find(
        (entry) => entry.participantKey === input.targetKey,
      );
      enqueueMutation(mutation, input.drain
        ? {
          type: 'adjust',
          targetKey: input.targetKey,
          sourceKey: input.sourceKey,
          amount: -input.amount,
          mode: input.mode,
          drain: true,
          drainAmount: input.amount,
        }
        : player ? { type: 'restore-player', player } : undefined);
    }
    hapticSuccess();
  };

  const runRandomPick = (pool?: ParticipantKey[]) => {
    if (!liveGame) return;
    const picked = pickRandomPlayer(liveGame.state, pool);
    if (!picked) return;
    const eligibleKeys = pool?.length
      ? pool
      : liveGame.state.players
        .filter((player) => !player.isEliminated)
        .map((player) => player.participantKey);
    runRoulette(eligibleKeys, picked.participantKey, 'random');
  };

  if (loading || booting) {
    return <ArenaSkeleton contentStyle={scrollContentStyle} />;
  }

  const gameState = liveGame?.state;
  const presentationPendingCount = countLiveGamePendingOperations({ mutations: pendingSyncCount,
    needsCreate: false, finalization: false, cancellation: false,
    archivedOperations: archivedPendingCount,
  });
  const presentationState = getLiveGameSyncState({ pendingOperations: presentationPendingCount,
    online: networkOnline && syncStatus !== 'offline', syncing: syncStatus === 'syncing', localPersistenceAvailable,
    authenticationRequired, hasError: syncError !== null,
  });
  const presentationCopy = getLiveGameSyncCopy(presentationState,language);
  const visibleSyncError = syncError === 'LIVE_GAME_OUTBOX_UNAVAILABLE'
    ? getLiveGameSyncCopy('storage_unavailable', language).label : syncError;
  const activePlayers = (gameState?.players ?? []).filter((player: LiveGamePlayer) => !player.isEliminated);
  const endGameWarnings = gameState ? getLiveGameResultWarnings(gameState, {
    winnerKey: endIsDraw ? null : endWinnerKey || null,
    isDraw: endIsDraw,
    winCondition: endIsDraw ? null : endWinCondition,
  }) : [];
  const requiresAlternativeWinCondition = !endIsDraw && activePlayers.length !== 1;
  const pendingEliminatePlayer = gameState?.players.find(
    (player) => player.participantKey === pendingEliminate,
  );

  if (liveGame) {
    return (
      <View style={styles.immersiveRoot}>
        <StatusBar hidden />
        <TableArena
          players={gameState?.players ?? []}
          startedAt={liveGame.started_at}
          layoutVariant={gameState?.layoutVariant ?? 'classic'}
          randomHighlight={randomHighlight}
          startingPlayerKey={gameState?.startingPlayerKey ?? null}
          startingHighlight={startingHighlight}
          startingDirection={gameState?.startingDirection ?? null}
          damagePulse={damagePulse}
          activePlayers={activePlayers}
          labels={{
            damageLife: copy('liveGameDamageLife'),
            damageCommander: copy('liveGameDamageCommander'),
            damageInfect: copy('liveGameDamageInfect'),
            randomAll: copy('liveGameRandomAll'),
            randomOpponents: copy('liveGameRandomOpponents'),
            selectActivePlayer: copy('liveGameSelectActivePlayer'),
            dragDamage: copy('liveGameDragDamage'),
            dropDamage: copy('liveGameDropDamage'),
            damageConfirmTitle: copy('liveGameDamageConfirmTitle'),
            damageAmount: copy('liveGameDamageAmount'),
            lifeDamage: copy('liveGameLifeDamage'),
            commanderDamage: copy('liveGameCommanderDamage'),
            applyDamage: copy('liveGameApplyDamage'),
            cancel: copy('cancel'),
            commanderDamageMeta: copy('liveGameCommanderDamage'),
            infect: copy('liveGameInfect'),
            eliminated: copy('liveGameEliminated'),
            revive: copy('liveGameRevive'),
            selected: copy('liveGameSelected'),
            ko: copy('liveGameKo'),
            endGame: copy('liveGameEnd'),
            startingPlayer: copy('liveGameStartingPlayer'),
            clockwise: copy('liveGameClockwise'),
            counterclockwise: copy('liveGameCounterclockwise'),
            damageReceived: copy('liveGameDamageReceived'),
            undo: copy('liveGameUndo'),
            redo: copy('liveGameRedo'),
            thisPlayer: copy('liveGameThisPlayer'),
            eachOpponent: copy('liveGameEachOpponent'),
            everyone: copy('liveGameEveryone'),
            drain: copy('liveGameDrain'),
            drainHint: copy('liveGameDrainHint'),
            lifelink: copy('liveGameLifelink'),
            lifelinkHint: copy('liveGameLifelinkHint'),
            dieOrCoin: copy('dieOrCoin'),
            coin: copy('coin'),
            heads: copy('heads'),
            tails: copy('tails'),
          }}
          onBack={() => setShowExitChoice(true)}
          canUndo={undoDepth > 0}
          onUndo={handleUndo}
          canRedo={redoDepth > 0}
          onRedo={handleRedo}
          syncStatus={getLiveGameSyncIndicator(presentationState)}
          syncLabel={presentationCopy.label}
          pendingSyncCount={presentationPendingCount}
          syncError={presentationCopy.hint || (!localPersistenceAvailable ? presentationCopy.label : visibleSyncError)}
          onRetrySync={() => void syncJournal()}
          onEndGame={() => openEndGameModal(liveGame.state)}
          onAdjust={handleAdjust}
          onApplyDragDamage={handleApplyDragDamage}
          onEliminate={setPendingEliminate}
          onRevive={(key) => {
            const player = liveGame.state.players.find((entry) => entry.participantKey === key);
            if (!player) return;
            enqueueMutation(
              { type: 'revive', targetKey: key, startingLife: liveGame.starting_life },
              { type: 'restore-player', player },
            );
          }}
          onPickRandom={runRandomPick}
          onAdjustCounter={(key, counter, amount) => enqueueMutation(
            { type: 'adjust_counter', targetKey: key, counter, amount },
            { type: 'adjust_counter', targetKey: key, counter, amount: -amount },
          )}
          onSetEmblem={(key, emblem, active) => {
            const holderKey = liveGame.state.players.find((player) => player.counters[emblem])?.participantKey ?? null;
            enqueueMutation(
              { type: 'set_emblem', targetKey: key, emblem, active },
              { type: 'restore_emblem', emblem, holderKey },
            );
          }}
        />

        <Modal
          visible={showExitChoice}
          onClose={() => setShowExitChoice(false)}
          presentation="dialog"
          maxWidth={520}
          scroll={false}
        >
          <ModalHeader
            title={copy('liveGameExitTitle')}
            subtitle={copy('liveGameExitHint')}
            icon={null}
            onClose={() => setShowExitChoice(false)}
          />
          <View style={styles.exitChoiceGrid}>
            <Pressable
              style={({ pressed }) => [styles.exitChoice, styles.pauseChoice, pressed && styles.choicePressed]}
              onPress={() => {
                setShowExitChoice(false);
                router.back();
              }}
            >
              <View style={[styles.exitChoiceIcon, styles.pauseChoiceIcon]}>
                <Ionicons name="pause" size={22} color={colors.primaryLight} />
              </View>
              <View style={styles.exitChoiceCopy}>
                <Text style={styles.exitChoiceTitle}>{copy('liveGamePause')}</Text>
                <Text style={styles.exitChoiceHint}>
                  {copy('resumeGameHint')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.exitChoice, styles.discardChoice, pressed && styles.choicePressed]}
              onPress={openDiscardConfirm}
            >
              <View style={[styles.exitChoiceIcon, styles.discardChoiceIcon]}>
                <Ionicons name="trash-outline" size={21} color="#fca5a5" />
              </View>
              <View style={styles.exitChoiceCopy}>
                <Text style={[styles.exitChoiceTitle, styles.discardChoiceTitle]}>{copy('liveGameDiscard')}</Text>
                <Text style={styles.exitChoiceHint}>{copy('liveGameDiscardConfirm')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="rgba(252,165,165,0.72)" />
            </Pressable>
          </View>
        </Modal>

        <ConfirmModal
          visible={Boolean(pendingEliminate)}
          title={copy('liveGameConfirmEliminate')}
          message={pendingEliminatePlayer
            ? `${pendingEliminatePlayer.displayName}\n${copy('liveGameEliminateHint')}`
            : copy('liveGameEliminateHint')}
          icon="skull-outline"
          tone="danger"
          onClose={() => setPendingEliminate(null)}
          actions={[
            { label: copy('cancel'), variant: 'ghost', onPress: () => setPendingEliminate(null) },
            {
              label: copy('liveGameEliminate'),
              variant: 'destructive',
              onPress: () => {
                if (!pendingEliminate) return;
                void hapticWarning();
                const player = liveGame.state.players.find(
                  (entry) => entry.participantKey === pendingEliminate,
                );
                enqueueMutation(
                  {
                    type: 'eliminate',
                    targetKey: pendingEliminate,
                    eliminatedAt: new Date().toISOString(),
                  },
                  player ? { type: 'restore-player', player } : undefined,
                );
                setPendingEliminate(null);
              },
            },
          ]}
        />

        <NativeLiveRoundResultDialog copy={copy} language={language}
 view={{showEndGame,endingGame,discardingGame,endIsDraw,endWinnerKey,endWinCondition,activePlayers,endGameWarnings,requiresAlternativeWinCondition,featureFlags}}
 actions={{setShowEndGame,setEndIsDraw,setEndWinnerKey,setEndWinCondition,handleEndGame,openDiscardConfirm}} />

        <ConfirmModal
          visible={showDiscardConfirm}
          title={copy('liveGameDiscard')}
          message={copy('liveGameDiscardConfirm')}
          icon="trash-outline"
          tone="danger"
          onClose={() => setShowDiscardConfirm(false)}
          actions={[
            { label: copy('cancel'), variant: 'ghost', onPress: () => setShowDiscardConfirm(false) },
            {
              label: discardingGame ? copy('liveGameDiscarding') : copy('liveGameDiscard'),
              variant: 'destructive',
              onPress: handleDiscardGame,
              disabled: discardingGame,
            },
          ]}
        />
      </View>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.topBar}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color={colors.primaryMuted} />
          <Text style={styles.backLabel}>{group?.name || copy('table')}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[scrollContentStyle, styles.content]}>
          {recoveryCount > 0 ? (
            <LiveGameRecoveryPanel count={recoveryCount} language={language} syncing={syncStatus === 'syncing'}
              error={visibleSyncError} onSync={() => void syncJournal()} onDiscard={() => setShowClearRecoveryConfirm(true)} />
          ) : null}
          <PhyrexianPanel style={styles.setupPanel}>
            <Text style={styles.setupTitle}>{copy('liveGameSetupTitle')}</Text>
            <Text style={styles.setupHint}>{copy('liveGameSetupHint')}</Text>

            <SetupRestoreGate ready={setupReadyKey === `${user?.id}:${groupId}`} error={setupRestoreError} language={language} onRetry={() => setSetupRetry(current => current + 1)}>
            <LiveGameConfigurator
              groupId={groupId}
              onOccasionalDeckCreated={deck => setOccasionalDecks(current => [...current.filter(item => item.id !== deck.id), deck])}
              playerCount={playerCount}
              layoutVariant={layoutVariant}
              seats={seatSetups}
              startingLife={startingLife}
              participants={setupParticipants}
              onPlayerCountChange={handlePlayerCountChange}
              onLayoutChange={setLayoutVariant}
              onStartingLifeChange={applyStartingLife}
              onSelectParticipant={handleSelectSetupParticipant}
              onRetryArchidektSync={handleRetryArchidektSync}
              archidektSyncRequest={archidektSyncRequest}
              onAssignSeat={handleAssignSeat}
              onReset={resetSetup}
              onStart={handleStart}
              starting={starting}
              labels={{
                playerCount: copy('liveGamePlayerCount'),
                layout: copy('liveGameLayout'),
                classic: copy('liveGameLayoutClassic'),
                opposed: copy('liveGameLayoutOpposed'),
                seats: copy('liveGameSeats'),
                seat: copy('liveGameSeat'),
                emptySeat: copy('liveGameEmptySeat'),
                choosePlayer: copy('liveGameChoosePlayer'),
                chooseDeck: copy('liveGameChooseDeck'),
                archidektSyncWaiting: copy('liveGameArchidektSyncWaiting'),
                archidektSyncCompleted: copy('liveGameArchidektSyncCompleted'),
                archidektSyncPartial: copy('liveGameArchidektSyncPartial'),
                archidektSyncLimited: copy('liveGameArchidektSyncLimited'),
                archidektSyncEmpty: copy('liveGameArchidektSyncEmpty'),
                archidektSyncRetry: copy('liveGameArchidektSyncRetry'),
                archidektSyncRefreshRetry: copy('liveGameArchidektSyncRefreshRetry'),
                archidektSyncFailed: copy('liveGameArchidektSyncFailed'),
                searchDecks: copy('searchDecks'),
                noDecksMatchSearch: copy('noDecksMatchSearch'),
                clearSeat: copy('liveGameClearSeat'),
                confirm: copy('confirm'),
                reset: copy('liveGameResetSetup'),
                startingLife: copy('liveGameStartingLife'),
                custom: copy('liveGameCustom'),
                back: copy('back'),
                next: copy('next'),
                start: copy('liveGameStart'),
                starting: copy('liveGameStarting'),
              }}
            />

            </SetupRestoreGate>
          </PhyrexianPanel>
      </ScrollView>
      <ConfirmModal
        visible={showClearRecoveryConfirm}
        title={language === 'it' ? 'Scartare i recuperi?' : 'Discard recovery data?'}
        message={language === 'it' ? 'I salvataggi non ancora sincronizzati verranno rimossi definitivamente.' : 'Unsynced saves will be permanently removed.'}
        icon="warning-outline"
        tone="danger"
        onClose={() => { if (!discardingRecovery) setShowClearRecoveryConfirm(false); }}
        actions={[{ label: copy('cancel'), variant: 'ghost', disabled: discardingRecovery, onPress: () => setShowClearRecoveryConfirm(false) }, { label: language === 'it' ? 'Scarta' : 'Discard', variant: 'destructive', disabled: discardingRecovery || syncStatus === 'syncing', onPress: () => { void discardRecovery().then(cleared => { if (cleared && isLiveScopeCurrent()) setShowClearRecoveryConfirm(false); }); } }]}
      />
      <Modal
        visible={showRematch}
        onClose={() => setShowRematch(false)}
        presentation="dialog"
        maxWidth={500}
        footer={(
          <Button
            label={copy('liveGameDone')}
            variant="ghost"
            onPress={() => router.replace(`/table/${groupId}`)}
          />
        )}
      >
        <ModalHeader
          title={copy('liveGameAgainTitle')}
          subtitle={`${copy('liveGameAgainHint')}\n${copy('liveGameDuration')}: ${formatGameDuration(completedDurationSeconds)}`}
          icon="refresh-outline"
          onClose={() => setShowRematch(false)}
        />
        {completedGame ? (
          <LiveGameRecapView
            record={completedGame}
            labels={{
              timeline: copy('liveGameLifeTimeline'),
              highlights: copy('liveGameHighlights'),
              empty: copy('liveGameLogEmpty'),
            }}
          />
        ) : null}
        <View style={styles.rematchActions}>
          <Button
            label={copy('liveGameSameDecks')}
            icon="layers-outline"
            onPress={handleRematchSameDecks}
          />
          <Button
            label={copy('liveGameReselectDecks')}
            icon="albums-outline"
            variant="outline"
            onPress={handleRematchReselect}
          />
        </View>
      </Modal>
    </Screen>
  );
}
