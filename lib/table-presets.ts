import {createTablePresetRepository} from '../packages/data/table-preset-storage';
import {TablePresetError} from '../packages/domain/table-presets';
import {decodeTablePresets,encodeTablePresets,validateTablePresetScope} from './table-preset-codec';

/** Web Locks serialize the entire document transaction across tabs. */
export const tablePresets = createTablePresetRepository({
  getItem: async key => window.localStorage.getItem(key),
  setItem: async (key, value) => window.localStorage.setItem(key, value),
  exclusive: async (key, work, signal) => {
    if (typeof window === 'undefined' || !navigator.locks) throw new TablePresetError('storage');
    return navigator.locks.request(key, {mode: 'exclusive', signal}, work);
  },
}, {
  decode: decodeTablePresets,
  encode: encodeTablePresets,
  validateScope: validateTablePresetScope,
}, {
  randomUUID: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
});
