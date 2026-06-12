import type { DevDemoSolution, DevDemoState } from './types.js';

/**
 * The manual rule: the label's FIRST letter selects the disarm procedure.
 * This is what makes the rig an information-asymmetry puzzle — the Defuser
 * sees the label, the Expert holds this mapping. generate() derives the
 * authoritative `solution` with this same function, so manual and server
 * truth can never diverge.
 */
export function solutionForLabel(label: string): DevDemoSolution {
  const first = label[0] ?? 'A';
  if (first <= 'I') return 'cut';
  if (first <= 'R') return 'press';
  return 'cut-press';
}

/**
 * Pure solution validation — the rules an Expert reads aloud from the manual,
 * expressed as code. The reducer consumes these verdicts; nothing here touches
 * state shape, time, or randomness. 'progress' = a correct intermediate step
 * (no solve, no strike).
 */
export type DevDemoVerdict = 'solve' | 'strike' | 'progress';

/** Verdict for cutting the wire in the given instance state. */
export function classifyCut(data: DevDemoState): DevDemoVerdict {
  if (data.solution === 'cut') return 'solve';
  if (data.solution === 'cut-press') return 'progress'; // step 1 of 2
  return 'strike';
}

/** Verdict for a completed press (button released after being held down). */
export function classifyRelease(data: DevDemoState): DevDemoVerdict {
  if (data.solution === 'press') return 'solve';
  if (data.solution === 'cut-press' && data.wireCut) return 'solve'; // step 2 of 2
  return 'strike';
}
