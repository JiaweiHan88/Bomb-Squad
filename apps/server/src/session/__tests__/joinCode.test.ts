import { generateJoinCode, type RandomBytesFn } from '../joinCode.js';

/** Builds a fake randomBytes that serves the given byte values in order. */
function fixedBytes(values: number[]): RandomBytesFn {
  let cursor = 0;
  return (size: number) => {
    const chunk = values.slice(cursor, cursor + size);
    if (chunk.length < size) throw new Error('fixedBytes exhausted');
    cursor += size;
    return Buffer.from(chunk);
  };
}

describe('generateJoinCode', () => {
  it('produces 6 uppercase alphanumeric characters by default', () => {
    const code = generateJoinCode();
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('honors a custom length', () => {
    expect(generateJoinCode(8)).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('never contains a colon (Redis key-segment safety)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateJoinCode()).not.toContain(':');
    }
  });

  it('maps fixed bytes deterministically (charset order A–Z then 0–9)', () => {
    // 0→A, 25→Z, 26→0, 35→9, 36→A (36 % 36 = 0), 71→9 (71 % 36 = 35)
    const code = generateJoinCode(6, fixedBytes([0, 25, 26, 35, 36, 71]));
    expect(code).toBe('AZ09A9');
  });

  it('rejects bytes >= 252 and draws replacements (no modulo bias)', () => {
    // First draw of 6: [252..255] discarded, 0,0 accepted → 'AA'.
    // Second draw of 4: 1,2,3,4 → 'BCDE'.
    const code = generateJoinCode(6, fixedBytes([252, 253, 254, 255, 0, 0, 1, 2, 3, 4]));
    expect(code).toBe('AABCDE');
  });

  it('is not sequential across consecutive generations', () => {
    const codes = Array.from({ length: 200 }, () => generateJoinCode());
    // Cheap sanity (not a randomness proof): no run of consecutive codes that
    // differ only by an increment of the final character, and codes are unique.
    expect(new Set(codes).size).toBeGreaterThan(190);
    let incrementingRuns = 0;
    for (let i = 1; i < codes.length; i++) {
      const prev = codes[i - 1]!;
      const curr = codes[i]!;
      if (
        prev.slice(0, 5) === curr.slice(0, 5) &&
        curr.charCodeAt(5) - prev.charCodeAt(5) === 1
      ) {
        incrementingRuns++;
      }
    }
    expect(incrementingRuns).toBeLessThan(3);
  });
});
