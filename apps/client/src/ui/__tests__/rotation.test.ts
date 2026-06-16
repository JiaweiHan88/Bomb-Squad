import { describe, expect, it } from 'vitest';
import type { TeamState } from '@bomb-squad/shared';
import { upcomingDefuserId } from '../rotation.js';

const team = (relayOrder: string[], currentDefuserIndex: number): TeamState => ({
  teamId: 'A',
  relayOrder,
  currentDefuserIndex,
  cumulativeTimeMs: 0,
  roundTimesMs: [],
});

describe('upcomingDefuserId (must mirror the server rotation pick)', () => {
  it('picks relayOrder[currentDefuserIndex]', () => {
    expect(upcomingDefuserId(team(['maya', 'devon'], 0))).toBe('maya');
    expect(upcomingDefuserId(team(['maya', 'devon'], 1))).toBe('devon');
  });

  it('normalizes an out-of-range index via modulo (matches startRound.ts)', () => {
    expect(upcomingDefuserId(team(['maya', 'devon'], 5))).toBe('devon');
    expect(upcomingDefuserId(team(['maya'], 7))).toBe('maya');
  });

  it('normalizes a negative index to a non-negative pick', () => {
    expect(upcomingDefuserId(team(['maya', 'devon'], -1))).toBe('devon');
  });

  it('returns null for an empty relayOrder', () => {
    expect(upcomingDefuserId(team([], 0))).toBeNull();
  });
});
