import {
  hash,
  deriveTemplateSeed,
  deriveTeamSeed,
  deriveModuleSeed,
  makeSeededRng,
} from '../seeding/index.js';

describe('hash', () => {
  it('returns the same output for the same input (stable)', () => {
    expect(hash('hello')).toBe(hash('hello'));
    expect(hash('sessionABC123')).toBe(hash('sessionABC123'));
    expect(hash('')).toBe(hash(''));
  });

  it('returns different outputs for different input strings', () => {
    const inputs = [
      'a', 'b', 'c', 'session-1', 'session-2',
      'teamA', 'teamB', 'round1', 'round2', 'module0',
    ];
    const results = inputs.map(hash);
    const unique = new Set(results);
    expect(unique.size).toBe(inputs.length);
  });

  it('returns a non-negative 32-bit integer', () => {
    for (const s of ['', 'x', 'abc123', 'session-id-with-uuid']) {
      const h = hash(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(4294967295); // 2^32 - 1
    }
  });
});

describe('deriveTemplateSeed', () => {
  it('is stable: same (sessionId, roundNumber) always returns the same value', () => {
    expect(deriveTemplateSeed('sid-abc', 1)).toBe(deriveTemplateSeed('sid-abc', 1));
    expect(deriveTemplateSeed('sid-abc', 2)).toBe(deriveTemplateSeed('sid-abc', 2));
  });

  it('produces different values for different roundNumbers', () => {
    const t1 = deriveTemplateSeed('sid-abc', 1);
    const t2 = deriveTemplateSeed('sid-abc', 2);
    expect(t1).not.toBe(t2);
  });

  it('produces different values for different sessionIds', () => {
    const t1 = deriveTemplateSeed('sid-aaa', 1);
    const t2 = deriveTemplateSeed('sid-bbb', 1);
    expect(t1).not.toBe(t2);
  });
});

describe('deriveTeamSeed', () => {
  it('diverges: same templateSeed with different teamIds produces different teamSeeds', () => {
    const template = deriveTemplateSeed('session-1', 1);
    const seedA = deriveTeamSeed(template, 'A');
    const seedB = deriveTeamSeed(template, 'B');
    expect(seedA).not.toBe(seedB);
  });

  it('is stable: same inputs always produce the same output', () => {
    const template = deriveTemplateSeed('session-1', 1);
    expect(deriveTeamSeed(template, 'A')).toBe(deriveTeamSeed(template, 'A'));
    expect(deriveTeamSeed(template, 'B')).toBe(deriveTeamSeed(template, 'B'));
  });
});

describe('deriveModuleSeed', () => {
  it('is stable: same inputs always produce the same output', () => {
    const template = deriveTemplateSeed('session-1', 1);
    const team = deriveTeamSeed(template, 'A');
    expect(deriveModuleSeed(team, 0)).toBe(deriveModuleSeed(team, 0));
    expect(deriveModuleSeed(team, 5)).toBe(deriveModuleSeed(team, 5));
  });

  it('distribution: 10 distinct moduleIndex values produce 10 distinct seeds', () => {
    const template = deriveTemplateSeed('session-1', 1);
    const team = deriveTeamSeed(template, 'A');
    const seeds = Array.from({ length: 10 }, (_, i) => deriveModuleSeed(team, i));
    expect(new Set(seeds).size).toBe(10);
  });
});

describe('full chain determinism', () => {
  it('end-to-end: same (sessionId, roundNumber, teamId, moduleIndex) always produces the same moduleSeed', () => {
    const derive = (sid: string, round: number, team: string, mod: number) =>
      deriveModuleSeed(deriveTeamSeed(deriveTemplateSeed(sid, round), team), mod);

    expect(derive('game-42', 3, 'A', 2)).toBe(derive('game-42', 3, 'A', 2));
    expect(derive('game-42', 3, 'B', 2)).toBe(derive('game-42', 3, 'B', 2));
  });

  it('templateSeed is shared: both teams derive the same templateSeed', () => {
    const sid = 'game-42';
    const round = 1;
    expect(deriveTemplateSeed(sid, round)).toBe(deriveTemplateSeed(sid, round));
  });

  it('teamSeeds differ: team A and team B get independent seeds from the same template', () => {
    const template = deriveTemplateSeed('game-42', 1);
    expect(deriveTeamSeed(template, 'A')).not.toBe(deriveTeamSeed(template, 'B'));
  });
});

describe('makeSeededRng', () => {
  it('produces values in [0, 1)', () => {
    const rng = makeSeededRng(12345);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('same seed produces the same sequence', () => {
    const rng1 = makeSeededRng(99999);
    const rng2 = makeSeededRng(99999);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('different seeds produce different sequences', () => {
    const rng1 = makeSeededRng(1);
    const rng2 = makeSeededRng(2);
    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());
    expect(seq1).not.toEqual(seq2);
  });

  it('two generators from the same seed are independent (separate state)', () => {
    const rng1 = makeSeededRng(42);
    const rng2 = makeSeededRng(42);
    // Advance rng1 but not rng2
    rng1(); rng1(); rng1();
    // rng2 should still produce the first value of the sequence
    const rng3 = makeSeededRng(42);
    expect(rng2()).toBe(rng3());
  });
});
