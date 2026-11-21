import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, spacing } from '@/constants/theme';
import { ARENA_SEASON_MONTHS } from '@/lib/arena-seasons';

type Labels = {
  enabled: string;
  enabledHint: string;
  startMonth: string;
  resetHint: string;
};

export function ArenaSeasonSettings({
  enabled,
  resetMonth,
  locale,
  labels,
  onEnabledChange,
  onResetMonthChange,
}: {
  enabled: boolean;
  resetMonth: number;
  locale: string;
  labels: Labels;
  onEnabledChange: (enabled: boolean) => void;
  onResetMonthChange: (month: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const monthLabel = (month: number) => new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2026, month - 1, 1)));
  return (
    <>
      <View style={styles.settingRow}>
        <View style={styles.settingText}>
          <Text style={styles.title}>{labels.enabled}</Text>
          <Text style={styles.hint}>{labels.enabledHint}</Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={value => { setOpen(false); onEnabledChange(value); }}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.foreground}
        />
      </View>
      {enabled ? (
        <View style={styles.editor}>
          <Text style={styles.title}>{labels.startMonth}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={labels.startMonth}
            accessibilityState={{ expanded: open }} accessibilityValue={{ text: monthLabel(resetMonth) }}
            onPress={() => setOpen(value => !value)} style={styles.monthSelect}>
            <Text style={styles.monthButtonTextActive}>{monthLabel(resetMonth)}</Text>
            <Text accessible={false} style={styles.hint}>{open ? '▴' : '▾'}</Text>
          </Pressable>
          {open ? <View style={styles.monthList}>
            {ARENA_SEASON_MONTHS.map(month => <Pressable key={month}
              accessibilityRole="radio" accessibilityLabel={monthLabel(month)}
              accessibilityState={{ checked: resetMonth === month }}
              onPress={() => { onResetMonthChange(month); setOpen(false); }}
              style={[styles.monthOption, resetMonth === month && styles.monthButtonActive]}>
              <Text style={styles.monthButtonTextActive}>{monthLabel(month)}</Text>
              {resetMonth === month ? <Text accessible={false} style={styles.monthButtonTextActive}>✓</Text> : null}
            </Pressable>)}
          </View> : null}
          <Text style={styles.hint}>{labels.resetHint}</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  settingText: { flex: 1, gap: 4 },
  title: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  editor: { gap: spacing.sm },
  monthSelect: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  monthList: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: 'hidden' },
  monthOption: { minHeight: 44, padding: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  monthButtonActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}22` },
  monthButtonTextActive: { color: colors.foreground },
});
