export function DeckSourceBadge({ sourceType }: { sourceType: string | null }) {
    if (sourceType === 'archidekt') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
          Archidekt
        </span>
      );
    }
    if (sourceType === 'moxfield') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/20 px-2 py-0.5 text-xs text-teal-300">
          Moxfield
        </span>
      );
    }
    return null;
  }
