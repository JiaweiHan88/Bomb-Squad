import { describe, expect, it } from '@jest/globals';
import {
  DEV_DEMO_MODULE_ID,
  WIRES_MODULE_ID,
  BUTTON_MODULE_ID,
  devDemoReducer,
  generateDevDemo,
  generateWires,
  solveWires,
  type BombContext,
  type BombState,
  type ButtonState,
  type ModuleState,
} from '@bomb-squad/shared';
import { createBombReducer, bombReducer } from '../bombReducer.js';
import { MODULE_REDUCERS, type ModuleReducer } from '../MODULE_REDUCERS.js';

/**
 * Story 5.1 — the open/closed plugin contract, proven end-to-end:
 * a module registered into a reducer registry appears on the bomb with ZERO
 * change to bombReducer's dispatch logic (ADR-003), and the bomb reducer
 * defensively rejects out-of-contract module-reducer output (1.6 deferral).
 */

const CTX: BombContext = {
  serialNumber: 'XY42Z1',
  batteryCount: 1,
  indicators: [],
  ports: [],
};

const seedFor = (solution: 'cut' | 'press' | 'cut-press'): number => {
  for (let seed = 0; seed < 1000; seed++) {
    if (generateDevDemo(seed, CTX).solution === solution) return seed;
  }
  throw new Error(`no seed under 1000 produces ${solution}`);
};

const devDemoBomb = (solution: 'cut' | 'press' | 'cut-press'): BombState => ({
  context: CTX,
  modules: [
    {
      moduleId: DEV_DEMO_MODULE_ID,
      status: 'armed',
      data: generateDevDemo(seedFor(solution), CTX),
    },
  ],
  strikes: 0,
  solved: false,
});

describe('open/closed module registration (AC2)', () => {
  // The injection seam: register dev-demo without editing bombReducer.ts.
  const reduce = createBombReducer({
    [DEV_DEMO_MODULE_ID]: devDemoReducer as ModuleReducer,
  });

  it('a registered module solves through the bomb reducer', () => {
    const next = reduce(devDemoBomb('cut'), {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'CUT' },
    });
    expect(next.modules[0].status).toBe('solved');
    expect(next.strikes).toBe(0);
    expect(next.solved).toBe(true); // single-module bomb: all solved
  });

  it('a wrong interaction rolls up into a team strike and re-arms', () => {
    const next = reduce(devDemoBomb('press'), {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'CUT' },
    });
    expect(next.modules[0].status).toBe('armed'); // transient 'struck' rolled up
    expect(next.strikes).toBe(1);
    expect(next.solved).toBe(false);
  });

  it('MODULE_RESET restores a solved module to armed', () => {
    const solved = reduce(devDemoBomb('cut'), {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'CUT' },
    });
    const reset = reduce(solved, { type: 'MODULE_RESET', moduleIndex: 0 });
    expect(reset.modules[0].status).toBe('armed');
    expect(reset.solved).toBe(false);
  });

  it('wires (5.3) is registered and solves/strikes through the untouched bomb reducer', () => {
    expect(MODULE_REDUCERS[WIRES_MODULE_ID]).toBeDefined();
    const data = generateWires(7, CTX);
    // The answer is no longer stored in state — recompute it (Sprint 2 retro AI1).
    const solutionIndex = solveWires(data.wires.map((w) => w.color), CTX);
    const wiresBomb: BombState = {
      context: CTX,
      modules: [{ moduleId: WIRES_MODULE_ID, status: 'armed', data }],
      strikes: 0,
      solved: false,
    };
    const solved = bombReducer(wiresBomb, {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'CUT', wireIndex: solutionIndex },
    });
    expect(solved.modules[0].status).toBe('solved');
    expect(solved.strikes).toBe(0);
    const wrongIndex = (solutionIndex + 1) % data.wires.length;
    const struck = bombReducer(wiresBomb, {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'CUT', wireIndex: wrongIndex },
    });
    expect(struck.modules[0].status).toBe('armed'); // transient 'struck' rolled up
    expect(struck.strikes).toBe(1);
  });

  it('the-button (5.4) is registered and presses/releases through the untouched bomb reducer', () => {
    expect(MODULE_REDUCERS[BUTTON_MODULE_ID]).toBeDefined();
    // yellow → hold (rule 5), strip blue → release on a 4. Explicit data so the
    // decision is deterministic without seed-searching.
    const data: ButtonState = { color: 'yellow', label: 'Press', stripColor: 'blue', held: false, ctx: CTX };
    const buttonBomb: BombState = {
      context: CTX,
      modules: [{ moduleId: BUTTON_MODULE_ID, status: 'armed', data }],
      strikes: 0,
      solved: false,
    };
    // PRESS reveals the strip (held) without solving — flows through bombReducer.
    const held = bombReducer(buttonBomb, {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'PRESS' },
    });
    expect((held.modules[0].data as ButtonState).held).toBe(true);
    expect(held.modules[0].status).toBe('armed');
    // RELEASE at the matching digit (4 present) solves with no strike.
    const solved = bombReducer(held, {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'RELEASE', timerDigits: [1, 4, 3] },
    });
    expect(solved.modules[0].status).toBe('solved');
    expect(solved.strikes).toBe(0);
    // RELEASE at a wrong digit rolls up into a team strike and re-arms.
    const struck = bombReducer(held, {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'RELEASE', timerDigits: [1, 2, 3] },
    });
    expect(struck.modules[0].status).toBe('armed'); // transient 'struck' rolled up
    expect(struck.strikes).toBe(1);
  });

  it('dev-demo is registered in the production MODULE_REDUCERS map', () => {
    expect(MODULE_REDUCERS[DEV_DEMO_MODULE_ID]).toBeDefined();
    const next = bombReducer(devDemoBomb('cut'), {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { type: 'CUT' },
    });
    expect(next.modules[0].status).toBe('solved');
  });
});

describe('module-reducer output guard (1.6 deferral closed in 5.1)', () => {
  const bomb = devDemoBomb('cut');

  const rogue = (next: Partial<ModuleState<unknown>>): ModuleReducer => {
    return (state) => ({ ...state, ...next });
  };

  it('rejects output that rebinds moduleId to another reducer', () => {
    const reduce = createBombReducer({
      [DEV_DEMO_MODULE_ID]: rogue({ moduleId: 'simon-says', status: 'solved' }),
    });
    const next = reduce(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(next).toBe(bomb); // state unchanged, no throw
  });

  it('rejects output with an illegal status', () => {
    const reduce = createBombReducer({
      [DEV_DEMO_MODULE_ID]: rogue({ status: 'detonated' as ModuleState<unknown>['status'] }),
    });
    const next = reduce(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(next).toBe(bomb);
  });

  it('rejects non-object output', () => {
    const reduce = createBombReducer({
      [DEV_DEMO_MODULE_ID]: (() => undefined) as unknown as ModuleReducer,
    });
    const next = reduce(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(next).toBe(bomb);
  });

  it('still accepts in-contract output (guard is not over-broad)', () => {
    const reduce = createBombReducer({
      [DEV_DEMO_MODULE_ID]: devDemoReducer as ModuleReducer,
    });
    const next = reduce(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: { type: 'CUT' } });
    expect(next.modules[0].status).toBe('solved');
  });
});
