import { colors,radii,spacing } from '@/constants/theme';
import { StyleSheet } from 'react-native';
export const nativeLiveScreenStyles = StyleSheet.create({
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