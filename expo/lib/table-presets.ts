import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {createTablePresetRepository} from '../../packages/data/table-preset-storage';
import {decodeTablePresets,encodeTablePresets,validateTablePresetScope} from './table-preset-codec';

/** One repository owns accepted AsyncStorage operations per account/group key. */
export const tablePresets = createTablePresetRepository({
  getItem: key => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
}, {
  decode: decodeTablePresets,
  encode: encodeTablePresets,
  validateScope: validateTablePresetScope,
}, {
  randomUUID: () => Crypto.randomUUID(),
  now: () => new Date().toISOString(),
});
