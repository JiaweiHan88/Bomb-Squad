import { describe, expect, it } from 'vitest';
import type { TeamState } from '@bomb-squad/shared';
import { upcomingDefuserId } from '../rotation.js';

const team = (
  relayOrder: string[],
  currentDefuserIndex: number,
  extra: Partial<TeamState> = {},
): TeamState => ({
  teamId: 'A',
  relayOrder,
  currentDefuserIndex,
  cumulativeTimeMs: 0,
  roundTimesMs: [],
  equalisationRoundsPlayed: 0,
  ...extra,
});

describe('upcomingDefuserId (must mirror the server rotation pick)', () => {
  it('picks relayOrder[currentDefuserIndex] for a natural rotation slot', () => {
    expect(upcomingDefuserId(team(['maya', 'devon'], 0))).toBe('maya');
    expect(upcomingDefuserId(team(['maya', 'devon'], 1))).toBe('devon');
  });

  it('Story 8.9: an exhausted index no longer wraps — returns the volunteer or null', () => {
    // Index past the last player (the old modulo would have wrapped to player 0).
    expect(upcomingDefuserId(team(['maya', 'devon'], 2))).toBeNull();
    expect(upcomingDefuserId(team(['maya'], 7))).toBeNull();
    // With a Facilitator-designated equalisation volunteer, that is the upcoming Defuser.
    expect(upcomingDefuserId(team(['maya', 'devon'], 2, { equalisationVolunteerId: 'maya' }))).toBe(
      'maya',
    );
  });

  it('returns null for an empty relayOrder', () => {
    expect(upcomingDefuserId(team([], 0))).toBeNull();
  });
});
