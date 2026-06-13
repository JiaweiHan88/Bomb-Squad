import type { BombContext, ModuleState } from '../../../types/index.js';
import {
  WIRES_MODULE_ID,
  WIRE_COLORS,
  WIRE_COLOR_LABELS,
  type WireColor,
  type WiresState,
  type WiresAction,
  isWiresAction,
} from '../types.js';
import { generateWires } from '../generate.js';
import { WIRES_RULES, solveWires } from '../solve.js';
import { wiresReducer } from '../reducer.js';
import { getWiresManualPages } from '../manual.js';

/** Serial ends in 7 → last digit ODD. */
const ODD_CTX: BombContext = {
  serialNumber: 'AB3XK7',
  batteryCount: 2,
  indicators: [{ label: 'FRK', lit: true }],
  ports: ['Serial'],
};

/** Serial ends in 4 → last digit EVEN. */
const EVEN_CTX: BombContext = { ...ODD_CTX, serialNumber: 'AB3XK4' };

const wiresOf = (colors: readonly WireColor[], cutAt: readonly number[] = []): WiresState['wires'] =>
  colors.map((color, i) => ({ color, cut: cutAt.includes(i) }));

/** Deep-frozen armed envelope around an explicit config (immutability gate). */
const armed = (colors: readonly WireColor[], ctx: BombContext): ModuleState<WiresState> => {
  const wires = wiresOf(colors);
  const data: WiresState = { wires, ctx };
  wires.forEach((w) => Object.freeze(w));
  Object.freeze(wires);
  Object.freeze(data);
  return Object.freeze({ moduleId: WIRES_MODULE_ID, status: 'armed', data });
};

const cut = (wireIndex: number): WiresAction => ({ type: 'CUT', wireIndex });

describe('generateWires', () => {
  it('is deterministic: the same seed produces deep-equal state', () => {
    expect(generateWires(42, ODD_CTX)).toEqual(generateWires(42, ODD_CTX));
  });

  it('different seeds eventually produce different instances', () => {
    const first = JSON.stringify(generateWires(0, ODD_CTX));
    const anyDiffers = [1, 2, 3, 4, 5].some(
      (seed) => JSON.stringify(generateWires(seed, ODD_CTX)) !== first,
    );
    expect(anyDiffers).toBe(true);
  });

  it('never calls Math.random (seeded RNG only)', () => {
    const original = Math.random;
    Math.random = () => {
      throw new Error('Math.random is banned in module generation');
    };
    try {
      expect(() => generateWires(7, ODD_CTX)).not.toThrow();
    } finally {
      Math.random = original;
    }
  });

  it('always produces 3–6 wires, legal colours, all uncut (seeds 0–199, both parities)', () => {
    for (const ctx of [ODD_CTX, EVEN_CTX]) {
      for (let seed = 0; seed < 200; seed++) {
        const { wires } = generateWires(seed, ctx);
        expect(wires.length).toBeGreaterThanOrEqual(3);
        expect(wires.length).toBeLessThanOrEqual(6);
        for (const wire of wires) {
          expect(WIRE_COLORS).toContain(wire.color);
          expect(wire.cut).toBe(false);
        }
      }
    }
  });

  it('covers every wire count 3–6 across seeds (no dead branch in the count range)', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 200; seed++) counts.add(generateWires(seed, ODD_CTX).wires.length);
    expect([...counts].sort()).toEqual([3, 4, 5, 6]);
  });

  it('stores the public ctx (not a pre-computed answer) and stays solvable (seeds incl. 0 and large)', () => {
    for (const ctx of [ODD_CTX, EVEN_CTX]) {
      for (const seed of [0, 1, 2, 17, 99, 2 ** 31 - 1]) {
        const state = generateWires(seed, ctx);
        // No answer is stored anywhere in module data — only wires + public ctx.
        expect(Object.keys(state).sort()).toEqual(['ctx', 'wires']);
        expect(state).not.toHaveProperty('solutionIndex');
        expect(state.ctx).toBe(ctx);
        // The layout is still solvable (every table ends in Otherwise).
        const solutionIndex = solveWires(state.wires.map((w) => w.color), state.ctx);
        expect(solutionIndex).toBeGreaterThanOrEqual(0);
        expect(solutionIndex).toBeLessThan(state.wires.length);
      }
    }
  });

  it('the stored ctx drives the answer: same wires, opposite serial parity → reducer solves a different wire', () => {
    // Find a seed where parity flips the answer — proves the ctx carried in
    // state (not a baked solutionIndex) is what the reducer recomputes against.
    let found = false;
    for (let seed = 0; seed < 500 && !found; seed++) {
      const odd = generateWires(seed, ODD_CTX);
      const even = generateWires(seed, EVEN_CTX);
      if (JSON.stringify(odd.wires) !== JSON.stringify(even.wires)) continue;
      const colors = odd.wires.map((w) => w.color);
      const oddAns = solveWires(colors, ODD_CTX);
      const evenAns = solveWires(colors, EVEN_CTX);
      if (oddAns === evenAns) continue;
      found = true;
      // Cutting the ODD answer solves the odd-ctx module but STRIKES the
      // even-ctx module — the recompute is governed by the stored ctx alone.
      const armOdd = Object.freeze({ moduleId: WIRES_MODULE_ID, status: 'armed' as const, data: odd });
      const armEven = Object.freeze({ moduleId: WIRES_MODULE_ID, status: 'armed' as const, data: even });
      expect(wiresReducer(armOdd, cut(oddAns)).status).toBe('solved');
      expect(wiresReducer(armEven, cut(oddAns)).status).toBe('struck');
    }
    expect(found).toBe(true);
  });
});

describe('solveWires — GDD rule tables, first match top-to-bottom', () => {
  // 3 wires
  it('3① no red → cut the 2nd', () => {
    expect(solveWires(['blue', 'white', 'blue'], ODD_CTX)).toBe(1);
  });
  it('3② last wire white → cut the last', () => {
    expect(solveWires(['red', 'blue', 'white'], ODD_CTX)).toBe(2);
  });
  it('3③ more than one blue → cut the last blue', () => {
    expect(solveWires(['blue', 'blue', 'red'], ODD_CTX)).toBe(1);
  });
  it('3④ otherwise → cut the last', () => {
    expect(solveWires(['red', 'blue', 'red'], ODD_CTX)).toBe(2);
  });

  // 4 wires
  it('4① >1 red AND serial odd → cut the last red', () => {
    expect(solveWires(['red', 'white', 'red', 'blue'], ODD_CTX)).toBe(2);
  });
  it('4① does NOT fire on even serial (falls through to ③ exactly-one-blue)', () => {
    expect(solveWires(['red', 'white', 'red', 'blue'], EVEN_CTX)).toBe(0);
  });
  it('4② last wire yellow AND no red → cut the 1st', () => {
    expect(solveWires(['blue', 'blue', 'white', 'yellow'], ODD_CTX)).toBe(0);
  });
  it('4③ exactly one blue → cut the 1st', () => {
    expect(solveWires(['blue', 'white', 'white', 'white'], ODD_CTX)).toBe(0);
  });
  it('4④ more than one yellow → cut the last', () => {
    expect(solveWires(['yellow', 'yellow', 'white', 'white'], ODD_CTX)).toBe(3);
  });
  it('4⑤ otherwise → cut the 2nd', () => {
    expect(solveWires(['white', 'white', 'white', 'white'], ODD_CTX)).toBe(1);
  });

  // 5 wires
  it('5① last wire black AND serial odd → cut the 4th', () => {
    expect(solveWires(['red', 'yellow', 'white', 'white', 'black'], ODD_CTX)).toBe(3);
  });
  it('5① does NOT fire on even serial (falls through to ④ otherwise)', () => {
    expect(solveWires(['red', 'yellow', 'white', 'white', 'black'], EVEN_CTX)).toBe(0);
  });
  it('5② exactly one red AND >1 yellow → cut the 1st', () => {
    expect(solveWires(['red', 'yellow', 'yellow', 'black', 'white'], ODD_CTX)).toBe(0);
  });
  it('5③ no black → cut the 2nd', () => {
    expect(solveWires(['red', 'red', 'white', 'blue', 'blue'], ODD_CTX)).toBe(1);
  });
  it('5④ otherwise → cut the 1st', () => {
    expect(solveWires(['black', 'red', 'red', 'white', 'white'], ODD_CTX)).toBe(0);
  });

  // 6 wires
  it('6① no yellow AND serial odd → cut the 3rd', () => {
    expect(solveWires(['red', 'white', 'blue', 'black', 'white', 'red'], ODD_CTX)).toBe(2);
  });
  it('6① does NOT fire on even serial (falls through to ④ otherwise)', () => {
    expect(solveWires(['red', 'white', 'blue', 'black', 'white', 'red'], EVEN_CTX)).toBe(3);
  });
  it('6② exactly one yellow AND >1 white → cut the 4th', () => {
    expect(solveWires(['yellow', 'white', 'white', 'red', 'black', 'blue'], ODD_CTX)).toBe(3);
  });
  it('6③ no red → cut the last', () => {
    expect(solveWires(['yellow', 'yellow', 'white', 'black', 'blue', 'black'], ODD_CTX)).toBe(5);
  });
  it('6④ otherwise → cut the 4th', () => {
    expect(solveWires(['yellow', 'yellow', 'red', 'white', 'white', 'black'], ODD_CTX)).toBe(3);
  });

  it('throws on an unsupported wire count (generate can never produce one)', () => {
    expect(() => solveWires(['red', 'blue'], ODD_CTX)).toThrow();
  });
});

describe('wiresReducer — contract obligations (frozen inputs throughout)', () => {
  // [red, blue, red] with odd serial → 3④ otherwise → cut the last (index 2).
  const COLORS: readonly WireColor[] = ['red', 'blue', 'red'];
  const SOLUTION = 2;

  it('happy path: cutting the correct wire solves, wire marked cut', () => {
    const state = armed(COLORS, ODD_CTX);
    const next = wiresReducer(state, cut(SOLUTION));
    expect(next.status).toBe('solved');
    expect(next.data.wires[SOLUTION].cut).toBe(true);
    expect(next.data.wires.filter((w) => w.cut)).toHaveLength(1);
  });

  it('wrong cut: transient struck, not solved, wire stays severed', () => {
    const state = armed(COLORS, ODD_CTX);
    const next = wiresReducer(state, cut(0));
    expect(next.status).toBe('struck');
    expect(next.data.wires[0].cut).toBe(true);
  });

  it('idempotency: repeating the same cut on a severed wire is a no-op (no second strike)', () => {
    const state = armed(COLORS, ODD_CTX);
    const afterWrong = wiresReducer(state, cut(0));
    // Bomb reducer re-arms after the transient strike roll-up:
    const reArmed = { ...afterWrong, status: 'armed' as const };
    Object.freeze(reArmed);
    expect(wiresReducer(reArmed, cut(0))).toBe(reArmed);
  });

  it('still solvable after a wrong cut: correct cut solves on a re-armed module', () => {
    const state = armed(COLORS, ODD_CTX);
    const reArmed = { ...wiresReducer(state, cut(0)), status: 'armed' as const };
    const next = wiresReducer(reArmed, cut(SOLUTION));
    expect(next.status).toBe('solved');
    expect(next.data.wires[0].cut).toBe(true); // earlier severed wire stays severed
    expect(next.data.wires[SOLUTION].cut).toBe(true);
  });

  it('immutability: never mutates the (frozen) input state', () => {
    const state = armed(COLORS, ODD_CTX);
    expect(() => wiresReducer(state, cut(SOLUTION))).not.toThrow();
    expect(state.status).toBe('armed');
    expect(state.data.wires.every((w) => !w.cut)).toBe(true);
  });

  it('guard clauses: out-of-bounds, negative, NaN, non-integer index → unchanged', () => {
    const state = armed(COLORS, ODD_CTX);
    for (const wireIndex of [3, 99, -1, Number.NaN, 1.5]) {
      expect(wiresReducer(state, { type: 'CUT', wireIndex })).toBe(state);
    }
  });

  it('guard clauses: unknown / malformed actions → unchanged (no throw)', () => {
    const state = armed(COLORS, ODD_CTX);
    for (const action of [undefined, null, 42, 'CUT', {}, { type: 'EXPLODE' }, { type: 'CUT' }]) {
      expect(wiresReducer(state, action)).toBe(state);
    }
  });

  it('solved-inert: actions after solve are no-ops', () => {
    const solved = wiresReducer(armed(COLORS, ODD_CTX), cut(SOLUTION));
    Object.freeze(solved);
    expect(wiresReducer(solved, cut(0))).toBe(solved);
  });

  it('MODULE_RESET restores all wires uncut and re-arms (after wrong cuts and after solve)', () => {
    const state = armed(COLORS, ODD_CTX);
    for (const dirty of [wiresReducer(state, cut(0)), wiresReducer(state, cut(SOLUTION))]) {
      Object.freeze(dirty);
      const reset = wiresReducer(dirty, { type: 'MODULE_RESET' });
      expect(reset.status).toBe('armed');
      expect(reset.data.wires.every((w) => !w.cut)).toBe(true);
      expect(reset.data.ctx).toBe(ODD_CTX); // layout + public ctx survive reset
      // still solvable after reset: cutting the (recomputed) answer solves.
      expect(wiresReducer(Object.freeze(reset), cut(SOLUTION)).status).toBe('solved');
    }
  });
});

describe('isWiresAction', () => {
  it('accepts CUT with a numeric index and MODULE_RESET', () => {
    expect(isWiresAction({ type: 'CUT', wireIndex: 0 })).toBe(true);
    expect(isWiresAction({ type: 'MODULE_RESET' })).toBe(true);
  });
  it('rejects malformed payloads', () => {
    for (const bad of [null, 7, 'CUT', { type: 'CUT' }, { type: 'CUT', wireIndex: '0' }, { type: 'NOPE' }]) {
      expect(isWiresAction(bad)).toBe(false);
    }
  });
});

describe('getWiresManualPages — generated from the same rule data as solveWires', () => {
  const pages = getWiresManualPages();
  const sections = pages[0].sections;
  // Rule tables carry the '#' column; the colour-label table does not.
  const tables = sections.filter((s) => s.table?.headers[0] === '#');

  it('is a single wires chapter with all four per-count rule tables', () => {
    expect(pages).toHaveLength(1);
    expect(pages[0].chapterId).toBe(WIRES_MODULE_ID);
    expect(tables).toHaveLength(4);
  });

  it('each table row mirrors WIRES_RULES text exactly (cannot diverge from the solver)', () => {
    const counts = [3, 4, 5, 6] as const;
    counts.forEach((count, i) => {
      const rules = WIRES_RULES[count];
      const rows = tables[i].table!.rows;
      expect(rows).toHaveLength(rules.length);
      rules.forEach((rule, r) => {
        expect(rows[r]).toEqual([String(r + 1), rule.conditionText, rule.actionText]);
      });
    });
  });

  it('documents the colorblind letter labels for all five colours (K = black)', () => {
    const labelSection = sections.find((s) => s.table?.headers.includes('Label'));
    expect(labelSection).toBeDefined();
    const rows = labelSection!.table!.rows;
    expect(rows).toHaveLength(WIRE_COLORS.length);
    expect(WIRE_COLOR_LABELS.black).toBe('K');
    expect(WIRE_COLOR_LABELS.blue).toBe('B');
    for (const color of WIRE_COLORS) {
      expect(rows.some((row) => row.includes(WIRE_COLOR_LABELS[color]))).toBe(true);
    }
  });
});
