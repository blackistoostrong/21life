import {z} from 'zod';
import {createTablePresetCodec} from '../packages/features/table-presets/codec';

export const {decodeTablePresets, encodeTablePresets, validateTablePresetScope} = createTablePresetCodec(z);
