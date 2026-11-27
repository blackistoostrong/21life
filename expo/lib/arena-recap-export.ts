import {Share} from 'react-native';
import type {ArenaRecapPayload} from './arena-recap-text';

export const nativeArenaRecapExports = {
  share: async ({title, text}: ArenaRecapPayload): Promise<'opened' | 'cancelled'> => {
    const outcome = await Share.share({title, message: text});
    // Android resolves sharedAction even on dismissal: never claim publication.
    return outcome.action === Share.dismissedAction ? 'cancelled' : 'opened';
  },
};
