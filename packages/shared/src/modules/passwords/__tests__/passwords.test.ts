import type { ModuleState } from '../../../types/index.js';
import {
  PASSWORDS_MODULE_ID,
  PASSWORD_WORDS,
  COLUMN_COUNT,
  LETTERS_PER_COLUMN,
  isPasswordsAction,
  type PasswordsState,
  type PasswordsAction,
} from '../types.js';
import { generatePasswords } from '../generate.js';
import { currentWord, isValidPassword, countSpellableWords } from '../solve.js';
import { passwordsReducer } from '../reducer.js';
import { getPasswordsManualPages } from '../manual.js';

/** Deep-frozen armed envelope (immutability gate). */
const armed = (data: PasswordsState): ModuleState<PasswordsState> => {
  data.columns.forEach((c) => Object.freeze(c));
  Object.freeze(data.columns);
  Object.freeze(data.positions);
  Object.freeze(data.startPositions);
  Object.freeze(data);
  return Object.freeze({ moduleId: PASSWORDS_MODULE_ID, status: 'armed', data });
};

/** Build a state whose columns can spell `word`, with positions pointing AT it
 *  unless overridden. Filler letters never accidentally spell another word
 *  because each column carries only `word`'s letter + 'z' (z is in no list word
 *  except none — 'z' never appears, so no spurious word). */
const stateForWord = (
  word: string,
  positions?: number[],
): ModuleState<PasswordsState> => {
  const columns = word.split('').map((ch) => [ch, 'z', 'z', 'z', 'z', 'z']);
  const pos = positions ?? new Array(COLUMN_COUNT).fill(0);
  return armed({ columns, positions: pos, startPositions: [...pos] });
};

const cycle = (columnIndex: number, direction: 'up' | 'down'): PasswordsAction => ({
  type: 'CYCLE',
  columnIndex,
  direction,
});
const submit: PasswordsAction = { type: 'SUBMIT' };

describe('PASSWORD_WORDS — word-list integrity', () => {
  it('has exactly 35 words', () => {
    expect(PASSWORD_WORDS).toHaveLength(35);
  });

  it('every entry is 5 lowercase letters', () => {
    for (const w of PASSWORD_WORDS) {
      expect(w).toMatch(/^[a-z]{5}$/);
    }
  });

  it('the list is unique (no duplicates)', () => {
    expect(new Set(PASSWORD_WORDS).size).toBe(PASSWORD_WORDS.length);
  });
});

describe('generatePasswords — determinism + uniqueness (AC1)', () => {
  it('is deterministic: the same seed produces deep-equal state', () => {
    expect(generatePasswords(42)).toEqual(generatePasswords(42));
  });

  it('different seeds eventually produce different instances', () => {
    const first = JSON.stringify(generatePasswords(0));
    const anyDiffers = [1, 2, 3, 4, 5, 6, 7, 8].some(
      (seed) => JSON.stringify(generatePasswords(seed)) !== first,
    );
    expect(anyDiffers).toBe(true);
  });

  it('produces 5 columns of 6 lowercase letters and 5 in-range positions', () => {
    for (const seed of [0, 1, 7, 99, 1000, 123456]) {
      const s = generatePasswords(seed);
      expect(s.columns).toHaveLength(COLUMN_COUNT);
      expect(s.positions).toHaveLength(COLUMN_COUNT);
      expect(s.startPositions).toEqual(s.positions);
      for (const col of s.columns) {
        expect(col).toHaveLength(LETTERS_PER_COLUMN);
        for (const ch of col) expect(ch).toMatch(/^[a-z]$/);
      }
      for (const p of s.positions) {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(LETTERS_PER_COLUMN);
      }
    }
  });

  it('EXACTLY ONE listed word is spellable for every seed in a wide sweep (AC1)', () => {
    for (let seed = 0; seed < 400; seed++) {
      expect(countSpellableWords(generatePasswords(seed).columns)).toBe(1);
    }
  });

  it('is never born already spelling the solution — the shown word is not a listed word (AC1)', () => {
    for (let seed = 0; seed < 400; seed++) {
      expect(isValidPassword(currentWord(generatePasswords(seed)))).toBe(false);
    }
  });

  it('never calls Math.random (seeded RNG only)', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random is banned in module generation');
    };
    try {
      expect(() => generatePasswords(7)).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});

describe('solve helpers', () => {
  it('currentWord reads one letter per column at its position', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    expect(currentWord(s.data)).toBe('about');
  });

  it('currentWord reflects cycled positions', () => {
    const data: PasswordsState = {
      columns: [['a', 'x'], ['b', 'x'], ['o', 'x'], ['u', 'x'], ['t', 'x']],
      positions: [1, 1, 1, 1, 1],
      startPositions: [1, 1, 1, 1, 1],
    };
    expect(currentWord(data)).toBe('xxxxx');
  });

  it('isValidPassword is exact list membership', () => {
    expect(isValidPassword('about')).toBe(true);
    expect(isValidPassword('write')).toBe(true);
    expect(isValidPassword('zzzzz')).toBe(false);
    expect(isValidPassword('abou')).toBe(false);
    expect(isValidPassword('ABOUT')).toBe(false); // case-sensitive
  });

  it('countSpellableWords counts every listed word reachable from the columns', () => {
    // Columns carrying both "about" and "after": column letters are the union.
    const columns = [
      ['a'],
      ['b', 'f'],
      ['o', 't'],
      ['u', 'e'],
      ['t', 'r'],
    ];
    // about: a,b,o,u,t — all present. after: a,f,t,e,r — all present. → 2.
    expect(countSpellableWords(columns)).toBe(2);
  });

  it('countSpellableWords returns 0 when no listed word is reachable', () => {
    expect(countSpellableWords([['z'], ['z'], ['z'], ['z'], ['z']])).toBe(0);
  });
});

describe('passwordsReducer — contract obligations (frozen inputs throughout)', () => {
  it('CYCLE up advances the column position by 1', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    const next = passwordsReducer(s, cycle(2, 'up'));
    expect(next.data.positions[2]).toBe(1);
    expect(next.status).toBe('armed');
  });

  it('CYCLE down wraps with a non-negative modulo (0 → 5)', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    const next = passwordsReducer(s, cycle(0, 'down'));
    expect(next.data.positions[0]).toBe(LETTERS_PER_COLUMN - 1);
  });

  it('CYCLE up wraps at the top (5 → 0)', () => {
    const s = stateForWord('about', [5, 0, 0, 0, 0]);
    const next = passwordsReducer(s, cycle(0, 'up'));
    expect(next.data.positions[0]).toBe(0);
  });

  it('CYCLE only moves the targeted column', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    const next = passwordsReducer(s, cycle(3, 'up'));
    expect(next.data.positions).toEqual([0, 0, 0, 1, 0]);
  });

  it('SUBMIT on a valid word solves', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    expect(passwordsReducer(s, submit).status).toBe('solved');
  });

  it('SUBMIT on a non-listed word strikes and leaves the columns unchanged', () => {
    const s = stateForWord('about', [1, 0, 0, 0, 0]); // shows "zbout" — not listed
    const next = passwordsReducer(s, submit);
    expect(next.status).toBe('struck');
    expect(next.data.positions).toEqual(s.data.positions);
    expect(next.data.columns).toEqual(s.data.columns);
  });

  it('happy path: cycle to the word, then SUBMIT solves', () => {
    // Column 0 has 'a' at index 2; rest spell "bout" at index 0.
    const data: PasswordsState = {
      columns: [
        ['x', 'y', 'a', 'z', 'z', 'z'],
        ['b', 'z', 'z', 'z', 'z', 'z'],
        ['o', 'z', 'z', 'z', 'z', 'z'],
        ['u', 'z', 'z', 'z', 'z', 'z'],
        ['t', 'z', 'z', 'z', 'z', 'z'],
      ],
      positions: [0, 0, 0, 0, 0],
      startPositions: [0, 0, 0, 0, 0],
    };
    let s: ModuleState<PasswordsState> = armed(data);
    expect(passwordsReducer(s, submit).status).toBe('struck'); // "xbout" wrong
    s = passwordsReducer(s, cycle(0, 'up'));
    s = passwordsReducer(s, cycle(0, 'up')); // 0→1→2 → 'a'
    expect(currentWord(s.data)).toBe('about');
    expect(passwordsReducer(s, submit).status).toBe('solved');
  });

  it('out-of-bounds / NaN columnIndex falls through unchanged (guard)', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    expect(passwordsReducer(s, cycle(-1, 'up'))).toBe(s);
    expect(passwordsReducer(s, cycle(5, 'up'))).toBe(s);
    expect(passwordsReducer(s, cycle(99, 'up'))).toBe(s);
    expect(passwordsReducer(s, cycle(NaN, 'up'))).toBe(s);
    expect(passwordsReducer(s, cycle(1.5, 'up'))).toBe(s);
  });

  it('unknown / malformed actions fall through unchanged (guard, no throw)', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    expect(passwordsReducer(s, { type: 'WAT' })).toBe(s);
    expect(passwordsReducer(s, { type: 'CYCLE', columnIndex: 0 })).toBe(s); // no direction
    expect(passwordsReducer(s, { type: 'CYCLE', columnIndex: 0, direction: 'left' })).toBe(s);
    expect(passwordsReducer(s, { type: 'CYCLE', columnIndex: 'x', direction: 'up' })).toBe(s);
    expect(passwordsReducer(s, null)).toBe(s);
    expect(passwordsReducer(s, undefined)).toBe(s);
  });

  it('solved module is inert to CYCLE / SUBMIT', () => {
    const solved = Object.freeze({
      moduleId: PASSWORDS_MODULE_ID,
      status: 'solved' as const,
      data: stateForWord('about', [0, 0, 0, 0, 0]).data,
    });
    expect(passwordsReducer(solved, cycle(0, 'up'))).toBe(solved);
    expect(passwordsReducer(solved, submit)).toBe(solved);
  });

  it('MODULE_RESET restores the generated start positions and re-arms', () => {
    const struck = Object.freeze({
      moduleId: PASSWORDS_MODULE_ID,
      status: 'struck' as const,
      data: Object.freeze({
        columns: 'about'.split('').map((ch) => Object.freeze([ch, 'z', 'z', 'z', 'z', 'z'])),
        positions: Object.freeze([3, 4, 1, 2, 5]),
        startPositions: Object.freeze([0, 0, 0, 0, 0]),
      }),
    });
    const next = passwordsReducer(struck, { type: 'MODULE_RESET' });
    expect(next.status).toBe('armed');
    expect(next.data.positions).toEqual([0, 0, 0, 0, 0]);
    expect(next.data.columns).toEqual(struck.data.columns); // layout preserved
  });

  it('MODULE_RESET on an already-armed module at its start is a structural no-op', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    expect(passwordsReducer(s, { type: 'MODULE_RESET' })).toBe(s);
  });

  it('never mutates a frozen input state (immutability gate)', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    expect(() => passwordsReducer(s, cycle(0, 'up'))).not.toThrow();
    expect(() => passwordsReducer(s, cycle(0, 'down'))).not.toThrow();
    expect(() => passwordsReducer(s, submit)).not.toThrow();
    expect(s.data.positions[0]).toBe(0); // original untouched
  });

  it('full loop is idempotent after solve (repeat actions no-op)', () => {
    const s = stateForWord('about', [0, 0, 0, 0, 0]);
    const solved = passwordsReducer(s, submit);
    expect(solved.status).toBe('solved');
    expect(passwordsReducer(Object.freeze(solved), submit)).toBe(solved);
    expect(passwordsReducer(Object.freeze(solved), cycle(0, 'up'))).toBe(solved);
  });
});

describe('isPasswordsAction', () => {
  it('accepts SUBMIT, MODULE_RESET, and well-formed CYCLE', () => {
    expect(isPasswordsAction({ type: 'SUBMIT' })).toBe(true);
    expect(isPasswordsAction({ type: 'MODULE_RESET' })).toBe(true);
    expect(isPasswordsAction({ type: 'CYCLE', columnIndex: 0, direction: 'up' })).toBe(true);
    expect(isPasswordsAction({ type: 'CYCLE', columnIndex: 4, direction: 'down' })).toBe(true);
  });

  it('rejects malformed actions', () => {
    expect(isPasswordsAction({ type: 'CYCLE', columnIndex: 0 })).toBe(false);
    expect(isPasswordsAction({ type: 'CYCLE', columnIndex: '0', direction: 'up' })).toBe(false);
    expect(isPasswordsAction({ type: 'CYCLE', columnIndex: 0, direction: 'left' })).toBe(false);
    expect(isPasswordsAction({ type: 'CUT', wireIndex: 0 })).toBe(false);
    expect(isPasswordsAction(null)).toBe(false);
    expect(isPasswordsAction({})).toBe(false);
  });
});

describe('getPasswordsManualPages — generated from the same word list as the solver', () => {
  const pages = getPasswordsManualPages();

  it('is a single passwords chapter', () => {
    expect(pages).toHaveLength(1);
    expect(pages[0].chapterId).toBe(PASSWORDS_MODULE_ID);
  });

  it('lists exactly PASSWORD_WORDS (manual ↔ solver share the constant)', () => {
    const table = pages[0].sections.find((s) => s.table)?.table;
    expect(table).toBeDefined();
    const listed = table!.rows.flat().filter((cell) => cell.length > 0);
    expect(listed).toEqual([...PASSWORD_WORDS]);
  });
});
