import { makeSeededRng } from '../../seeding/index.js';
import {
  PASSWORD_WORDS,
  COLUMN_COUNT,
  LETTERS_PER_COLUMN,
  type PasswordsState,
} from './types.js';
import { countSpellableWords, isValidPassword } from './solve.js';

/** a-z, the alphabet fillers are drawn from (lowercase to match PASSWORD_WORDS). */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Pure, seeded instance generator — the ONLY place randomness is allowed, and
 * only via makeSeededRng (Math.random is banned project-wide). Synchronous and
 * CPU-cheap (called for all modules at round start).
 *
 * Algorithm:
 *  1. Pick a target word from PASSWORD_WORDS (seeded).
 *  2. For each column, place the target letter at a seeded random slot and fill
 *     the other five slots with seeded random letters.
 *  3. Verify with countSpellableWords that EXACTLY ONE listed word is reachable
 *     (AC1 — the real risk: a filler can accidentally enable a second listed
 *     word, since the 35 words share many letters). If not unique, re-roll the
 *     fillers from the SAME seeded stream and re-check. Deterministic given the
 *     seed; expected count is barely above 1, so re-rolls are rare.
 *  4. Choose seeded random start positions, re-rolling until the shown word is
 *     NOT a listed word — the Defuser must cycle, and the module must never be
 *     born already spelling the (unique) solution. Store them as startPositions
 *     for a faithful MODULE_RESET.
 *
 * The answer is NOT stored: SUBMIT recomputes the shown word and checks list
 * membership (wires AI1). `ctx` is unused — Passwords has no bomb-context rule.
 */
export function generatePasswords(seed: number): PasswordsState {
  const rng = makeSeededRng(seed); // asserts non-negative integer seed
  const randInt = (n: number): number => Math.floor(rng() * n);

  const target = PASSWORD_WORDS[randInt(PASSWORD_WORDS.length)];

  // Re-roll the fillers (deterministically, from the same stream) until exactly
  // one listed word is spellable. The cap is a safety net only — the expected
  // count is ~1, so the first roll almost always wins.
  let columns: string[][] = [];
  for (let attempt = 0; attempt < 10000; attempt++) {
    columns = [];
    for (let i = 0; i < COLUMN_COUNT; i++) {
      const slots: string[] = new Array(LETTERS_PER_COLUMN);
      const targetSlot = randInt(LETTERS_PER_COLUMN);
      for (let j = 0; j < LETTERS_PER_COLUMN; j++) {
        slots[j] = j === targetSlot ? target[i] : ALPHABET[randInt(ALPHABET.length)];
      }
      columns.push(slots);
    }
    if (countSpellableWords(columns) === 1) break;
  }

  /* istanbul ignore next -- unreachable: expected spellable count is ~1 */
  if (countSpellableWords(columns) !== 1) {
    throw new Error('passwords: could not generate a unique-solution instance');
  }

  // Re-roll start positions (deterministically) until the shown word is NOT a
  // listed word, so the module is never born already solved. Only the target is
  // spellable from these columns, so the loop just avoids the rare case where the
  // random starts coincide with the target letter in every column.
  let startPositions: number[] = [];
  for (let attempt = 0; attempt < 10000; attempt++) {
    startPositions = Array.from({ length: COLUMN_COUNT }, () => randInt(LETTERS_PER_COLUMN));
    const shown = columns.map((col, i) => col[startPositions[i]]).join('');
    if (!isValidPassword(shown)) break;
  }

  return {
    columns,
    positions: startPositions,
    startPositions,
  };
}
