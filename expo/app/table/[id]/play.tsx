import { SetupRestoreGate } from '@/components/live-game/setup-restore-gate';
import { useLiveGameCommandScope } from '@/hooks/use-live-game-command-scope';
import { useLiveSetupMemberSync } from '@/hooks/use-live-setup-member-sync';
import { useNativeLiveSession } from '@/hooks/use-native-live-session';
import { useNativeLiveSetup } from '@/hooks/use-native-live-setup';
import { createLiveGameRound } from '@/lib/live-game-round';
import { useFocusEffect,useLocalSearchParams,useRouter } from 'expo-router';


import { DeckImage } from '@/components/deck/deck-image';
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
import { colors,radii,spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { useLanguage } from '@/contexts/language-context';
import { useRuntimeConfig } from '@/contexts/runtime-config-context';
import { useToast } from '@/contexts/toast-context';
import { useArena } from '@/hooks/use-arena';
import { useScreenInsets } from '@/hooks/use-screen-insets';
import { hapticLight,hapticMedium,hapticSuccess,hapticWarning } from '@/lib/haptics';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import { Platform,Pressable,ScrollView,StyleSheet,Text,View } from 'react-native';

import {
getDefaultWinCondition,
getLiveGameResultWarnings,
getSuggestedWinner,
isValidLiveGameResult,
pickRandomPlayer,
type DamageMode,
type LiveGameMutation,
type LiveGamePlayer,
type LiveGameRecord,
type LiveGameState,
type WinCondition,
} from '@/lib/live-game';
import { withLiveGameTimeout } from '@/lib/live-game-async';
import { formatGameDuration,getGameDurationSeconds } from '@/lib/live-game-duration';
import {
applyLiveGameImmersive,
clearLiveGameImmersive,
} from '@/lib/live-game-immersive';
import { getDiscardConfirmationVisibility } from '@/lib/live-game-modal-state';
import {
type PendingLiveGameFinalization
} from '@/lib/live-game-offline';
import {
applyLiveGameOrientationLock,
clearLiveGameOrientationLock,
} from '@/lib/live-game-orientation';
import { buildRouletteSequence } from '@/lib/live-game-roulette';
import { fetchBusyLiveGameParticipantKeys } from '@/lib/live-game-service';
import {
saveLiveGameSetup,
} from '@/lib/live-game-setup';
import { countLiveGamePendingOperations,getLiveGameSyncCopy,getLiveGameSyncIndicator,getLiveGameSyncState } from '@/lib/live-game-sync-presentation';
import { parseParticipantKey,type ParticipantKey } from '@/lib/participant-keys';
import { getProfileDisplayName } from '@/lib/profile-display';
const WIN_CONDITIONS: {
  value: WinCondition;
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: 'liveGameWinLastStanding' | 'liveGameWinCombo' | 'liveGameWinConcession' | 'liveGameWinAlternateCard' | 'liveGameWinOther';
  hintKey: 'liveGameWinLastStandingHint' | 'liveGameWinComboHint' | 'liveGameWinConcessionHint' | 'liveGameWinAlternateCardHint' | 'liveGameWinOtherHint';
}[] = [
  { value: 'last_standing', icon: 'shield-checkmark-outline', labelKey: 'liveGameWinLastStanding', hintKey: 'liveGameWinLastStandingHint' },
  { value: 'combo', icon: 'git-merge-outline', labelKey: 'liveGameWinCombo', hintKey: 'liveGameWinComboHint' },
  { value: 'concession', icon: 'flag-outline', labelKey: 'liveGameWinConcession', hintKey: 'liveGameWinConcessionHint' },
  { value: 'alternate_card', icon: 'sparkles-outline', labelKey: 'liveGameWinAlternateCard', hintKey: 'liveGameWinAlternateCardHint' },
  { value: 'other', icon: 'ellipsis-horizontal-circle-outline', labelKey: 'liveGameWinOther', hintKey: 'liveGameWinOtherHint' },
];

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
  const { showToast } = useToast();
  const { scrollContentStyle } = useScreenInsets();

  const { members, guests, decks, matches, loading, group, refreshMemberDecks } = useArena(groupId, user?.id);

  const { selectedKeys, participantDecks, playerCount, setPlayerCount, layoutVariant, setLayoutVariant, seatSetups, setupReadyKey, setupRestoreError, setSetupRetry, startingLife, setOccasionalDecks, getDeckOptions, setupParticipants, applySeatSetups, applyStartingLife, handlePlayerCountChange, handleAssignSeat, resetSetup } = useNativeLiveSetup(groupId, user, { members, guests, decks, matches, loading },
    { epoch: liveScopeEpoch, isCurrent: isLiveScopeCurrent, bindClient: bindLiveClient });

  const {archidektSyncRequest,handleSelectSetupParticipant,handleRetryArchidektSync} = useLiveSetupMemberSync({
    groupId,currentUserId,members,refreshMemberDecks,copy,language,
    scope:{epoch:liveScopeEpoch,isCurrent:isLiveScopeCurrent,bindClient:bindLiveClient}});
  const [starting, setStarting] = useState(false);
  const [damagePulse, setDamagePulse] = useState<Record<string, number>>({});
  const [randomHighlight, setRandomHighlight] = useState<ParticipantKey | null>(null);
  const [startingHighlight, setStartingHighlight] = useState<ParticipantKey | null>(null);
  const [pendingEliminate, setPendingEliminate] = useState<ParticipantKey | null>(null);
  const [showEndGame, setShowEndGame] = useState(false);
  const [endWinnerKey, setEndWinnerKey] = useState<ParticipantKey | ''>('');
  const [endIsDraw, setEndIsDraw] = useState(false);
  const [endWinCondition, setEndWinCondition] = useState<WinCondition | null>(null);
  const [endingGame, setEndingGame] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showExitChoice, setShowExitChoice] = useState(false);
  const [discardingGame, setDiscardingGame] = useState(false);
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
const {journal,liveGame,undoDepth,redoDepth,pendingSyncCount,localPersistenceAvailable,booting,syncStatus,syncError,authenticationRequired,
 networkOnline,recoveryCount,archivedPendingCount,saveJournal,syncJournal,flushArchivedOutbox,cancelScheduledSync,enqueueMutation,handleUndo,handleRedo,discardRecovery,discardingRecovery}
 =useNativeLiveSession({groupId,currentUserId,hasCompletedGame:Boolean(completedGame),setSetupRetry,onRemoteCompleted,
 scope:{epoch:liveScopeEpoch,isCurrent:isLiveScopeCurrent,bindClient:bindLiveClient}});


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
    setStarting(false); setEndingGame(false); setDiscardingGame(false);
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

  const resolveMeta = (key: ParticipantKey) => {
    const parsed = parseParticipantKey(key);
    if (!parsed) return null;
    const deckId = participantDecks[key];
    const deck = getDeckOptions(key).find((entry) => entry.id === deckId);
    if (!deck) return null;

    if (parsed.type === 'user') {
      const member = members.find((entry) => entry.id === parsed.id);
      if (!member) return null;
      return {
        key,
        deckId: deck.id,
        displayName: getProfileDisplayName(member),
        commander: deck.commander,
        commanderImage: deck.commander_image,
        isGuest: false,
        userId: parsed.id,
        guestId: null,
      };
    }

    const guest = guests.find((entry) => entry.id === parsed.id);
    if (!guest) return null;
    return {
      key,
      deckId: deck.id,
      displayName: guest.display_name,
      commander: deck.commander,
      commanderImage: deck.commander_image,
      isGuest: true,
      userId: null,
      guestId: parsed.id,
    };
  };

  const handleStart = async () => {
    if (!isLiveScopeCurrent()) return;
    if (setupReadyKey !== `${user?.id}:${groupId}`) return;
    if (!user) return;
    if (selectedKeys.length !== playerCount) {
      showToast(copy('liveGameFillSeats'));
      return;
    }

    const missingDeck = selectedKeys.find((key) => {
      const options = getDeckOptions(key);
      return options.length > 0 && !participantDecks[key];
    });
    if (missingDeck) {
      showToast(copy('liveGameDeckError'));
      return;
    }

    const resolvedPlayers = selectedKeys.map((key) => ({ key, meta: resolveMeta(key) }));
    if (resolvedPlayers.some((entry) => !entry.meta)) {
      showToast(copy('liveGameDeckError'));
      return;
    }

    const command = beginLiveCommand();
    if (!command) return;
    setStarting(true);
    try {
      try {
        const busyKeys = await withLiveGameTimeout(
          fetchBusyLiveGameParticipantKeys(bindLiveClient().client, groupId, selectedKeys),
        );
        if (!command.isCurrent()) return;
        if (busyKeys.length > 0) {
          showToast(copy('liveGamePlayersBusy'));
          return;
        }
      } catch {
        // Offline starts remain available; the durable outbox will retry later.
      }
      if (!command.isCurrent()) return;

      const created = createLiveGameRound({
        id: Crypto.randomUUID(), groupId, actorId: user.id, startedAt: new Date().toISOString(),
        startingLife, layoutVariant, random: Math.random,
        seats: resolvedPlayers.map(({key, meta}) => ({participantKey: key, deckId: meta!.deckId,
          displayName: meta!.displayName, commander: meta!.commander, commanderImage: meta!.commanderImage})),
      });
      if(!journal.start(created))throw Error('Previous game has pending operations');
      await saveLiveGameSetup(groupId, user.id, {
        playerCount,
        layoutVariant,
        startingLife,
        seats: seatSetups,
      }).catch(() => undefined);
      if (!command.isCurrent()) return;
      revealStartingPlayer(created.state.startingPlayerKey ?? null, selectedKeys);
      await saveJournal();
      if (!command.isCurrent()) return;
      void syncJournal();
      showToast(copy('liveGameStarted'));
    } catch {
      if (command.isCurrent()) showToast(copy('liveGameStartFailed'));
    } finally {
      if (command.isCurrent()) setStarting(false);
      command.release();
    }
  };

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

  const handleDiscardGame = async () => {
    if (!liveGame || discardingGame || journal.getSnapshot().closed) return;
    const command = beginLiveCommand();
    if (!command) return;

    setDiscardingGame(true);
    cancelScheduledSync();
    try {
      if(!await journal.archive(null,true)||!command.isCurrent())return;
      flushArchivedOutbox();
      hapticSuccess();
      showToast(copy('liveGameDiscarded'));
      router.replace(`/table/${groupId}`);
    } catch {
      if (!command.isCurrent()) return;
      void saveJournal();
      showToast(copy('liveGameDiscardFailed'));
    } finally {
      if (command.isCurrent()) {
        setDiscardingGame(false);
        setShowDiscardConfirm(false);
        setShowEndGame(false);
      }
      command.release();
    }
  };

  const handleEndGame = async () => {
    if (!isLiveScopeCurrent()) return;
    if (!user || !liveGame || endingGame || journal.getSnapshot().closed) return;
    if (!endIsDraw && !endWinnerKey) {
      showToast(copy('liveGameWinnerError'));
      return;
    }
    if (!endIsDraw && activePlayers.length !== 1 && !endWinCondition) {
      showToast(copy('liveGameWinConditionError'));
      return;
    }
    if (!isValidLiveGameResult(liveGame.state, {
      winnerKey: endIsDraw ? null : endWinnerKey || null,
      isDraw: endIsDraw,
      winCondition: endIsDraw ? null : endWinCondition,
    })) {
      showToast(copy('liveGameWinConditionError'));
      return;
    }

    const command = beginLiveCommand();
    if (!command) return;
    setEndingGame(true);
    try {
      if (!endIsDraw && endWinCondition === 'last_standing' && activePlayers.length > 1 && endWinnerKey) {
        activePlayers
          .filter((player) => player.participantKey !== endWinnerKey)
          .forEach((player) => pulseDamage(player.participantKey));
        enqueueMutation({ type: 'last_standing', winnerKey: endWinnerKey });
      }

      const finalizedGame = journal.getSnapshot().record ?? liveGame;
      const players = finalizedGame.state.players.map((player: LiveGamePlayer) => {
        const parsed = parseParticipantKey(player.participantKey);
        return {
          participantKey: player.participantKey,
          deckId: player.deckId,
          isGuest: parsed?.type === 'guest',
          userId: parsed?.type === 'user' ? parsed.id : null,
          guestId: parsed?.type === 'guest' ? parsed.id : null,
        };
      });

      const pending: PendingLiveGameFinalization = {
        winnerKey: endIsDraw ? null : endWinnerKey,
        isDraw: endIsDraw,
        winCondition: endIsDraw
          ? null
          : activePlayers.length === 1 ? 'last_standing' : endWinCondition,
        endedAt: new Date().toISOString(),
        players,
      };
      cancelScheduledSync();

      const durationSeconds = getGameDurationSeconds(liveGame.started_at, pending.endedAt);
      setCompletedDurationSeconds(durationSeconds);

      setCompletedGame(finalizedGame);
      if(!await journal.archive(pending,false)||!command.isCurrent())return;
      flushArchivedOutbox();

      hapticSuccess();
      showToast(`${endIsDraw ? copy('liveGameSavedDraw') : copy('liveGameSaved')} · ${formatGameDuration(durationSeconds)}`);
      setShowRematch(true);
    } catch {
      if (!command.isCurrent()) return;
      void saveJournal();
      showToast(copy('liveGameSaveFailed'));
    } finally {
      if (command.isCurrent()) {
        setEndingGame(false);
        setShowEndGame(false);
      }
      command.release();
    }
  };

  const preparePreviousPod = useCallback(() => {
    const previous = completedGame;
    if (!previous) return null;
    const orderedPlayers = [...previous.state.players].sort((a, b) => a.slot - b.slot);
    setPlayerCount(orderedPlayers.length);
    setLayoutVariant(previous.state.layoutVariant ?? 'classic');
    applySeatSetups(orderedPlayers.map((player) => ({
      participantKey: player.participantKey,
      deckId: player.deckId,
    })));
    applyStartingLife(previous.starting_life);
    return previous;
  }, [applySeatSetups, applyStartingLife, completedGame, setLayoutVariant, setPlayerCount]);

  const handleRematchSameDecks = useCallback(async () => {
    if (!user || !isLiveScopeCurrent()) return;
    const command = beginLiveCommand();
    if (!command) return;
    try {
      const previous = preparePreviousPod();
      if (!previous) return;
      const keys = previous.state.players.map((player) => player.participantKey);
      const record = createLiveGameRound({
        id: Crypto.randomUUID(), groupId, actorId: user.id, startedAt: new Date().toISOString(),
        startingLife: previous.starting_life, layoutVariant: previous.state.layoutVariant ?? 'classic',
        seats: previous.state.players, random: Math.random,
      });
      if(!journal.start(record))return;
      revealStartingPlayer(record.state.startingPlayerKey ?? null, keys);
      setShowRematch(false);
      await saveJournal();
      if (!command.isCurrent()) return;
      void syncJournal();
    } finally { command.release(); }
  }, [journal,beginLiveCommand, groupId, isLiveScopeCurrent, preparePreviousPod, revealStartingPlayer, saveJournal, syncJournal, user, setShowRematch]);

  const handleRematchReselect = useCallback(() => {
    preparePreviousPod();
    setShowRematch(false);
  }, [preparePreviousPod,setShowRematch]);

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

        <Modal
          visible={showEndGame}
          onClose={() => setShowEndGame(false)}
          presentation="dialog"
          maxWidth={560}
          footer={(
            <View style={styles.modalActions}>
              <Button
                label={copy('cancel')}
                variant="outline"
                onPress={() => setShowEndGame(false)}
                style={styles.modalButton}
              />
              <Button
                label={endingGame ? copy('liveGameSaving') : copy('liveGameConfirmSave')}
                icon="checkmark-circle-outline"
                onPress={handleEndGame}
                disabled={endingGame
                  || discardingGame
                  || (!endIsDraw && !endWinnerKey)
                  || (requiresAlternativeWinCondition && !endWinCondition)}
                style={styles.modalButton}
              />
            </View>
          )}
        >
          <ModalHeader
            title={copy('liveGameWhoWon')}
            subtitle={copy('liveGameEndGameHint')}
            icon="trophy-outline"
            tone="success"
            onClose={() => setShowEndGame(false)}
          />
          <View style={styles.winConditionHeading}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.winConditionTitle}>{copy('liveGameWhoWon')}</Text>
          </View>
          <Pressable
            style={[styles.drawOption, endIsDraw && styles.winnerOptionActive]}
            onPress={() => {
              setEndIsDraw((value) => !value);
              setEndWinnerKey('');
              setEndWinCondition(null);
              void hapticLight();
            }}
          >
            <View style={styles.drawIcon}>
              <Ionicons name="remove" size={22} color={endIsDraw ? colors.primaryMuted : colors.muted} />
            </View>
            <View style={styles.winnerCopy}>
              <Text style={styles.winnerOptionText}>{copy('liveGameDraw')}</Text>
              <Text style={styles.winnerOptionMeta}>{copy('liveGameDrawHint')}</Text>
            </View>
            <Ionicons
              name={endIsDraw ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={endIsDraw ? colors.primaryLight : colors.muted}
            />
          </Pressable>
          {!endIsDraw ? activePlayers.map((player: LiveGamePlayer) => (
            <Pressable
              key={player.participantKey}
              style={[styles.winnerOption, endWinnerKey === player.participantKey && styles.winnerOptionActive]}
              onPress={() => {
                setEndIsDraw(false);
                setEndWinnerKey(player.participantKey);
                setEndWinCondition(activePlayers.length === 1 ? 'last_standing' : null);
                void hapticLight();
              }}
            >
              <DeckImage
                uri={player.commanderImage}
                alt={player.commander}
                style={styles.winnerImage}
                containerStyle={styles.winnerImageWrap}
                contentPosition="top"
              />
              <View style={styles.winnerCopy}>
                <Text style={styles.winnerOptionText} numberOfLines={1}>{player.displayName}</Text>
                <Text style={styles.winnerOptionMeta} numberOfLines={1}>{player.commander}</Text>
              </View>
              <Ionicons
                name={endWinnerKey === player.participantKey ? 'checkmark-circle' : 'ellipse-outline'}
                size={24}
                color={endWinnerKey === player.participantKey ? colors.primaryLight : colors.muted}
              />
            </Pressable>
          )) : null}
          {!endIsDraw && endWinnerKey ? (
            <View style={styles.winConditionSection}>
              <View style={styles.winConditionHeading}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>2</Text>
                </View>
                <View style={styles.winConditionHeadingCopy}>
                  <Text style={styles.winConditionTitle}>{copy('liveGameWinCondition')}</Text>
                  <Text style={styles.winConditionHint}>
                    {requiresAlternativeWinCondition
                      ? copy('liveGameWinConditionHint')
                      : copy('liveGameWinLastStandingHint')}
                  </Text>
                </View>
              </View>
              {requiresAlternativeWinCondition ? (
                <View style={styles.winConditionGrid}>
                  {WIN_CONDITIONS.filter((condition) => (
                    condition.value !== 'last_standing' || featureFlags?.lastStanding !== false
                  )).map((condition) => {
                    const selected = endWinCondition === condition.value;
                    return (
                      <Pressable
                        key={condition.value}
                        onPress={() => {
                          setEndWinCondition(condition.value);
                          void hapticLight();
                        }}
                        style={({ pressed }) => [
                          styles.winConditionOption,
                          selected && styles.winConditionOptionActive,
                          pressed && styles.choicePressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                      >
                        <View style={[styles.winConditionIcon, selected && styles.winConditionIconActive]}>
                          <Ionicons
                            name={condition.icon}
                            size={20}
                            color={selected ? colors.primaryLight : colors.muted}
                          />
                        </View>
                        <Text style={styles.winConditionOptionTitle}>{copy(condition.labelKey)}</Text>
                        <Text style={styles.winConditionOptionHint} numberOfLines={2}>{copy(condition.hintKey)}</Text>
                        <Ionicons
                          name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                          size={19}
                          color={selected ? colors.primaryLight : colors.border}
                          style={styles.winConditionCheck}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.lastStandingCard}>
                  <Ionicons name="shield-checkmark-outline" size={21} color="#86efac" />
                  <Text style={styles.lastStandingText}>{copy('liveGameWinLastStanding')}</Text>
                  <Ionicons name="checkmark-circle" size={20} color="#86efac" />
                </View>
              )}
            </View>
          ) : null}
          {endGameWarnings.length > 0 ? (
            <View style={styles.resultWarning}>
              <Ionicons name="warning-outline" size={18} color="#fcd34d" />
              <Text style={styles.resultWarningText}>{endGameWarnings.map((warning) => (
                warning === 'draw_with_single_survivor'
                  ? (language === 'it' ? 'È rimasto un solo giocatore: verifica che sia davvero un pareggio.' : 'Only one player remains: verify this is really a draw.')
                  : (language === 'it' ? 'Il vincitore ha già un valore letale o risulta eliminato.' : 'The winner already has a lethal total or is marked eliminated.')
              )).join(' ')}</Text>
            </View>
          ) : null}
          <Pressable
            onPress={openDiscardConfirm}
            disabled={endingGame || discardingGame}
            style={styles.discardButton}
          >
            <Ionicons name="trash-outline" size={16} color={colors.destructive} />
            <Text style={styles.discardButtonText}>
              {discardingGame ? copy('liveGameDiscarding') : copy('liveGameDiscard')}
            </Text>
          </Pressable>
        </Modal>

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

const styles = StyleSheet.create({
  topBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backLabel: {
    color: colors.primaryMuted,
    fontSize: 14,
    fontWeight: '600',
  },

  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  setupPanel: {
    gap: spacing.md,
  },
  setupTitle: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: '700',
  },
  setupHint: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionLabel: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  resultWarning: { flexDirection: 'row', gap: spacing.sm, borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', borderRadius: radii.md, backgroundColor: 'rgba(245,158,11,0.1)', padding: spacing.sm },
  resultWarningText: { flex: 1, color: '#fde68a', fontSize: 11, lineHeight: 16 },
  rematchActions: {
    gap: spacing.sm,
  },
  configSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  configSectionLabel: {
    flex: 1,
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '600',
  },
  playerCountHint: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  lifePill: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  lifePillActive: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(14, 165, 233, 0.15)',
  },
  lifePillText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  lifePillTextActive: {
    color: '#7dd3fc',
  },
  presetButton: {
    flex: 1,
  },
  immersiveRoot: {
    flex: 1,
    backgroundColor: '#050508',
  },
  exitChoiceGrid: {
    gap: spacing.sm,
  },
  exitChoice: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  pauseChoice: {
    borderColor: colors.selectionBorder,
    backgroundColor: colors.selectionTint,
  },
  discardChoice: {
    borderColor: 'rgba(248,113,113,0.34)',
    backgroundColor: 'rgba(127,29,29,0.13)',
  },
  exitChoiceIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pauseChoiceIcon: {
    backgroundColor: colors.selectionTintStrong,
  },
  discardChoiceIcon: {
    backgroundColor: 'rgba(127,29,29,0.3)',
  },
  exitChoiceCopy: {
    flex: 1,
    gap: 2,
  },
  exitChoiceTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '800',
  },
  discardChoiceTitle: {
    color: '#fecaca',
  },
  exitChoiceHint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  drawOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.cardInset,
    padding: spacing.sm,
  },
  drawIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceChip,
  },
  winnerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.cardInset,
    padding: spacing.sm,
  },
  winnerOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.selectionTint,
  },
  winnerOptionText: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '800',
  },
  choicePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.985 }],
  },
  winnerOptionMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 2,
  },
  winnerCopy: {
    flex: 1,
    minWidth: 0,
  },
  winnerImageWrap: {
    width: 42,
    height: 56,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  winnerImage: {
    width: 42,
    height: 56,
  },
  winConditionSection: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  winConditionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  stepBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '900',
  },
  winConditionHeadingCopy: {
    flex: 1,
  },
  winConditionTitle: {
    color: colors.foreground,
    fontSize: 15,
    fontWeight: '900',
  },
  winConditionHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  winConditionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  winConditionOption: {
    position: 'relative',
    flexGrow: 1,
    flexBasis: '47%',
    minHeight: 118,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardInset,
    padding: spacing.md,
    gap: 5,
  },
  winConditionOptionActive: {
    borderColor: colors.primaryLight,
    backgroundColor: colors.selectionTint,
  },
  winConditionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceChip,
  },
  winConditionIconActive: {
    backgroundColor: colors.selectionTintStrong,
  },
  winConditionOptionTitle: {
    color: colors.foreground,
    fontSize: 13,
    fontWeight: '900',
  },
  winConditionOptionHint: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  winConditionCheck: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  lastStandingCard: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.30)',
    backgroundColor: 'rgba(22, 101, 52, 0.18)',
    paddingHorizontal: spacing.md,
  },
  lastStandingText: {
    flex: 1,
    color: '#dcfce7',
    fontSize: 13,
    fontWeight: '800',
  },
  modalActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modalButton: {
    flex: 1,
  },
  discardButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.md,
  },
  discardButtonText: {
    color: colors.destructive,
    fontSize: 13,
    fontWeight: '700',
  },
});
