import { describe, expect, it } from '@jest/globals';
import { createSessionState, DEFAULT_ROUND_CONFIG } from '../createSession.js';

const ARGS = {
  sessionId: 'sess-1',
  joinCode: 'ABC123',
  facilitatorId: 'sock-42',
};

describe('createSessionState', () => {
  it('creates a lobby session with defaults and the facilitator as sole player', () => {
    const state = createSessionState(ARGS);
    expect(state).toEqual({
      sessionId: 'sess-1',
      joinCode: 'ABC123',
      status: 'lobby',
      config: DEFAULT_ROUND_CONFIG,
      players: {
        'sock-42': {
          playerId: 'sock-42',
          displayName: 'Facilitator',
          role: 'facilitator',
          isReady: false,
        },
      },
      teams: {},
      roundNumber: 0,
      pausedAt: null,
      pauseKind: null,
      disconnectedPlayerIds: [],
    });
  });

  it('applies sane first-round defaults (easy, 3 modules, 5:00, 25% speed-up)', () => {
    const { config } = createSessionState(ARGS);
    expect(config.difficulty).toBe('easy');
    expect(config.moduleCount).toBe(3);
    expect(config.timerMs).toBe(300_000);
    expect(config.strikeSpeedUpPct).toBe(25);
    expect(config.modifiers).toEqual({ asymmetricExpertRoles: false, spectatorLifelines: false });
  });

  it('merges a partial config over defaults without dropping other fields', () => {
    const { config } = createSessionState({ ...ARGS, config: { timerMs: 600_000 } });
    expect(config.timerMs).toBe(600_000);
    expect(config.difficulty).toBe('easy');
    expect(config.moduleCount).toBe(3);
    expect(config.modifiers).toEqual({ asymmetricExpertRoles: false, spectatorLifelines: false });
  });

  it('merges nested modifiers field-by-field', () => {
    const { config } = createSessionState({
      ...ARGS,
      config: { modifiers: { asymmetricExpertRoles: true, spectatorLifelines: false } },
    });
    expect(config.modifiers).toEqual({ asymmetricExpertRoles: true, spectatorLifelines: false });
  });

  it('is pure: same args produce deep-equal results and inputs are not mutated', () => {
    const config = Object.freeze({ moduleCount: 5 });
    const a = createSessionState({ ...ARGS, config });
    const b = createSessionState({ ...ARGS, config });
    expect(a).toEqual(b);
    expect(config).toEqual({ moduleCount: 5 });
    // The shared default must never leak by reference into the result.
    expect(a.config).not.toBe(DEFAULT_ROUND_CONFIG);
    expect(a.config.modifiers).not.toBe(DEFAULT_ROUND_CONFIG.modifiers);
  });
});
