import type { PlayerRole } from '@bomb-squad/shared';

/**
 * Pure logic for the 6-cell join-code input (EXPERIENCE.md component contract:
 * auto-uppercase, paste split per cell, submit on the 6th character). The
 * component stays a dumb renderer — all cell-state transitions live here so
 * they can be unit-tested without a DOM (2.1 testing posture).
 *
 * Cells are always a length-6 string[] ('' = empty). Functions return new
 * arrays; inputs are never mutated.
 */

export const CODE_LENGTH = 6;

export const EMPTY_CELLS: readonly string[] = Object.freeze(Array(CODE_LENGTH).fill(''));

/** Uppercase and strip to the join-code charset [A-Z0-9]. */
export function sanitizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface CellsUpdate {
  cells: string[];
  /** Cell index that should receive focus after the update. */
  focusIndex: number;
}

/** Type one character into a cell; advance focus (clamped to the last cell). */
export function applyCharAt(cells: readonly string[], index: number, raw: string): CellsUpdate {
  const ch = sanitizeCode(raw).slice(0, 1);
  const next = [...cells];
  next[index] = ch;
  return { cells: next, focusIndex: ch === '' ? index : Math.min(index + 1, CODE_LENGTH - 1) };
}

/** Paste: sanitize, spread one char per cell from `index` (mockup behavior). */
export function applyPasteAt(cells: readonly string[], index: number, raw: string): CellsUpdate {
  const text = sanitizeCode(raw);
  const next = [...cells];
  for (let j = 0; j < text.length && index + j < CODE_LENGTH; j++) {
    next[index + j] = text[j];
  }
  return { cells: next, focusIndex: Math.min(index + text.length, CODE_LENGTH - 1) };
}

/** Backspace: clear the current cell, or retreat and clear when already empty. */
export function applyBackspaceAt(cells: readonly string[], index: number): CellsUpdate {
  const next = [...cells];
  if (next[index] !== '') {
    next[index] = '';
    return { cells: next, focusIndex: index };
  }
  if (index > 0) {
    next[index - 1] = '';
    return { cells: next, focusIndex: index - 1 };
  }
  return { cells: next, focusIndex: 0 };
}

export function isCodeComplete(cells: readonly string[]): boolean {
  return cells.length === CODE_LENGTH && cells.every((c) => c !== '');
}

/**
 * Local mirror of the server's SESSION_JOIN validation so a payload that
 * passes here never bounces off INVALID_PAYLOAD.
 */
export function isJoinReady(
  cells: readonly string[],
  name: string,
  role: PlayerRole | null,
): boolean {
  const trimmed = name.trim();
  return (
    isCodeComplete(cells) &&
    trimmed.length >= 1 &&
    trimmed.length <= 24 &&
    role !== null &&
    role !== 'facilitator'
  );
}
