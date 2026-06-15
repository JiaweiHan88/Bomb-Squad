import { generateLayout } from '../layout.js';
import { MODULE_GENERATORS } from '../../modules/registry.js';

const POOL = ['dev-demo'] as const;

describe('generateLayout — guards (fail loud)', () => {
  it.each([2, 12, 0, -1, 1.5, Number.NaN])('rejects moduleCount %p', (count) => {
    expect(() => generateLayout(1, count as number, POOL)).toThrow(RangeError);
  });

  it('accepts the inclusive range ends 3 and 11', () => {
    expect(generateLayout(1, 3, POOL)).toHaveLength(3);
    expect(generateLayout(1, 11, POOL)).toHaveLength(11);
  });

  it('rejects an empty pool', () => {
    expect(() => generateLayout(1, 3, [])).toThrow(/non-empty/);
  });

  it('rejects a pool containing an unregistered module id', () => {
    // 'simon-says' (Epic 7) has no registered generator yet — 'wires' (5.3) and
    // 'the-button' (5.4) are now registered, so they no longer fail loud.
    expect(() => generateLayout(1, 3, ['simon-says'])).toThrow(/unregistered id "simon-says"/);
  });
});

describe('generateLayout — drawing behaviour', () => {
  it('draws every slot from the pool', () => {
    const layout = generateLayout(42, 11, POOL);
    for (const id of layout) {
      expect(id in MODULE_GENERATORS).toBe(true);
      expect(POOL).toContain(id);
    }
  });

  it('allows duplicates across slots (mandatory when pool smaller than moduleCount)', () => {
    // Single-id pool with count 11 → all duplicates, no throw.
    const layout = generateLayout(7, 11, POOL);
    expect(layout).toHaveLength(11);
    expect(new Set(layout).size).toBe(1);
  });

  it('is deterministic: same templateSeed → identical layout', () => {
    expect(generateLayout(123, 9, POOL)).toEqual(generateLayout(123, 9, POOL));
  });

  it('produces a varied draw from a multi-id pool for a fixed seed', () => {
    const multi = ['dev-demo', 'dev-demo', 'dev-demo']; // all registered; duplicates fine
    const layout = generateLayout(99, 5, multi);
    expect(layout).toHaveLength(5);
    layout.forEach((id) => expect(id).toBe('dev-demo'));
  });
});
