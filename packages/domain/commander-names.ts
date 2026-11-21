/** Preserve web import normalization, including partner and single-slash forms. */
export function expandDeckCommanderNames(commander: string) {
  return Array.from(new Set(
    commander
      .split('//')
      .flatMap((part) => part.split('/').map((name) => name.trim()))
      .filter(Boolean)
  ));
}
