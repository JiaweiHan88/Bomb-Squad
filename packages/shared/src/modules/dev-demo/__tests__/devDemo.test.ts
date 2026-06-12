import type { BombContext, ModuleState } from '../../../types/index.js';
import {
  DEV_DEMO_MODULE_ID,
  type DevDemoState,
  type DevDemoAction,
  isDevDemoAction,
} from '../types.js';
import { generateDevDemo } from '../generate.js';
import { classifyCut, classifyRelease, solutionForLabel } from '../solve.js';
import { devDemoReducer } from '../reducer.js';
import { getDevDemoManualPages } from '../manual.js';

const CTX: BombContext = {
  serialNumber: 'AB3XK7',
  batteryCount: 2,
  indicators: [{ label: 'FRK', lit: true }],
  ports: ['Serial'],
};

/** Deterministically find a seed whose generated solution matches. */
const seedFor = (solution: DevDemoState['solution']): number => {
  for (let seed = 0; seed < 1000; seed++) {
    if (generateDevDemo(seed, CTX).solution === solution) return seed;
  }
  throw new Error(`no seed under 1000 produces solution ${solution}`);
};

/** Armed module envelope around generated data, deep-frozen (immutability gate). */
const armed = (solution: DevDemoState['solution']): ModuleState<DevDemoState> => {
  const data = generateDevDemo(seedFor(solution), CTX);
  const state: ModuleState<DevDemoState> = {
    moduleId: DEV_DEMO_MODULE_ID,
    status: 'armed',
    data,
  };
  Object.freeze(data);
  return Object.freeze(state);
};

const CUT: DevDemoAction = { type: 'CUT' };
const DOWN: DevDemoAction = { type: 'BUTTON_DOWN' };
const UP: DevDemoAction = { type: 'BUTTON_UP' };

describe('generateDevDemo', () => {
  it('is deterministic: the same seed produces deep-equal state', () => {
    expect(generateDevDemo(42, CTX)).toEqual(generateDevDemo(42, CTX));
  });

  it('different seeds eventually produce different instances', () => {
    const first = JSON.stringify(generateDevDemo(0, CTX));
    const anyDiffers = [1, 2, 3, 4, 5].some(
      (seed) => JSON.stringify(generateDevDemo(seed, CTX)) !== first,
    );
    expect(anyDiffers).toBe(true);
  });

  it('never calls Math.random (seeded RNG only)', () => {
    // Manual swap (the `jest` mock object is unavailable under ESM jest).
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random called inside generate');
    };
    try {
      expect(() => generateDevDemo(7, CTX)).not.toThrow();
    } finally {
      Math.random = original;
    }
  });

  it('threads BombContext into the instance: label ends with the serial last digit', () => {
    expect(generateDevDemo(13, CTX).label.endsWith('7')).toBe(true);
  });

  it('starts un-cut and un-held', () => {
    const data = generateDevDemo(99, CTX);
    expect(data.wireCut).toBe(false);
    expect(data.held).toBe(false);
  });

  it('derives the solution from the label via the manual rule (asymmetry key)', () => {
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const data = generateDevDemo(seed, CTX);
      expect(data.solution).toBe(solutionForLabel(data.label));
    }
  });

  it('rejects invalid seeds at the boundary (seed-chain contract)', () => {
    expect(() => generateDevDemo(-1, CTX)).toThrow(RangeError);
    expect(() => generateDevDemo(1.5, CTX)).toThrow(RangeError);
  });
});

describe('solutionForLabel (manual rule)', () => {
  it('maps the documented letter ranges', () => {
    expect(solutionForLabel('AX-3')).toBe('cut');
    expect(solutionForLabel('IX-3')).toBe('cut');
    expect(solutionForLabel('JX-3')).toBe('press');
    expect(solutionForLabel('RX-3')).toBe('press');
    expect(solutionForLabel('SX-3')).toBe('cut-press');
    expect(solutionForLabel('ZX-3')).toBe('cut-press');
  });
});

describe('solve classification', () => {
  it('cut solution: CUT solves, release strikes', () => {
    const data = generateDevDemo(seedFor('cut'), CTX);
    expect(classifyCut(data)).toBe('solve');
    expect(classifyRelease(data)).toBe('strike');
  });

  it('press solution: release solves, CUT strikes', () => {
    const data = generateDevDemo(seedFor('press'), CTX);
    expect(classifyRelease(data)).toBe('solve');
    expect(classifyCut(data)).toBe('strike');
  });

  it('cut-press solution: cut is progress, release solves only after the cut', () => {
    const data = generateDevDemo(seedFor('cut-press'), CTX);
    expect(classifyCut(data)).toBe('progress');
    expect(classifyRelease(data)).toBe('strike'); // press before cutting
    expect(classifyRelease({ ...data, wireCut: true })).toBe('solve');
  });
});

describe('isDevDemoAction', () => {
  it('accepts the action vocabulary including MODULE_RESET', () => {
    expect(isDevDemoAction(CUT)).toBe(true);
    expect(isDevDemoAction(DOWN)).toBe(true);
    expect(isDevDemoAction(UP)).toBe(true);
    expect(isDevDemoAction({ type: 'MODULE_RESET', moduleIndex: 0 })).toBe(true);
  });

  it('rejects malformed input', () => {
    expect(isDevDemoAction(null)).toBe(false);
    expect(isDevDemoAction(42)).toBe(false);
    expect(isDevDemoAction({ type: 'EXPLODE' })).toBe(false);
    expect(isDevDemoAction({})).toBe(false);
  });
});

describe('devDemoReducer', () => {
  describe('happy paths', () => {
    it("solution 'cut': CUT solves and severs the wire", () => {
      const next = devDemoReducer(armed('cut'), CUT);
      expect(next.status).toBe('solved');
      expect(next.data.wireCut).toBe(true);
    });

    it("solution 'press': BUTTON_DOWN then BUTTON_UP solves", () => {
      const held = devDemoReducer(armed('press'), DOWN);
      expect(held.status).toBe('armed');
      expect(held.data.held).toBe(true);
      const next = devDemoReducer(held, UP);
      expect(next.status).toBe('solved');
      expect(next.data.held).toBe(false);
    });

    it("solution 'cut-press': cut (progress, no strike) then press solves", () => {
      const cut = devDemoReducer(armed('cut-press'), CUT);
      expect(cut.status).toBe('armed'); // correct step, not solved, no strike
      expect(cut.data.wireCut).toBe(true);
      const held = devDemoReducer(cut, DOWN);
      const next = devDemoReducer(held, UP);
      expect(next.status).toBe('solved');
    });
  });

  describe('wrong interactions strike (transient struck)', () => {
    it("solution 'press': CUT strikes and severs the wire", () => {
      const next = devDemoReducer(armed('press'), CUT);
      expect(next.status).toBe('struck');
      expect(next.data.wireCut).toBe(true);
    });

    it("solution 'cut': completed press strikes", () => {
      const held = devDemoReducer(armed('cut'), DOWN);
      const next = devDemoReducer(held, UP);
      expect(next.status).toBe('struck');
      expect(next.data.held).toBe(false);
    });

    it("solution 'cut-press': pressing before cutting strikes", () => {
      const held = devDemoReducer(armed('cut-press'), DOWN);
      const next = devDemoReducer(held, UP);
      expect(next.status).toBe('struck');
    });
  });

  describe('idempotency', () => {
    it('CUT on an already-severed wire is a no-op', () => {
      const cut = devDemoReducer(armed('press'), CUT); // wrong cut → severed
      const rearmed: ModuleState<DevDemoState> = { ...cut, status: 'armed' }; // bomb-reducer roll-up
      expect(devDemoReducer(rearmed, CUT)).toBe(rearmed);
    });

    it('BUTTON_DOWN while already held is a no-op', () => {
      const held = devDemoReducer(armed('press'), DOWN);
      expect(devDemoReducer(held, DOWN)).toBe(held);
    });

    it('BUTTON_UP without a press is a no-op (guard)', () => {
      const state = armed('press');
      expect(devDemoReducer(state, UP)).toBe(state);
    });
  });

  describe('immutability', () => {
    it('never mutates a frozen input state', () => {
      const state = armed('cut');
      expect(() => devDemoReducer(state, CUT)).not.toThrow();
      expect(state.status).toBe('armed');
      expect(state.data.wireCut).toBe(false);
    });

    it('returns new objects on change, not patched input', () => {
      const state = armed('cut');
      const next = devDemoReducer(state, CUT);
      expect(next).not.toBe(state);
      expect(next.data).not.toBe(state.data);
    });
  });

  describe('guard clauses', () => {
    it('unknown action types fall through unchanged', () => {
      const state = armed('cut');
      expect(devDemoReducer(state, { type: 'EXPLODE' })).toBe(state);
    });

    it('non-object actions fall through unchanged (untrusted input)', () => {
      const state = armed('cut');
      expect(devDemoReducer(state, null)).toBe(state);
      expect(devDemoReducer(state, 42)).toBe(state);
      expect(devDemoReducer(state, 'CUT')).toBe(state);
    });

    it('a solved module is inert to further actions', () => {
      const solved = devDemoReducer(armed('cut'), CUT);
      expect(devDemoReducer(solved, CUT)).toBe(solved);
      expect(devDemoReducer(solved, DOWN)).toBe(solved);
    });
  });

  describe('MODULE_RESET', () => {
    it('restores armed, un-cut, un-held state (solved bypass)', () => {
      const solved = devDemoReducer(armed('cut'), CUT);
      const reset = devDemoReducer(solved, { type: 'MODULE_RESET', moduleIndex: 0 });
      expect(reset.status).toBe('armed');
      expect(reset.data.wireCut).toBe(false);
      expect(reset.data.held).toBe(false);
      expect(reset.data.solution).toBe(solved.data.solution); // instance identity preserved
    });
  });
});

describe('getDevDemoManualPages', () => {
  it('returns structured ManualPage data (not markup)', () => {
    const pages = getDevDemoManualPages();
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const page = pages[0];
    expect(page.chapterId).toBe(DEV_DEMO_MODULE_ID);
    expect(typeof page.chapterTitle).toBe('string');
    expect(page.sections.length).toBeGreaterThan(0);
    const table = page.sections.find((s) => s.table);
    expect(table?.table?.headers.length).toBeGreaterThan(0);
    expect(table?.table?.rows.length).toBe(3); // one row per solution
  });
});
