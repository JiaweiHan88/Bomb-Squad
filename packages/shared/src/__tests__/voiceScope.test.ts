import { describe, expect, it } from '@jest/globals';
import {
  resolveVoiceScope,
  VoiceScopeError,
  bombRoomName,
  spectatorLoungeName,
  lobbyRoomName,
  type PlayerRole,
  type SessionState,
  type TeamId,
} from '../index.js';

/**
 * Unit tests for the canonical voice-scope helper (Story 3.5, AR16: pure logic,
 * zero infra). This is the SINGLE source of truth the server token minting and
 * the client re-mint reconciler both derive from — so the table here is the
 * contract that keeps them from drifting. The spectator `canPublish: false`
 * invariant (FR39) is asserted explicitly and is non-negotiable.
 */

const SID = 'sess1';

describe('resolveVoiceScope (shared)', () => {
  it('scopes a defuser to the team Bomb Room with publish + subscribe', () => {
    expect(resolveVoiceScope({ role: 'defuser', sessionId: SID, teamId: 'A' })).toEqual({
      room: 'bomb-room:sess1:A',
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('scopes an expert to its team Bomb Room (distinct room per team)', () => {
    expect(resolveVoiceScope({ role: 'expert', sessionId: SID, teamId: 'B' }).room).toBe(
      'bomb-room:sess1:B',
    );
  });

  it('scopes a spectator to the listen-only Spectator Lounge (canPublish false)', () => {
    expect(resolveVoiceScope({ role: 'spectator', sessionId: SID })).toEqual({
      room: 'spectator-lounge:sess1',
      canPublish: false,
      canSubscribe: true,
    });
  });

  it('scopes a facilitator to the Spectator Lounge WITH publish (host narration)', () => {
    expect(resolveVoiceScope({ role: 'facilitator', sessionId: SID })).toEqual({
      room: 'spectator-lounge:sess1',
      canPublish: true,
      canSubscribe: true,
    });
  });

  it('does not require a teamId for a facilitator (lounge-scoped, never throws)', () => {
    expect(() => resolveVoiceScope({ role: 'facilitator', sessionId: SID })).not.toThrow();
  });

  it('throws VoiceScopeError for a Bomb Room role with no team (outside the lobby)', () => {
    expect(() => resolveVoiceScope({ role: 'defuser', sessionId: SID })).toThrow(VoiceScopeError);
    expect(() => resolveVoiceScope({ role: 'expert', sessionId: SID })).toThrow(VoiceScopeError);
  });

  // ── Lobby mic-check phase (Story 2.5) ──────────────────────────────────────
  it('lobby phase scopes EVERY role to the shared lobby room with publish', () => {
    const roles: PlayerRole[] = ['defuser', 'expert', 'spectator', 'facilitator'];
    for (const role of roles) {
      // No teamId even for a Bomb Room role — the lobby branch precedes the team check.
      expect(resolveVoiceScope({ role, sessionId: SID, phase: 'lobby' })).toEqual({
        room: 'lobby:sess1',
        canPublish: true,
        canSubscribe: true,
      });
    }
  });

  it('the SAME spectator reverts to the listen-only lounge outside the lobby', () => {
    const phases: SessionState['status'][] = ['preparation', 'active', 'between-rounds', 'ended'];
    for (const phase of phases) {
      const scope = resolveVoiceScope({ role: 'spectator', sessionId: SID, phase });
      expect(scope.room).toBe('spectator-lounge:sess1');
      expect(scope.canPublish).toBe(false);
    }
  });

  // ── Effective-scope nuance (Story 3.5 AC #3) ───────────────────────────────
  it('Defuser and Expert on the SAME team resolve to an IDENTICAL scope (no re-mint trigger)', () => {
    const teamId: TeamId = 'A';
    const def = resolveVoiceScope({ role: 'defuser', sessionId: SID, teamId, phase: 'active' });
    const exp = resolveVoiceScope({ role: 'expert', sessionId: SID, teamId, phase: 'active' });
    expect(def).toEqual(exp);
  });

  it('Defuser→Spectator is a real scope CHANGE (room + publish both differ)', () => {
    const def = resolveVoiceScope({ role: 'defuser', sessionId: SID, teamId: 'A', phase: 'active' });
    const spec = resolveVoiceScope({ role: 'spectator', sessionId: SID, phase: 'active' });
    expect(def.room).not.toBe(spec.room);
    expect(def.canPublish).not.toBe(spec.canPublish);
  });
});

describe('room-name builders', () => {
  it('build the documented room names', () => {
    expect(bombRoomName('s', 'A')).toBe('bomb-room:s:A');
    expect(spectatorLoungeName('s')).toBe('spectator-lounge:s');
    expect(lobbyRoomName('s')).toBe('lobby:s');
  });
});
