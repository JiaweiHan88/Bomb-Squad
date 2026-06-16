import { PASSWORD_WORDS, type PasswordsState } from './types.js';

/**
 * Pure solver helpers — all read the single shared PASSWORD_WORDS constant, so
 * the generator's uniqueness check, the reducer's SUBMIT validation, and the
 * manual cannot disagree about what counts as a valid word.
 */

/** The word currently shown across the columns (one letter per column). */
export function currentWord(state: PasswordsState): string {
  return state.positions.map((p, i) => state.columns[i][p]).join('');
}

/** Membership test against the public 35-word valid list. */
export function isValidPassword(word: string): boolean {
  return (PASSWORD_WORDS as readonly string[]).includes(word);
}

/**
 * How many of the 35 valid words are spellable from these columns — a word is
 * spellable iff, for every position, its letter is present in that column. The
 * generator requires this to be EXACTLY 1 (AC1: a unique solution). Pure and
 * CPU-cheap (35 words × 5 columns × 6 letters).
 */
export function countSpellableWords(columns: ReadonlyArray<ReadonlyArray<string>>): number {
  let count = 0;
  for (const word of PASSWORD_WORDS) {
    let spellable = true;
    for (let i = 0; i < word.length; i++) {
      if (!columns[i] || !columns[i].includes(word[i])) {
        spellable = false;
        break;
      }
    }
    if (spellable) count++;
  }
  return count;
}
