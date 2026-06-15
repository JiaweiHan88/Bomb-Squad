import type { RoundConfig, TeamId, BombState } from '@bomb-squad/shared';
import { initializeRoundBombs } from '../initializeRoundBombs.js';
import { bombKey } from '../../state/keys.js';
import { createMemoryRedisStore } from '../../handlers/__tests__/testSocketServer.js';

const TEAMS: readonly TeamId[] = ['A', 'B'];

const config = (overrides: Partial<RoundConfig> = {}): RoundConfig => ({
  difficulty: 'easy',
  moduleCount: 4,
  timerMs: 300_000,
  strikeSpeedUpPct: 25,
  modulePool: ['dev-demo'],
  modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false },
  ...overrides,
});

describe('initializeRoundBombs', () => {
  it('persists each team bomb under its per-team bomb key', async () => {
    const store = createMemoryRedisStore();
    await initializeRoundBombs(store, 'sess-1', 1, config(), TEAMS);

    expect(store.data.has(bombKey('sess-1', 'A'))).toBe(true);
    expect(store.data.has(bombKey('sess-1', 'B'))).toBe(true);
  });

  it('returns bombs that deep-equal what was persisted', async () => {
    const store = createMemoryRedisStore();
    const bombs = await initializeRoundBombs(store, 'sess-1', 1, config(), TEAMS);

    for (const teamId of TEAMS) {
      const persisted = JSON.parse(store.data.get(bombKey('sess-1', teamId))!) as BombState;
      expect(persisted).toEqual(bombs[teamId]);
    }
  });

  it('reproduces identical persisted bombs on a retry (same args)', async () => {
    const store1 = createMemoryRedisStore();
    const store2 = createMemoryRedisStore();
    const a = await initializeRoundBombs(store1, 'sess-retry', 2, config(), TEAMS);
    const b = await initializeRoundBombs(store2, 'sess-retry', 2, config(), TEAMS);
    expect(a).toEqual(b);
  });

  it('rejects a bad pool WITHOUT writing any team bomb (no partial round state)', async () => {
    const store = createMemoryRedisStore();
    await expect(
      // 'simon-says' (Epic 7) has no registered generator yet; 'wires' (5.3) and
      // 'the-button' (5.4) are now registered, so they no longer fail loud.
      initializeRoundBombs(store, 'sess-bad', 1, config({ modulePool: ['simon-says'] }), TEAMS),
    ).rejects.toThrow(/unregistered id/);
    expect(store.data.size).toBe(0);
  });

  it('persists only the requested teams', async () => {
    const store = createMemoryRedisStore();
    await initializeRoundBombs(store, 'sess-solo', 1, config(), ['A']);
    expect(store.data.has(bombKey('sess-solo', 'A'))).toBe(true);
    expect(store.data.has(bombKey('sess-solo', 'B'))).toBe(false);
  });
});
