import type { PlayerInfo, RoundState, SessionState, TeamId, TeamState } from '@bomb-squad/shared';
import { equalisationRoundsOwed, selectActiveTeam } from './relayComplete.js';

/**
 * Discriminated result: the handler needs both the next SessionState and the
 * RoundState to persist (two keys), or a machine-readable reason to refuse.
 * Pure functions never throw on bad input (project rule).
 */
export type StartRoundResult =
  | { ok: true; state: SessionState; round: RoundState }
  | { ok: false; reason: 'NOT_IN_PREPARATION' | 'NO_POPULATED_TEAM' | 'EQUALISATION_VOLUNTEER_REQUIRED' };

/**
 * Pure transition: preparation → active, committing the Defuser for the SINGLE
 * ACTIVE team (Story 8.11, Model B). No I/O, no clock, no randomness. (Story 8.3
 * FR11 for the natural pick; Story 8.9 FR43/FR44 for the terminal + odd-team
 * equalisation; Story 8.11 narrows arming from all-populated-teams to one.)
 *
 * The active team is `state.activeTeamId`, selected by `openPreparation` via the
 * shared `selectActiveTeam` snake rule. EXACTLY ONE team is armed; `round.defusers`
 * has ONE entry. The other team RESTS (absent from `round.defusers`, stale
 * 'defuser' demoted to 'expert'). Two per-active-team outcomes:
 *  1. NATURAL round — the active team has an un-played rotation slot
 *     (`0 <= currentDefuserIndex < relayOrder.length`, read RAW). Commit
 *     `relayOrder[currentDefuserIndex]`. The raw read caps the rotation: an
 *     exhausted index yields no natural pick (no wrap).
 *  2. EQUALISATION round — the active team has exhausted its natural rotation but
 *     still OWES an equalisation round. Commit the Facilitator-assigned
 *     `equalisationVolunteerId` (AC-4) — never a wrapped pick. Refuse
 *     (EQUALISATION_VOLUNTEER_REQUIRED) if none is designated: the server never
 *     auto-picks. The `equalisationRoundsPlayed` bump + the volunteer clear happen
 *     at RESOLVE (`resolveRound`), the single pointer-advance site (Story 8.11
 *     Task 2 decision) — `startRound` only READS the volunteer.
 *
 * Role commitment (one Defuser, settled in the story spec):
 * - The selected player becomes 'defuser' — even if currently 'spectator'.
 * - Any OTHER 'defuser' on EITHER team becomes 'expert' (incl. the whole resting
 *   team) so resting players are not stranded on a bomb surface.
 * - The facilitator and off-team players are never touched.
 *
 * RETRY round (Story 8.8, FR14) — takes priority when `state.retryingTeamId` is
 * set. ONLY the retrying team is armed with its SAME Defuser (raw, unadvanced
 * index); the other team rests; `retry: true` drives the resolveRound
 * better-of-two. The retry marker is cleared in the returned state;
 * `equalisationRoundsPlayed`, `activeTeamId`, and every pointer are UNTOUCHED
 * (`retryRound` set `activeTeamId = retryingTeamId` for client routing).
 *
 * Integrity guard: if the active team's selected player is missing from `players`
 * the start is refused (NO_POPULATED_TEAM); an absent/undesignated active team is
 * the same refusal (`openPreparation` always sets a valid `activeTeamId` for a
 * not-complete relay, and `hasPopulatedTeam` gates the open).
 */

/**
 * Whether the NEXT active team has a defuser-able player THIS round — its natural
 * rotation slot's player exists, OR (if exhausted) it owes an equalisation round
 * with a designated, on-roster volunteer. This is exactly `startRound`'s success
 * condition for the team `selectActiveTeam` will pick, so it is the right
 * precondition for opening Preparation: if true a subsequent ROUND_START cannot
 * fail with NO_POPULATED_TEAM. Pure. Returns false when the relay is complete
 * (no eligible team — `selectActiveTeam` is undefined).
 */
export function hasPopulatedTeam(state: SessionState): boolean {
  const activeTeamId = selectActiveTeam(state);
  if (activeTeamId === undefined) return false;
  const team = state.teams[activeTeamId];
  if (team === undefined) return false;
  if (hasNaturalSlot(team)) {
    return state.players[team.relayOrder[team.currentDefuserIndex]!] !== undefined;
  }
  // Equalisation: needs an owed round AND a designated, present volunteer.
  const owed = equalisationRoundsOwed(state);
  return (
    (owed[activeTeamId] ?? 0) > 0 &&
    team.equalisationVolunteerId !== undefined &&
    team.relayOrder.includes(team.equalisationVolunteerId) &&
    state.players[team.equalisationVolunteerId] !== undefined
  );
}

/** A team has an un-played natural rotation slot at its raw current index. */
function hasNaturalSlot(team: TeamState): boolean {
  return team.currentDefuserIndex >= 0 && team.currentDefuserIndex < team.relayOrder.length;
}

export function startRound(state: SessionState): StartRoundResult {
  if (state.status !== 'preparation') return { ok: false, reason: 'NOT_IN_PREPARATION' };

  // (0) RETRY branch (Story 8.8) — priority over the active-team routing. Arm ONLY
  // the retrying team with its SAME Defuser (raw, unadvanced index); the other
  // team rests. retry: true drives the resolveRound better-of-two reconcile.
  if (state.retryingTeamId !== undefined) return startRetryRound(state, state.retryingTeamId);

  // (1) Single active team (Model B). openPreparation set this via selectActiveTeam.
  const activeTeamId = state.activeTeamId;
  const team = activeTeamId !== undefined ? state.teams[activeTeamId] : undefined;
  if (activeTeamId === undefined || team === undefined) {
    return { ok: false, reason: 'NO_POPULATED_TEAM' };
  }

  let defuserId: string;
  if (hasNaturalSlot(team)) {
    // NATURAL pick — raw index, no wrap.
    const playerId = team.relayOrder[team.currentDefuserIndex]!;
    if (state.players[playerId] === undefined) return { ok: false, reason: 'NO_POPULATED_TEAM' };
    defuserId = playerId;
  } else {
    // Active team has exhausted its natural rotation. If it owes nothing either it
    // is not playable this round (defensive — selectActiveTeam would not pick it).
    const owed = equalisationRoundsOwed(state);
    if ((owed[activeTeamId] ?? 0) <= 0) {
      return { ok: false, reason: 'NO_POPULATED_TEAM' };
    }
    // EQUALISATION pick — the Facilitator's explicit volunteer. The played-counter
    // bump + volunteer clear happen in resolveRound (Task 2 single advance site).
    const volunteerId = team.equalisationVolunteerId;
    if (
      volunteerId === undefined ||
      !team.relayOrder.includes(volunteerId) ||
      state.players[volunteerId] === undefined
    ) {
      return { ok: false, reason: 'EQUALISATION_VOLUNTEER_REQUIRED' };
    }
    defuserId = volunteerId;
  }

  const defusers: Partial<Record<TeamId, string>> = { [activeTeamId]: defuserId };

  // Role pass: every POPULATED team is reconciled to the single-Defuser rule —
  // the committed pick is 'defuser', every other 'defuser' on either team
  // (including the entire resting team) is demoted to 'expert'.
  const players: Record<string, PlayerInfo> = { ...state.players };
  for (const player of Object.values(state.players)) {
    if (player.teamId === undefined) continue;
    if (player.playerId === defuserId) {
      if (player.role !== 'defuser') players[player.playerId] = { ...player, role: 'defuser' };
    } else if (player.role === 'defuser') {
      players[player.playerId] = { ...player, role: 'expert' };
    }
  }

  return {
    ok: true,
    state: { ...state, status: 'active', players },
    round: {
      roundNumber: state.roundNumber,
      status: 'active',
      defusers,
      outcomes: {}, // no team resolved yet (Story 8.8).
      retry: false, // Story 8.8 owns retry.
    },
  };
}

/**
 * Commit a RETRY round (Story 8.8): arm ONLY the retrying team with its SAME
 * Defuser (raw index — `retryRound` left the pointer unadvanced, so it still
 * points at the original round's Defuser), rest the other team, and clear the
 * `retryingTeamId` marker. `roundNumber`, every `currentDefuserIndex`, and every
 * `equalisationRoundsPlayed` are UNCHANGED (a retry is the same round, not a new
 * one). Pure — same discipline as `startRound`.
 */
function startRetryRound(state: SessionState, retryingTeamId: TeamId): StartRoundResult {
  const team = state.teams[retryingTeamId];
  // Same-Defuser pick via the raw, unadvanced index. Out-of-range (an exhausted
  // index — i.e. the original was an equalisation round) yields no natural pick:
  // retry of a failed equalisation round is not supported in V1 (see header).
  const defuserId =
    team !== undefined && hasNaturalSlot(team) ? team.relayOrder[team.currentDefuserIndex] : undefined;
  if (defuserId === undefined || state.players[defuserId] === undefined) {
    return { ok: false, reason: 'NO_POPULATED_TEAM' };
  }

  const defusers: Partial<Record<TeamId, string>> = { [retryingTeamId]: defuserId };

  // Role pass: reconcile EVERY populated team to the single-Defuser rule — the
  // retrying team's pick is 'defuser'; every other 'defuser' on either team
  // (including the entire resting team) is demoted to 'expert' so resting players
  // are not stranded on the bomb surface (the Story 8.9 resting posture).
  const players: Record<string, PlayerInfo> = { ...state.players };
  for (const player of Object.values(state.players)) {
    if (player.teamId === undefined) continue;
    if (player.playerId === defuserId) {
      if (player.role !== 'defuser') players[player.playerId] = { ...player, role: 'defuser' };
    } else if (player.role === 'defuser') {
      players[player.playerId] = { ...player, role: 'expert' };
    }
  }

  // Clear the consumed retry marker (immutable rest-destructure). roundNumber,
  // pointers, and equalisation counters are untouched.
  const { retryingTeamId: _consumed, ...rest } = state;

  return {
    ok: true,
    state: { ...rest, status: 'active', players },
    round: {
      roundNumber: state.roundNumber,
      status: 'active',
      defusers,
      outcomes: {},
      retry: true,
    },
  };
}
