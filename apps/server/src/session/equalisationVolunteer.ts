import type { PlayerInfo, SessionState, TeamId, TeamState } from '@bomb-squad/shared';
import { equalisationRoundsOwed } from './relayComplete.js';

export interface DesignateVolunteerArgs {
  /** The team that owes the equalisation round. */
  teamId: TeamId;
  /** Roster key of the already-defused player the Facilitator picks to repeat. */
  playerId: string;
}

export type DesignateVolunteerResult =
  | { ok: true; state: SessionState }
  | { ok: false; reason: 'NO_EQUALISATION_OWED' | 'NOT_ON_TEAM' };

/**
 * Pure transition (Story 8.9 AC-2, FR44): designate the Facilitator's volunteer
 * Defuser for a team's NEXT equalisation round. No I/O, no clock, no randomness.
 *
 * This is the documented EXCEPTION to "rotation is the sole Defuser authority"
 * (Story 8.6 decision (c)): an odd-team equalisation round repeats an
 * already-defused player, and that player is the Facilitator's explicit choice —
 * the server never auto-picks. It is reached by REUSING the existing `TEAM_ASSIGN`
 * event (no new socket event — Story 8.9 Task 1): when the session is between
 * rounds / in preparation and the named team owes an equalisation round, a
 * `TEAM_ASSIGN` for an on-team player routes here instead of `assignPlayerToTeam`.
 *
 * Deliberately NARROW (the deferred-work.md between-rounds-assignment can of
 * worms): this is a ROLE-ONLY designation — it never moves teams, never mutates
 * `relayOrder`, never touches `currentDefuserIndex`. So it cannot desynchronise
 * the rotation pointer the way a between-rounds team move could.
 *
 * Effects (immutable — spread, never mutate in place):
 * - records `team.equalisationVolunteerId = playerId` (consumed + cleared by
 *   `startRound` when the equalisation round commits);
 * - sets the chosen player's role to 'defuser' and demotes any OTHER 'defuser' on
 *   that team to 'expert' (the single-Defuser discipline `startRound` also keeps),
 *   so the prep surface shows the volunteer as the upcoming Defuser.
 *
 * Guards (defensive — the handler validates first, but pure functions never
 * trust): the team must currently OWE an equalisation round (else there is no
 * equalisation round to staff — `NO_EQUALISATION_OWED`); the player must already
 * be on that team's `relayOrder`, i.e. have defused before (`NOT_ON_TEAM`).
 * Re-asserting the same volunteer returns the same reference (idempotent no-op).
 */
export function designateEqualisationVolunteer(
  state: SessionState,
  args: DesignateVolunteerArgs,
): DesignateVolunteerResult {
  const team = state.teams[args.teamId];
  if (team === undefined) return { ok: false, reason: 'NOT_ON_TEAM' };

  if ((equalisationRoundsOwed(state)[args.teamId] ?? 0) <= 0) {
    return { ok: false, reason: 'NO_EQUALISATION_OWED' };
  }

  // The volunteer must be an already-defused player on this team (its relayOrder),
  // and still on the roster.
  if (!team.relayOrder.includes(args.playerId) || state.players[args.playerId] === undefined) {
    return { ok: false, reason: 'NOT_ON_TEAM' };
  }

  // Idempotent no-op: the same volunteer is already designated and holds the role.
  if (
    team.equalisationVolunteerId === args.playerId &&
    state.players[args.playerId]?.role === 'defuser'
  ) {
    return { ok: true, state };
  }

  const nextTeam: TeamState = { ...team, equalisationVolunteerId: args.playerId };

  // Role discipline: exactly one Defuser on the team — the volunteer.
  const players: Record<string, PlayerInfo> = { ...state.players };
  for (const player of Object.values(state.players)) {
    if (player.teamId !== args.teamId) continue;
    if (player.playerId === args.playerId) {
      if (player.role !== 'defuser') players[player.playerId] = { ...player, role: 'defuser' };
    } else if (player.role === 'defuser') {
      players[player.playerId] = { ...player, role: 'expert' };
    }
  }

  return {
    ok: true,
    state: { ...state, players, teams: { ...state.teams, [args.teamId]: nextTeam } },
  };
}
