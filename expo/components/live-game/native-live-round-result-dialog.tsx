import { DeckImage } from '@/components/deck/deck-image';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ModalHeader } from '@/components/ui/modal-header';
import { colors } from '@/constants/theme';
import type { useLanguage } from '@/contexts/language-context';
import { hapticLight } from '@/lib/haptics';
import type { LiveGamePlayer,LiveGameResultWarning,WinCondition } from '@/lib/live-game';
import type { ParticipantKey } from '@/lib/participant-keys';
import { Ionicons } from '@expo/vector-icons';
import type { Dispatch,SetStateAction } from 'react';
import { Pressable,Text,View } from 'react-native';
import { nativeLiveScreenStyles as styles } from './native-live-screen-styles';
type Props={copy:ReturnType<typeof useLanguage>['copy'];language:ReturnType<typeof useLanguage>['language'];
 view:{showEndGame:boolean;endingGame:boolean;discardingGame:boolean;endIsDraw:boolean;endWinnerKey:ParticipantKey|'';
 endWinCondition:WinCondition|null;activePlayers:LiveGamePlayer[];endGameWarnings:LiveGameResultWarning[];requiresAlternativeWinCondition:boolean;
 featureFlags:{lastStanding?:boolean}|null|undefined;};
 actions:{setShowEndGame:Dispatch<SetStateAction<boolean>>;setEndIsDraw:Dispatch<SetStateAction<boolean>>;
 setEndWinnerKey:Dispatch<SetStateAction<ParticipantKey|''>>;setEndWinCondition:Dispatch<SetStateAction<WinCondition|null>>;
 handleEndGame:()=>Promise<void>;openDiscardConfirm:()=>void;};};
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
/** Controlled result dialog; commands and private data remain in their owners. */
export function NativeLiveRoundResultDialog({copy,language,view,actions}:Props){
 const {showEndGame,endingGame,discardingGame,endIsDraw,endWinnerKey,endWinCondition,activePlayers,endGameWarnings,requiresAlternativeWinCondition,featureFlags}=view;
 const {setShowEndGame,setEndIsDraw,setEndWinnerKey,setEndWinCondition,handleEndGame,openDiscardConfirm}=actions;
 return (<Modal
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
        </Modal>);
}
