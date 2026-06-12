import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEV_DEMO_MODULE_ID,
  generateDevDemo,
  type BombContext,
  type ModuleState,
} from '@bomb-squad/shared';
import { useGameStore } from '../../store/gameStore.js';
import { SANDBOX_MODULES } from '../../modules/index.js';
import { buildSandboxBomb, parseSeed } from '../sandbox.js';
import { createDevModuleDispatch, reduceDevModuleAction } from '../devDispatch.js';

// The type-erased binding (SandboxModule) — what the sandbox APIs consume.
const DEV_DEMO = SANDBOX_MODULES[0];

const CTX: BombContext = {
  serialNumber: 'QQ7AB4',
  batteryCount: 0,
  indicators: [],
  ports: [],
};

const seedFor = (solution: 'cut' | 'press' | 'cut-press'): number => {
  for (let seed = 0; seed < 1000; seed++) {
    if (generateDevDemo(seed, CTX).solution === solution) return seed;
  }
  throw new Error(`no seed under 1000 produces ${solution}`);
};

describe('parseSeed', () => {
  it('accepts non-negative integer strings', () => {
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed('42')).toBe(42);
    expect(parseSeed(' 7 ')).toBe(7);
  });

  it('rejects anything else', () => {
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('-1')).toBeNull();
    expect(parseSeed('1.5')).toBeNull();
    expect(parseSeed('abc')).toBeNull();
    expect(parseSeed('1e3')).toBeNull();
  });
});

describe('buildSandboxBomb', () => {
  it('builds a one-module armed bomb from a seeded generate', () => {
    const bomb = buildSandboxBomb(DEV_DEMO, 5, CTX);
    expect(bomb.modules).toHaveLength(1);
    expect(bomb.modules[0].moduleId).toBe(DEV_DEMO_MODULE_ID);
    expect(bomb.modules[0].status).toBe('armed');
    expect(bomb.modules[0].data).toEqual(generateDevDemo(5, CTX));
    expect(bomb.strikes).toBe(0);
    expect(bomb.solved).toBe(false);
    expect(bomb.context).toBe(CTX);
  });
});

describe('reduceDevModuleAction (local roll-up mirror)', () => {
  const armedModule = (solution: 'cut' | 'press' | 'cut-press'): ModuleState<unknown> => ({
    moduleId: DEV_DEMO_MODULE_ID,
    status: 'armed',
    data: generateDevDemo(seedFor(solution), CTX),
  });

  it('a normal action yields a single update', () => {
    const { updates, struck } = reduceDevModuleAction(armedModule('cut'), DEV_DEMO.reduce, {
      type: 'CUT',
    });
    expect(struck).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('solved');
  });

  it("a wrong action yields the transient struck→armed pulse (the server's worst-case sequencing)", () => {
    const { updates, struck } = reduceDevModuleAction(armedModule('press'), DEV_DEMO.reduce, {
      type: 'CUT',
    });
    expect(struck).toBe(true);
    expect(updates.map((u) => u.status)).toEqual(['struck', 'armed']);
  });

  it('a solved module is inert (no updates)', () => {
    const solved: ModuleState<unknown> = { ...armedModule('cut'), status: 'solved' };
    const { updates } = reduceDevModuleAction(solved, DEV_DEMO.reduce, { type: 'CUT' });
    expect(updates).toHaveLength(0);
  });

  it('MODULE_RESET passes through the solved-inert gate', () => {
    const solved: ModuleState<unknown> = { ...armedModule('cut'), status: 'solved' };
    const { updates } = reduceDevModuleAction(solved, DEV_DEMO.reduce, {
      type: 'MODULE_RESET',
      moduleIndex: 0,
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].status).toBe('armed');
  });
});

describe('createDevModuleDispatch (drives the real gameStore)', () => {
  beforeEach(() => {
    useGameStore.getState().setBomb(buildSandboxBomb(DEV_DEMO, seedFor('press'), CTX));
  });

  const dispatch = createDevModuleDispatch(SANDBOX_MODULES);

  it('a correct gesture solves the module and flips bomb.solved', () => {
    dispatch(0, { type: 'BUTTON_DOWN' });
    dispatch(0, { type: 'BUTTON_UP' });
    const bomb = useGameStore.getState().bomb;
    expect(bomb?.modules[0].status).toBe('solved');
    expect(bomb?.solved).toBe(true);
    expect(bomb?.strikes).toBe(0);
  });

  it('a wrong gesture rolls up a strike and re-arms', () => {
    dispatch(0, { type: 'CUT' });
    const bomb = useGameStore.getState().bomb;
    expect(bomb?.modules[0].status).toBe('armed');
    expect(bomb?.strikes).toBe(1);
    expect(bomb?.solved).toBe(false);
  });

  it('strikes saturate at 3 and unknown indices are ignored', () => {
    dispatch(7, { type: 'CUT' }); // out of range → no-op
    expect(useGameStore.getState().bomb?.strikes).toBe(0);
    // wrong CUT once (severs), then resets + wrong cuts to accumulate
    dispatch(0, { type: 'CUT' });
    dispatch(0, { type: 'MODULE_RESET', moduleIndex: 0 });
    dispatch(0, { type: 'CUT' });
    dispatch(0, { type: 'MODULE_RESET', moduleIndex: 0 });
    dispatch(0, { type: 'CUT' });
    dispatch(0, { type: 'MODULE_RESET', moduleIndex: 0 });
    dispatch(0, { type: 'CUT' }); // 4th wrong cut — must clamp at 3
    expect(useGameStore.getState().bomb?.strikes).toBe(3);
  });
});
