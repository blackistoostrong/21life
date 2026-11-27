import type {ArenaRecapPayload} from './arena-recap-text';

/** Invoked only by an explicit gesture after a complete preview is visible. */
export const webArenaRecapExports = {
  share: async ({title, text}: ArenaRecapPayload): Promise<'opened'> => {
    if (!navigator.share) throw new Error('ARENA_RECAP_SHARE_UNAVAILABLE');
    await navigator.share({title, text});
    return 'opened';
  },
  copy: async ({text}: ArenaRecapPayload): Promise<void> => {
    if (!navigator.clipboard?.writeText) throw new Error('ARENA_RECAP_COPY_UNAVAILABLE');
    await navigator.clipboard.writeText(text);
  },
  download: async ({text, filename}: ArenaRecapPayload): Promise<void> => {
    const url = URL.createObjectURL(new Blob([text], {type: 'text/plain;charset=utf-8'}));
    const anchor = document.createElement('a');
    try {
      anchor.href = url; anchor.download = filename; anchor.hidden = true;
      document.body.appendChild(anchor); anchor.click();
    } finally {
      anchor.remove();
      // This accepted download owns its short URL lease even if the dialog closes.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },
};
