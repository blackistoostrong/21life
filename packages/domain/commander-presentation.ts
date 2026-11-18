/** Presentation-only edits must not erase known metadata after an optional lookup failure. */
export function resolvePresentationCommanderCmc(input: {
  previousCommander: string;
  nextCommander: string;
  storedCmc: number | null;
  resolvedCmc: number | null;
}): number | null {
  if (input.resolvedCmc !== null) return input.resolvedCmc;
  const nextName = input.nextCommander.trim().toLowerCase();
  return nextName.length > 0 && nextName === input.previousCommander.trim().toLowerCase() ? input.storedCmc : null;
}
