import type { BombState } from '@bomb-squad/shared';
import { createBombReducer } from '../bombReducer.js';
import type { ModuleReducer } from '../MODULE_REDUCERS.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeTestBomb(overrides?: Partial<BombState>): BombState {
  return {
    context: {
      serialNumber: 'AB1234',
      batteryCount: 2,
      indicators: [],
      ports: [],
    },
    modules: [{ moduleId: 'test-mod', status: 'armed', data: {} }],
    strikes: 0,
    solved: false,
    ...overrides,
  };
}

const solveReducer: ModuleReducer = (state) => ({ ...state, status: 'solved' });
const strikeReducer: ModuleReducer = (state) => ({ ...state, status: 'struck' });
const noopReducer: ModuleReducer = (state) => state;

const testRegistry: Record<string, ModuleReducer> = {
  'test-mod': solveReducer,
  'strike-mod': strikeReducer,
  'noop-mod': noopReducer,
};

// ─── Guard clauses (AC2) ─────────────────────────────────────────────────────

describe('bombReducer — guard clauses (AC2)', () => {
  const reducer = createBombReducer(testRegistry);

  it('returns state unchanged (same reference) for an out-of-bounds moduleIndex', () => {
    const bomb = makeTestBomb(); // has 1 module at index 0
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 99, payload: {} });
    expect(result).toBe(bomb); // identical reference — no allocation
  });

  it('returns state unchanged when moduleId is not in registry', () => {
    const bomb = makeTestBomb({
      modules: [{ moduleId: 'unregistered-mod', status: 'armed', data: {} }],
    });
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result).toBe(bomb);
  });

  it('does not throw for an out-of-bounds moduleIndex', () => {
    const bomb = makeTestBomb();
    expect(() =>
      reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: -1, payload: {} }),
    ).not.toThrow();
  });
});

// ─── Happy path — module solved (AC3) ────────────────────────────────────────

describe('bombReducer — happy path solved (AC3)', () => {
  const reducer = createBombReducer(testRegistry);

  it('marks the module as solved when the module reducer returns solved', () => {
    const bomb = makeTestBomb();
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.modules[0].status).toBe('solved');
  });

  it('sets bomb.solved = true when all modules are solved', () => {
    const bomb = makeTestBomb();
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.solved).toBe(true);
  });

  it('returns a NEW object (not the same reference as the input)', () => {
    const bomb = makeTestBomb();
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result).not.toBe(bomb);
    expect(result.modules).not.toBe(bomb.modules);
  });

  it('does not set solved when at least one module remains unsolved', () => {
    const bomb = makeTestBomb({
      modules: [
        { moduleId: 'test-mod', status: 'armed', data: {} },
        { moduleId: 'noop-mod', status: 'armed', data: {} },
      ],
    });
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.solved).toBe(false);
    expect(result.modules[0].status).toBe('solved');
    expect(result.modules[1].status).toBe('armed'); // noop untouched
  });
});

// ─── Strike roll-up (AC3) ────────────────────────────────────────────────────

describe('bombReducer — strike roll-up (AC3)', () => {
  it('increments strikes when module reducer returns struck', () => {
    const reducer = createBombReducer({ 'strike-mod': strikeReducer });
    const bomb = makeTestBomb({
      modules: [{ moduleId: 'strike-mod', status: 'armed', data: {} }],
    });
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.strikes).toBe(1);
  });

  it('resets module status to armed after a strike (struck is transient)', () => {
    const reducer = createBombReducer({ 'strike-mod': strikeReducer });
    const bomb = makeTestBomb({
      modules: [{ moduleId: 'strike-mod', status: 'armed', data: {} }],
    });
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.modules[0].status).toBe('armed');
  });

  it('caps strikes at 3', () => {
    const reducer = createBombReducer({ 'strike-mod': strikeReducer });
    const bomb = makeTestBomb({
      modules: [{ moduleId: 'strike-mod', status: 'armed', data: {} }],
      strikes: 3,
    });
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.strikes).toBe(3);
  });

  it('does not set solved after a strike', () => {
    const reducer = createBombReducer({ 'strike-mod': strikeReducer });
    const bomb = makeTestBomb({
      modules: [{ moduleId: 'strike-mod', status: 'armed', data: {} }],
    });
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.solved).toBe(false);
  });
});

// ─── Idempotency (AC3) ───────────────────────────────────────────────────────

describe('bombReducer — idempotency (AC3)', () => {
  it('applying the same action on an already-solved module is a no-op', () => {
    const reducer = createBombReducer(testRegistry);
    const bomb = makeTestBomb({
      modules: [{ moduleId: 'test-mod', status: 'solved', data: {} }],
      solved: true,
    });
    // The solve reducer always returns { ...state, status: 'solved' }.
    // On an already-solved module it should produce an equivalent state.
    const result = reducer(bomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result.modules[0].status).toBe('solved');
    expect(result.solved).toBe(true);
    expect(result.strikes).toBe(0);
  });
});

// ─── Immutability (AC3) ──────────────────────────────────────────────────────

describe('bombReducer — immutability (AC3)', () => {
  it('does not throw when called on a deeply frozen BombState', () => {
    const reducer = createBombReducer(testRegistry);
    const frozenBomb = Object.freeze({
      ...makeTestBomb(),
      modules: Object.freeze([
        Object.freeze({ moduleId: 'test-mod', status: 'armed' as const, data: {} }),
      ]),
    }) as BombState;

    expect(() =>
      reducer(frozenBomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} }),
    ).not.toThrow();
  });

  it('returns a new object distinct from the frozen input', () => {
    const reducer = createBombReducer(testRegistry);
    const frozenBomb = Object.freeze({
      ...makeTestBomb(),
      modules: Object.freeze([
        Object.freeze({ moduleId: 'test-mod', status: 'armed' as const, data: {} }),
      ]),
    }) as BombState;

    const result = reducer(frozenBomb, { type: 'MODULE_ACTION', moduleIndex: 0, payload: {} });
    expect(result).not.toBe(frozenBomb);
    expect(result.modules).not.toBe(frozenBomb.modules);
  });
});

// ─── Open/closed principle (AC4) ─────────────────────────────────────────────

describe('bombReducer — open/closed principle (AC4)', () => {
  /**
   * Structural AC: adding a new module to the registry MUST NOT require editing bombReducer.ts.
   * This test demonstrates the delegation pattern by injecting a new module at test time.
   * The production bombReducer.ts file is never modified when a new module is added —
   * only MODULE_REDUCERS.ts gains an entry. This is the open/closed guarantee.
   */
  it('delegates to a newly added module reducer without any change to bombReducer.ts', () => {
    const customResult = { moduleId: 'custom-mod', status: 'solved' as const, data: { value: 42 } };
    const customReducer: ModuleReducer = (_state, _action) => customResult;

    // We only add to the registry — bombReducer.ts is untouched.
    const reducerWithCustomMod = createBombReducer({ 'custom-mod': customReducer });
    const bomb = makeTestBomb({
      modules: [{ moduleId: 'custom-mod', status: 'armed', data: {} }],
    });

    const result = reducerWithCustomMod(bomb, {
      type: 'MODULE_ACTION',
      moduleIndex: 0,
      payload: { interact: true },
    });

    expect(result.modules[0]).toEqual(customResult);
    expect(result.solved).toBe(true);
  });
});

// ─── Unknown action type fall-through ────────────────────────────────────────

describe('bombReducer — unknown action fall-through', () => {
  it('returns state unchanged and does not throw for an unknown action type', () => {
    const reducer = createBombReducer(testRegistry);
    const bomb = makeTestBomb();
    // Cast to bypass TypeScript exhaustiveness — simulates a future action type arriving
    // before the reducer is updated (e.g. during a rolling deploy).
    const result = reducer(bomb, { type: 'UNKNOWN_FUTURE_ACTION' } as never);
    expect(result).toBe(bomb);
  });
});
