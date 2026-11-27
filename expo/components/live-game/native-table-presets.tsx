import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Modal} from '@/components/ui/modal';
import {ModalHeader} from '@/components/ui/modal-header';
import {colors, spacing} from '@/constants/theme';
import {useLanguage} from '@/contexts/language-context';
import {useNativeTablePresets} from '@/hooks/use-native-table-presets';
import {tablePresetLabels} from '@/lib/table-preset-labels';
import {TABLE_PRESET_LIMIT, TABLE_PRESET_NAME_LIMIT} from '../../../packages/domain/table-presets';

type Props = {
  groupId: string; userId: string;
  setup: Parameters<typeof useNativeTablePresets>[2];
  scope: Parameters<typeof useNativeTablePresets>[3];
  online: boolean; disabled: boolean;
};

export function NativeTablePresets(props: Props) {
  return <ScopedNativeTablePresets key={`${props.userId}:${props.groupId}`} {...props} />;
}

function ScopedNativeTablePresets({groupId, userId, setup, scope, online, disabled}: Props) {
  const {language} = useLanguage();
  const labels = tablePresetLabels(language);
  const {controller, snapshot} = useNativeTablePresets(groupId, userId, setup, scope, online);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const busy = snapshot.pending !== null;
  const close = () => {controller.cancel(); setOpen(false); setEditingId(null); setDeletingId(null); setName('');};
  const save = async () => {
    if (await (editingId ? controller.rename(editingId, name) : controller.save(name))) {
      setName(''); setEditingId(null);
    }
  };
  const preview = snapshot.preview;
  return <View style={styles.section}>
    <Button label={labels.title} variant="outline" disabled={disabled || !userId}
      onPress={() => {setOpen(true); void controller.refresh();}} />
    {setup.presetMissingReferences > 0 && <Text accessibilityLiveRegion="polite" style={styles.warning}>{labels.missing(setup.presetMissingReferences)}</Text>}
    <Modal visible={open} onClose={close}>
      {open && <View style={styles.section} accessibilityViewIsModal>
        <ModalHeader title={labels.title} subtitle={labels.deviceHint} onClose={close} icon="bookmark-outline" />
        <Text style={styles.text} accessibilityLiveRegion="polite">{snapshot.loaded ? snapshot.presets.length : '—'}/{TABLE_PRESET_LIMIT}</Text>
        {snapshot.error && <Text accessibilityRole="alert" style={styles.error}>{labels.errors[snapshot.error]}</Text>}
        {busy && <Text accessibilityLiveRegion="polite" style={styles.muted}>{labels.working}</Text>}
        {preview ? <View style={styles.section}>
          <Text accessibilityRole="header" style={styles.title}>{labels.preview}: {preview.name}</Text>
          <Text style={styles.text}>{labels.summary(preview)}</Text>
          {preview.seats.map((seat, index) => {
            const participant = setup.setupParticipants.find(item => item.key === seat.participantKey);
            const deck = participant?.decks.find(item => item.id === seat.deckId);
            return <Text key={index} style={styles.row}>
              {labels.seat} {index + 1}: {seat.participantKey ? participant?.name || labels.selectedPlayer : labels.emptySeat}
              {' · '}{seat.deckId ? deck?.name || labels.selectedDeck : labels.missingDeck}
            </Text>;
          })}
          <Text style={styles.muted}>{labels.previewHint}</Text>
          <Button label={labels.apply} disabled={busy || disabled} onPress={async () => {if (await controller.confirmLoad()) close();}} />
          <Button label={labels.cancel} variant="outline" disabled={busy} onPress={() => controller.cancel()} />
        </View> : <>
          <Input label={labels.name} value={name} onChangeText={setName} editable={!busy} autoCorrect={false}
            hint={`${Array.from(name.trim().normalize('NFC')).length}/${TABLE_PRESET_NAME_LIMIT}`}
            returnKeyType="done" onSubmitEditing={() => {if (!busy && !disabled) void save();}} />
          <Button label={editingId ? labels.rename : labels.save}
            disabled={busy || disabled || (!editingId && snapshot.loaded && snapshot.presets.length >= TABLE_PRESET_LIMIT)} onPress={() => void save()} />
          {editingId && <Button label={labels.cancel} variant="ghost" disabled={busy} onPress={() => {setEditingId(null); setName('');}} />}
          {snapshot.loaded && snapshot.presets.length === 0 && <Text style={styles.muted}>{labels.empty}</Text>}
          {snapshot.presets.map(preset => <View key={preset.id} style={styles.row}>
            <Text accessibilityRole="header" style={styles.title}>{preset.name}</Text>
            <Text style={styles.muted}>{labels.summary(preset)}</Text>
            <View style={styles.actions}>
              <Button label={`${labels.load} ${preset.name}`} variant="outline" style={styles.action} disabled={busy || disabled}
                onPress={() => {setDeletingId(null); void controller.requestLoad(preset.id);}} />
              <Button label={`${labels.rename} ${preset.name}`} variant="ghost" style={styles.action} disabled={busy}
                onPress={() => {setEditingId(preset.id); setName(preset.name); setDeletingId(null);}} />
              <Button label={`${labels.remove} ${preset.name}`} variant="ghost" style={styles.action} disabled={busy} onPress={() => setDeletingId(preset.id)} />
            </View>
            {deletingId === preset.id && <View style={styles.section}>
              <Text style={styles.text}>{labels.removeQuestion(preset.name)}</Text>
              <Button label={labels.confirmRemove} variant="destructive" disabled={busy} onPress={async () => {
                if (await controller.remove(preset.id)) {
                  setDeletingId(null);
                  if (editingId === preset.id) {setEditingId(null); setName('');}
                }
              }} />
              <Button label={labels.cancel} variant="outline" disabled={busy} onPress={() => setDeletingId(null)} />
            </View>}
          </View>)}
          <Button label={labels.retry} variant="outline" disabled={busy} onPress={() => void controller.refresh()} />
        </>}
      </View>}
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  section: {gap: spacing.md},
  text: {color: colors.foreground, fontSize: 14},
  title: {color: colors.foreground, fontSize: 16, fontWeight: '700'},
  muted: {color: colors.muted, fontSize: 13},
  warning: {color: colors.amber, fontSize: 13},
  error: {color: colors.destructive, fontSize: 14},
  row: {gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, color: colors.foreground},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  action: {flexGrow: 1, flexBasis: 140},
});
