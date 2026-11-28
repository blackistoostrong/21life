import {StyleSheet, Switch, Text, View} from 'react-native';
import {Button} from '@/components/ui/button';
import {Modal} from '@/components/ui/modal';
import {ModalHeader} from '@/components/ui/modal-header';
import {colors, spacing} from '@/constants/theme';
import type {useNativeArenaRecap} from '@/hooks/use-native-arena-recap';

export function ArenaRecapDialog({recap}: {recap: ReturnType<typeof useNativeArenaRecap>}) {
  const {controller, snapshot, payload, labels} = recap;
  const busy = snapshot.pending !== null, exporting = busy && snapshot.pending !== 'read';
  return <Modal visible={snapshot.open} onClose={controller.close}>
    {snapshot.open && <View style={styles.section} accessibilityViewIsModal>
      <ModalHeader title={labels.title} subtitle={labels.privacy} onClose={controller.close} icon="share-outline" />
      <Text style={styles.label}>{labels.period}: {snapshot.days === 7 ? labels.days7 : labels.days30}</Text>
      <View style={styles.actions}>
        {([7, 30] as const).map(days => <Button key={days} label={days === 7 ? labels.days7 : labels.days30}
          variant={snapshot.days === days ? 'primary' : 'outline'} style={styles.action}
          disabled={exporting || snapshot.days === days} onPress={() => void controller.setDays(days)} />)}
      </View>
      <View style={styles.privacy}>
        <Text style={styles.text}>{labels.includeNames}</Text>
        <Switch accessibilityLabel={labels.includeNames} value={snapshot.includeNames} disabled={busy || !payload}
          onValueChange={controller.setIncludeNames} />
      </View>
      {snapshot.pending === 'read' && <Text style={styles.muted} accessibilityLiveRegion="polite">{labels.loading}</Text>}
      {snapshot.error && <View style={styles.section}>
        <Text style={styles.error} accessibilityRole="alert">{labels.errors[snapshot.error]}</Text>
        {!['share', 'copy', 'download'].includes(snapshot.error) && <Button label={labels.retry} variant="outline" disabled={busy} onPress={() => void controller.retry()} />}
      </View>}
      {payload && <Text style={styles.preview} selectable>{payload.text}</Text>}
      <Button label={labels.share} disabled={busy || !payload} onPress={() => void controller.exportText('share')} />
    </View>}
  </Modal>;
}
const styles = StyleSheet.create({
  section: {gap: spacing.md},
  label: {color: colors.foreground, fontWeight: '700'},
  text: {color: colors.foreground, flex: 1, fontSize: 14},
  muted: {color: colors.muted, fontSize: 13},
  error: {color: colors.destructive, fontSize: 14},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  action: {flex: 1, minWidth: 132},
  privacy: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44},
  preview: {borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, color: colors.foreground, fontSize: 13, lineHeight: 20},
});
