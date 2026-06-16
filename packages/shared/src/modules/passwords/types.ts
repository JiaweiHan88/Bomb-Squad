/**
 * passwords — The Passwords module (Story 5.5, FR23).
 *
 * Five letter columns, each cycleable through six letters. The five visible
 * letters must spell one of a fixed list of 35 valid words; the team cycles the
 * columns until the visible word is on the list, then SUBMITs.
 *
 * No stored answer (wires AI1 / the-button convention): the "answer" is public —
 * it is whichever listed word the generated columns can spell, and generation
 * guarantees EXACTLY one is reachable. SUBMIT recomputes the currently-shown word
 * and checks list membership; nothing secret rides in state and nothing secret
 * crosses to the client (the 35-word list is public manual content).
 *
 * Unlike the-button there is no live-timer dependency and no colour — Passwords
 * is pure cycle + submit, validated against a public word list.
 */

/** Module identifier — kebab-case (project naming convention). */
export const PASSWORDS_MODULE_ID = 'passwords';

/** Each column shows one of six cycleable letters; there are five columns. */
export const COLUMN_COUNT = 5;
export const LETTERS_PER_COLUMN = 6;

/**
 * The canonical KTANE Passwords 35-word valid list — 5-letter, lowercase. The
 * SINGLE source of truth shared by the generator (picks a target), the solver
 * (membership check), and the manual (renders the list). One constant, three
 * consumers, so they cannot diverge.
 */
export const PASSWORD_WORDS = [
  'about', 'after', 'again', 'below', 'could',
  'every', 'first', 'found', 'great', 'house',
  'large', 'learn', 'never', 'other', 'place',
  'plant', 'point', 'right', 'small', 'sound',
  'spell', 'still', 'study', 'their', 'there',
  'these', 'thing', 'think', 'three', 'water',
  'where', 'which', 'world', 'would', 'write',
] as const;

export type PasswordWord = (typeof PASSWORD_WORDS)[number];

export interface PasswordsState {
  /** `columns[i]` is column i's six cycleable letters (lowercase). */
  readonly columns: ReadonlyArray<ReadonlyArray<string>>;
  /** `positions[i]` is the currently-shown index into `columns[i]`. */
  readonly positions: ReadonlyArray<number>;
  /**
   * The generated start positions, kept so MODULE_RESET restores the exact
   * instance the team began with (faithful reset). Never the solution — the
   * Defuser must still cycle to a valid word.
   */
  readonly startPositions: ReadonlyArray<number>;
}

/**
 * Defuser actions. CYCLE advances one column up/down by a single click; SUBMIT
 * validates the currently-shown word. Actions reach the reducer as `unknown`.
 */
export type PasswordsAction =
  | { type: 'CYCLE'; columnIndex: number; direction: 'up' | 'down' }
  | { type: 'SUBMIT' };

/** Lifecycle action forwarded whole by the bomb reducer (see types/actions.ts). */
export type PasswordsReset = { type: 'MODULE_RESET' };

/** Runtime guard: actions reach reducers as `unknown` (untrusted input). */
export function isPasswordsAction(action: unknown): action is PasswordsAction | PasswordsReset {
  if (typeof action !== 'object' || action === null || !('type' in action)) return false;
  const type = (action as { type: unknown }).type;
  if (type === 'MODULE_RESET' || type === 'SUBMIT') return true;
  if (type !== 'CYCLE') return false;
  const a = action as { columnIndex?: unknown; direction?: unknown };
  return typeof a.columnIndex === 'number' && (a.direction === 'up' || a.direction === 'down');
}
