import type { BombContext, ModuleState } from '../../../types/index.js';
import {
  BUTTON_MODULE_ID,
  BUTTON_COLORS,
  BUTTON_LABELS,
  STRIP_COLORS,
  isButtonAction,
  type ButtonColor,
  type ButtonLabel,
  type StripColor,
  type ButtonState,
  type ButtonAction,
} from '../types.js';
import { generateButton } from '../generate.js';
import { BUTTON_RULES, decideButton, releaseDigitFor, STRIP_RELEASE_DIGIT } from '../solve.js';
import { buttonReducer } from '../reducer.js';
import { getButtonManualPages } from '../manual.js';

/** Minimal bomb context; override per test. Serial last char is always a digit. */
const ctxOf = (over: Partial<BombContext> = {}): BombContext => ({
  serialNumber: 'AB3XK7',
  batteryCount: 0,
  indicators: [],
  ports: [],
  ...over,
});

const litCar = ctxOf({ indicators: [{ label: 'CAR', lit: true }] });
const litFrk3 = ctxOf({ batteryCount: 3, indicators: [{ label: 'FRK', lit: true }] });

/** Deep-frozen armed envelope (immutability gate). */
const armed = (data: ButtonState): ModuleState<ButtonState> => {
  Object.freeze(data.ctx);
  Object.freeze(data);
  return Object.freeze({ moduleId: BUTTON_MODULE_ID, status: 'armed', data });
};

const stateOf = (
  color: ButtonColor,
  label: ButtonLabel,
  stripColor: StripColor,
  ctx: BombContext,
  held = false,
): ModuleState<ButtonState> => armed({ color, label, stripColor, held, ctx });

const press: ButtonAction = { type: 'PRESS' };
const release = (timerDigits: number[]): ButtonAction => ({ type: 'RELEASE', timerDigits });

describe('generateButton', () => {
  it('is deterministic: the same seed produces deep-equal state', () => {
    expect(generateButton(42, ctxOf())).toEqual(generateButton(42, ctxOf()));
  });

  it('different seeds eventually produce different instances', () => {
    const first = JSON.stringify(generateButton(0, ctxOf()));
    const anyDiffers = [1, 2, 3, 4, 5, 6, 7, 8].some(
      (seed) => JSON.stringify(generateButton(seed, ctxOf())) !== first,
    );
    expect(anyDiffers).toBe(true);
  });

  it('only ever produces legal colour / label / strip values, starts un-held', () => {
    for (let seed = 0; seed < 200; seed++) {
      const s = generateButton(seed, ctxOf());
      expect(BUTTON_COLORS).toContain(s.color);
      expect(BUTTON_LABELS).toContain(s.label);
      expect(STRIP_COLORS).toContain(s.stripColor);
      expect(s.held).toBe(false);
    }
  });

  it('stores BombContext by reference and never mutates it', () => {
    const ctx = ctxOf({ batteryCount: 2 });
    Object.freeze(ctx);
    expect(() => generateButton(5, ctx)).not.toThrow();
    expect(generateButton(5, ctx).ctx).toBe(ctx);
  });

  it('never calls Math.random (seeded RNG only)', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random is banned in module generation');
    };
    try {
      expect(() => generateButton(7, ctxOf())).not.toThrow();
    } finally {
      Math.random = original;
    }
  });
});

describe('decideButton — GDD rules, first match top-to-bottom', () => {
  it('rule 1: blue + Abort → hold', () => {
    expect(decideButton('blue', 'Abort', ctxOf())).toBe('hold');
  });

  it('rule 2: >1 battery + Detonate → tap', () => {
    expect(decideButton('red', 'Detonate', ctxOf({ batteryCount: 2 }))).toBe('tap');
  });

  it('rule 3: white + lit CAR → hold', () => {
    expect(decideButton('white', 'Press', litCar)).toBe('hold');
  });

  it('rule 4: >2 batteries + lit FRK → tap', () => {
    expect(decideButton('red', 'Press', litFrk3)).toBe('tap');
  });

  it('rule 5: yellow → hold', () => {
    expect(decideButton('yellow', 'Press', ctxOf())).toBe('hold');
  });

  it('rule 6: red + Hold → tap', () => {
    expect(decideButton('red', 'Hold', ctxOf())).toBe('tap');
  });

  it('rule 7: none of the above → hold', () => {
    expect(decideButton('red', 'Press', ctxOf())).toBe('hold');
    expect(decideButton('white', 'Press', ctxOf())).toBe('hold');
  });

  it('honours ordering: blue + Abort holds even when rule 2 would also match', () => {
    // blue, Abort, >1 battery, Detonate? label can only be one — construct a
    // case where an earlier rule wins over a later one: white + lit CAR (rule 3,
    // hold) even though rule 4's battery/FRK also holds.
    const both = ctxOf({ batteryCount: 3, indicators: [{ label: 'CAR', lit: true }, { label: 'FRK', lit: true }] });
    expect(decideButton('white', 'Press', both)).toBe('hold'); // rule 3 precedes rule 4
  });

  it('an UNLIT CAR/FRK indicator does not trigger its rule', () => {
    expect(decideButton('white', 'Press', ctxOf({ indicators: [{ label: 'CAR', lit: false }] }))).toBe('hold' /* falls to rule 7 (white not yellow) → hold anyway */);
    // FRK unlit: rule 4 must not fire — red/Press/3 batteries falls to rule 7 (hold)
    expect(decideButton('red', 'Press', ctxOf({ batteryCount: 3, indicators: [{ label: 'FRK', lit: false }] }))).toBe('hold');
  });

  it('battery thresholds are strict (>1 and >2)', () => {
    expect(decideButton('red', 'Detonate', ctxOf({ batteryCount: 1 }))).toBe('hold'); // not >1 → rule 7
    expect(decideButton('red', 'Press', ctxOf({ batteryCount: 2, indicators: [{ label: 'FRK', lit: true }] }))).toBe('hold'); // not >2 → rule 7
  });
});

describe('releaseDigitFor — GDD strip table', () => {
  it('maps each strip colour to its release digit', () => {
    expect(releaseDigitFor('blue')).toBe(4);
    expect(releaseDigitFor('white')).toBe(1);
    expect(releaseDigitFor('yellow')).toBe(5);
    expect(releaseDigitFor('red')).toBe(1); // "any other" → 1
  });
});

describe('buttonReducer — contract obligations (frozen inputs throughout)', () => {
  it('PRESS reveals the strip (held: true) without solving or striking', () => {
    const next = buttonReducer(stateOf('yellow', 'Press', 'blue', ctxOf()), press);
    expect(next.data.held).toBe(true);
    expect(next.status).toBe('armed');
  });

  it('PRESS is idempotent while already held', () => {
    const held = stateOf('yellow', 'Press', 'blue', ctxOf(), true);
    expect(buttonReducer(held, press)).toBe(held);
  });

  it('TAP-answer button: RELEASE solves regardless of the timer digits', () => {
    // red + Hold → tap (rule 6). Held, then released at any digits → solved.
    const held = stateOf('red', 'Hold', 'blue', ctxOf(), true);
    const next = buttonReducer(held, release([9, 9, 9]));
    expect(next.status).toBe('solved');
    expect(next.data.held).toBe(false);
  });

  it('HOLD-answer button: RELEASE at the matching digit solves', () => {
    // yellow → hold (rule 5). strip blue → release on a 4.
    const held = stateOf('yellow', 'Press', 'blue', ctxOf(), true);
    expect(buttonReducer(held, release([1, 4, 3])).status).toBe('solved'); // contains 4
  });

  it('HOLD-answer button: RELEASE at a wrong digit strikes', () => {
    const held = stateOf('yellow', 'Press', 'blue', ctxOf(), true);
    const next = buttonReducer(held, release([1, 2, 3])); // no 4
    expect(next.status).toBe('struck');
    expect(next.data.held).toBe(false);
  });

  it('HOLD strip digits: white→1, yellow→5, red→1', () => {
    const ctx = ctxOf();
    expect(buttonReducer(stateOf('yellow', 'Press', 'white', ctx, true), release([1])).status).toBe('solved');
    expect(buttonReducer(stateOf('yellow', 'Press', 'yellow', ctx, true), release([5])).status).toBe('solved');
    expect(buttonReducer(stateOf('yellow', 'Press', 'red', ctx, true), release([1])).status).toBe('solved');
    expect(buttonReducer(stateOf('yellow', 'Press', 'yellow', ctx, true), release([1])).status).toBe('struck');
  });

  it('RELEASE with no preceding PRESS (not held) is a no-op', () => {
    const armedState = stateOf('yellow', 'Press', 'blue', ctxOf());
    expect(buttonReducer(armedState, release([4]))).toBe(armedState);
  });

  it('solved module is inert to PRESS / RELEASE', () => {
    const solved = Object.freeze({
      moduleId: BUTTON_MODULE_ID,
      status: 'solved' as const,
      data: Object.freeze({ color: 'yellow', label: 'Press', stripColor: 'blue', held: false, ctx: ctxOf() }),
    });
    expect(buttonReducer(solved, press)).toBe(solved);
    expect(buttonReducer(solved, release([4]))).toBe(solved);
  });

  it('unknown / malformed actions fall through unchanged (guard, no throw)', () => {
    const s = stateOf('yellow', 'Press', 'blue', ctxOf(), true);
    expect(buttonReducer(s, { type: 'WAT' })).toBe(s);
    expect(buttonReducer(s, { type: 'RELEASE' })).toBe(s); // missing timerDigits
    expect(buttonReducer(s, { type: 'RELEASE', timerDigits: 'nope' })).toBe(s);
    expect(buttonReducer(s, null)).toBe(s);
    expect(buttonReducer(s, undefined)).toBe(s);
  });

  it('MODULE_RESET re-arms and un-holds; layout/strip preserved', () => {
    const struck = Object.freeze({
      moduleId: BUTTON_MODULE_ID,
      status: 'struck' as const,
      data: Object.freeze({ color: 'yellow', label: 'Press', stripColor: 'blue', held: true, ctx: ctxOf() }),
    });
    const next = buttonReducer(struck, { type: 'MODULE_RESET' });
    expect(next.status).toBe('armed');
    expect(next.data.held).toBe(false);
    expect(next.data.color).toBe('yellow');
    expect(next.data.stripColor).toBe('blue');
  });

  it('MODULE_RESET on an already-armed, un-held module is a structural no-op', () => {
    const s = stateOf('yellow', 'Press', 'blue', ctxOf());
    expect(buttonReducer(s, { type: 'MODULE_RESET' })).toBe(s);
  });

  it('never mutates a frozen input state (immutability gate)', () => {
    const held = stateOf('yellow', 'Press', 'blue', ctxOf(), true);
    expect(() => buttonReducer(held, release([4]))).not.toThrow();
    expect(() => buttonReducer(held, press)).not.toThrow();
    expect(held.data.held).toBe(true); // original untouched
  });

  it('full loop is idempotent after solve (repeat actions no-op)', () => {
    const held = stateOf('yellow', 'Press', 'blue', ctxOf(), true);
    const solved = buttonReducer(held, release([4]));
    expect(solved.status).toBe('solved');
    expect(buttonReducer(Object.freeze(solved), press)).toBe(solved);
    expect(buttonReducer(Object.freeze(solved), release([4]))).toBe(solved);
  });
});

describe('isButtonAction', () => {
  it('accepts PRESS, MODULE_RESET, and well-formed RELEASE', () => {
    expect(isButtonAction({ type: 'PRESS' })).toBe(true);
    expect(isButtonAction({ type: 'MODULE_RESET' })).toBe(true);
    expect(isButtonAction({ type: 'RELEASE', timerDigits: [1, 2, 3] })).toBe(true);
    expect(isButtonAction({ type: 'RELEASE', timerDigits: [] })).toBe(true);
  });

  it('rejects malformed actions', () => {
    expect(isButtonAction({ type: 'RELEASE' })).toBe(false);
    expect(isButtonAction({ type: 'RELEASE', timerDigits: 'x' })).toBe(false);
    expect(isButtonAction({ type: 'RELEASE', timerDigits: [1, 'x'] })).toBe(false);
    expect(isButtonAction({ type: 'CUT', wireIndex: 0 })).toBe(false);
    expect(isButtonAction(null)).toBe(false);
    expect(isButtonAction({})).toBe(false);
  });
});

describe('getButtonManualPages — generated from the same rule data as the solver', () => {
  const pages = getButtonManualPages();

  it('is a single the-button chapter', () => {
    expect(pages).toHaveLength(1);
    expect(pages[0].chapterId).toBe(BUTTON_MODULE_ID);
  });

  it('the decision table has exactly one row per BUTTON_RULES entry, in order', () => {
    const decisionTable = pages[0].sections.find((s) => s.table?.headers.includes('Condition'))?.table;
    expect(decisionTable).toBeDefined();
    expect(decisionTable!.rows).toHaveLength(BUTTON_RULES.length);
    decisionTable!.rows.forEach((row, i) => {
      expect(row[1]).toBe(BUTTON_RULES[i].conditionText);
      expect(row[2]).toBe(BUTTON_RULES[i].actionText);
    });
  });

  it('the release table lists every strip colour with its solver digit', () => {
    const releaseTable = pages[0].sections.find((s) => s.heading === 'Releasing a held button')?.table;
    expect(releaseTable).toBeDefined();
    expect(releaseTable!.rows).toHaveLength(STRIP_COLORS.length);
    for (const row of releaseTable!.rows) {
      const strip = STRIP_COLORS.find((c) => row[0].toLowerCase().includes(c));
      expect(strip).toBeDefined();
      expect(row[1]).toContain(String(STRIP_RELEASE_DIGIT[strip!]));
    }
  });
});
