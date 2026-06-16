import type { RoundConfig, TeamId } from '../../types/session.js';
import type { DevDemoState } from '../../modules/dev-demo/types.js';
import { generateRoundBombs } from '../assembleBomb.js';

const TEAMS: readonly TeamId[] = ['A', 'B'];

/** Base round config; only generation-relevant fields matter here. */
const config = (overrides: Partial<RoundConfig> = {}): RoundConfig => ({
  difficulty: 'easy',
  moduleCount: 4,
  timerMs: 300_000,
  strikeSpeedUpPct: 25,
  modulePool: ['dev-demo'], // only generatable module until 5.3
  modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false },
  ...overrides,
});

describe('generateRoundBombs — AC1 identical layout, independent values', () => {
  it('gives both teams the IDENTICAL module-id layout', () => {
    const bombs = generateRoundBombs('sess-1', 1, config({ moduleCount: 5 }), TEAMS);
    const layoutA = bombs.A.modules.map((m) => m.moduleId);
    const layoutB = bombs.B.modules.map((m) => m.moduleId);
    expect(layoutA).toEqual(layoutB);
    expect(layoutA).toHaveLength(5);
  });

  it('gives the two teams INDEPENDENT context values (distinct serials)', () => {
    const bombs = generateRoundBombs('sess-1', 1, config(), TEAMS);
    expect(bombs.A.context).not.toEqual(bombs.B.context);
    expect(bombs.A.context.serialNumber).not.toEqual(bombs.B.context.serialNumber);
  });

  it('gives the two teams INDEPENDENT module values (at least one slot differs)', () => {
    const bombs = generateRoundBombs('sess-1', 1, config(), TEAMS);
    const differs = bombs.A.modules.some((m, i) => {
      const a = m.data as DevDemoState;
      const b = bombs.B.modules[i].data as DevDemoState;
      return a.label !== b.label || a.solution !== b.solution;
    });
    expect(differs).toBe(true);
  });

  it('arms every module fresh with strikes 0 / unsolved', () => {
    const bombs = generateRoundBombs('sess-1', 1, config(), TEAMS);
    for (const teamId of TEAMS) {
      expect(bombs[teamId].strikes).toBe(0);
      expect(bombs[teamId].solved).toBe(false);
      for (const m of bombs[teamId].modules) expect(m.status).toBe('armed');
    }
  });
});

describe('generateRoundBombs — AC3 retry reproducibility', () => {
  it('reproduces deep-equal bombs for identical (sessionId, roundNumber, config)', () => {
    const a = generateRoundBombs('sess-retry', 2, config(), TEAMS);
    const b = generateRoundBombs('sess-retry', 2, config(), TEAMS);
    expect(a).toEqual(b);
  });

  it('produces a DIFFERENT bomb for a different roundNumber', () => {
    const r1 = generateRoundBombs('sess-retry', 1, config(), TEAMS);
    const r2 = generateRoundBombs('sess-retry', 2, config(), TEAMS);
    expect(r1).not.toEqual(r2);
  });

  it('produces a DIFFERENT bomb for a different sessionId', () => {
    const s1 = generateRoundBombs('sess-x', 1, config(), TEAMS);
    const s2 = generateRoundBombs('sess-y', 1, config(), TEAMS);
    expect(s1).not.toEqual(s2);
  });

  it('accepts the roundNumber-0 / seed-0 boundary without throwing', () => {
    expect(() => generateRoundBombs('sess-0', 0, config(), TEAMS)).not.toThrow();
  });
});

describe('generateRoundBombs — AC2 frozen context flows through module generate', () => {
  it('returns frozen contexts (module generate never mutated them)', () => {
    const bombs = generateRoundBombs('sess-freeze', 3, config(), TEAMS);
    for (const teamId of TEAMS) {
      expect(Object.isFrozen(bombs[teamId].context)).toBe(true);
      expect(Object.isFrozen(bombs[teamId].context.indicators)).toBe(true);
      expect(Object.isFrozen(bombs[teamId].context.ports)).toBe(true);
    }
  });
});

describe('generateRoundBombs — fail-loud config guards (no partial writes)', () => {
  it('rejects an unregistered pool id before producing any bomb', () => {
    // 'simon-says' (Epic 7) has no registered generator yet — 'wires' (5.3) and
    // 'the-button' (5.4) are now registered, so they no longer fail loud.
    expect(() => generateRoundBombs('s', 1, config({ modulePool: ['simon-says'] }), TEAMS)).toThrow(
      /unregistered id/,
    );
  });

  it('rejects an out-of-range moduleCount', () => {
    expect(() => generateRoundBombs('s', 1, config({ moduleCount: 12 }), TEAMS)).toThrow(RangeError);
  });

  it('rejects an empty explicit pool', () => {
    expect(() => generateRoundBombs('s', 1, config({ modulePool: [] }), TEAMS)).toThrow(/non-empty/);
  });

  it('falls back to the difficulty tier pool when modulePool is undefined', () => {
    // Interim Easy tier pool is ['wires', 'the-button', 'passwords'] (Story 5.5),
    // so a no-override round draws real modules from that set rather than failing
    // loud.
    const bombs = generateRoundBombs('s', 1, config({ modulePool: undefined }), TEAMS);
    expect(bombs.A.modules).toHaveLength(4);
    for (const m of bombs.A.modules) expect(['wires', 'the-button', 'passwords']).toContain(m.moduleId);
  });

  it('rejects an empty teamIds array', () => {
    expect(() => generateRoundBombs('s', 1, config(), [])).toThrow(RangeError);
  });
});
