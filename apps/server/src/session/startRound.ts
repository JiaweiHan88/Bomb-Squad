import type { PlayerInfo, RoundState, SessionState, TeamId, TeamState } from '@bomb-squad/shared';
import { equalisationRoundsOwed } from './relayComplete.js';

/**
 * Discriminated result: the handler needs both the next SessionState and the
 * RoundState to persist (two keys), or a machine-readable reason to refuse.
 * Pure functions never throw on bad input (project rule).
 */
export type StartRoundResult =
  | { ok: true; state: SessionState; round: RoundState }
  | { ok: false; reason: 'NOT_IN_PREPARATION' | 'NO_POPULATED_TEAM' | 'EQUALISATION_VOLUNTEER_REQUIRED' };

/**
 * Pure transition: preparation → active, committing the Defuser per team. No I/O,
 * no clock, no randomness. (Story 8.3 FR11 for the natural pick; Story 8.9
 * FR43/FR44 for the relay terminal + odd-team equalisation layered on top.)
 *
 * THREE per-team outcomes (Story 8.9):
 *  1. NATURAL round — the team still has an un-played rotation slot
 *     (`0 <= currentDefuserIndex < relayOrder.length`, read RAW). Commit
 *     `relayOrder[currentDefuserIndex]`. This REPLACES the old non-negative
 *     modulo: the modulo silently WRAPPED past the last player (the "rotation
 *     wraps indefinitely" bug 8.6 handed to 8.9). Reading the index raw caps the
 *     rotation — an exhausted team's index points past its `relayOrder`, so it
 *     gets no natural pick. (This is also the read-side resolution of the
 *     deferred index-clamp item: an out-of-range index yields "exhausted", never
 *     a wrong-player wrap. Negative is unreachable — `cancelPreparation` never
 *     decrements below the round-1 value.)
 *  2. EQUALISATION round — NO team has a natural slot left (the natural rotation
 *     is exhausted for everyone) AND this team still OWES an equalisation round.
 *     Commit the Facilitator-assigned `equalisationVolunteerId` (AC-2) — never a
 *     wrapped rotation pick. The server refuses (EQUALISATION_VOLUNTEER_REQUIRED)
 *     if the Facilitator has not designated one: it never auto-picks. On commit,
 *     `equalisationRoundsPlayed` increments and the volunteer field is cleared so
 *     the next owed round needs a fresh designation.
 *  3. REST — the team has no natural slot and is not equalising this round (a
 *     shorter team during the longer team's natural tail, or the longer team
 *     during the shorter team's equalisation). It is absent from `round.defusers`
 *     (no bomb armed — sessionHandlers ROUND_START arms only teams in
 *     `round.defusers`), and any stale 'defuser' on it is demoted to 'expert' so
 *     its players are NOT stranded on the bomb surface (resolves deferred-work.md
 *     "stale defuser on a skipped team" — Story 8.9 Task 6). They see the
 *     role-gated manual / standby surface; a live cross-team spectator view is
 *     Epic 9 (Spectator Lounge), not this story.
 *
 * Role commitment (one Defuser per team, settled in the story spec):
 * - The selected player becomes 'defuser' — even if currently 'spectator'.
 * - Any OTHER 'defuser' on that team becomes 'expert' (incl. on a resting team).
 * - The facilitator and off-team players are never touched.
 *
 * RETRY round (Story 8.8, FR14) — takes priority over the three outcomes above
 * when `state.retryingTeamId` is set (the Facilitator triggered a retry of a
 * FAILED round via `retryRound`). ONLY the retrying team is armed, with its SAME
 * Defuser as the original attempt: because `retryRound` left `currentDefuserIndex`
 * UNADVANCED, the raw index `relayOrder[currentDefuserIndex]` still points at the
 * round's committed Defuser (correct for a natural-round retry). The other team
 * RESTS (absent from `round.defusers`, stale 'defuser' demoted — same posture as
 * REST above). The `RoundState` is built with `retry: true` so `resolveRound`
 * records the BETTER of the two times in place. The marker is cleared in the
 * returned state; `equalisationRoundsPlayed` and every pointer are UNTOUCHED.
 * Limitation (deferred, V1): retry of a *failed equalisation round* (whose
 * original Defuser was a Facilitator volunteer, not `relayOrder[idx]`) is NOT
 * supported — the exhausted index yields no natural pick, so the retry refuses
 * NO_POPULATED_TEAM. Equalisation rounds are the rare odd-team tail; the common
 * retry target is a natural round. Carry the volunteer to support it later.
 *
 * Integrity guard: a team whose selected NATURAL relayOrder entry is missing from
 * `players` is skipped rather than crashing; if every team ends with no committed
 * Defuser the start is refused.
 */

/**
 * Whether at least one team has a defuser-able player THIS round — a natural
 * rotation slot whose player still exists, OR an owed equalisation round with a
 * designated, on-roster volunteer. This is exactly `startRound`'s success
 * condition, so it is the right precondition for opening Preparation: if this is
 * true a subsequent ROUND_START cannot fail with NO_POPULATED_TEAM. Pure.
 */
export function hasPopulatedTeam(state: SessionState): boolean {
  const naturalPhase = Object.values(state.teams).some((team) => hasNaturalSlot(team));
  if (naturalPhase) {
    return Object.values(state.teams).some(
      (team) => hasNaturalSlot(team) && state.players[team.relayOrder[team.currentDefuserIndex]!] !== undefined,
    );
  }
  // Equalisation phase: a team is startable iff it owes a round AND its volunteer
  // is designated and present.
  const owed = equalisationRoundsOwed(state);
  return Object.values(state.teams).some(
    (team) =>
      (owed[team.teamId] ?? 0) > 0 &&
      team.equalisationVolunteerId !== undefined &&
      team.relayOrder.includes(team.equalisationVolunteerId) &&
      state.players[team.equalisationVolunteerId] !== undefined,
  );
}

/** A team has an un-played natural rotation slot at its raw current index. */
function hasNaturalSlot(team: TeamState): boolean {
  return team.currentDefuserIndex >= 0 && team.currentDefuserIndex < team.relayOrder.length;
}

export function startRound(state: SessionState): StartRoundResult {
  if (state.status !== 'preparation') return { ok: false, reason: 'NOT_IN_PREPARATION' };

  // (0) RETRY branch (Story 8.8) — priority over the natural/equalisation routing.
  // Arm ONLY the retrying team with its SAME Defuser (raw, unadvanced index); the
  // other team rests. retry: true drives the resolveRound better-of-two reconcile.
  if (state.retryingTeamId !== undefined) return startRetryRound(state, state.retryingTeamId);

  const naturalPhase = Object.values(state.teams).some((team) => hasNaturalSlot(team));
  const owed = equalisationRoundsOwed(state);

  const defusers: Partial<Record<TeamId, string>> = {};
  // Teams that committed an equalisation pick this round — counter bumped +
  // volunteer cleared below.
  const equalisingTeams = new Set<TeamId>();

  for (const team of Object.values(state.teams)) {
    if (hasNaturalSlot(team)) {
      // (1) NATURAL pick — raw index, no wrap.
      const playerId = team.relayOrder[team.currentDefuserIndex]!;
      if (state.players[playerId] === undefined) continue; // integrity skip
      defusers[team.teamId] = playerId;
    } else if (!naturalPhase && (owed[team.teamId] ?? 0) > 0) {
      // (2) EQUALISATION pick — the Facilitator's explicit volunteer.
      const volunteerId = team.equalisationVolunteerId;
      if (
        volunteerId === undefined ||
        !team.relayOrder.includes(volunteerId) ||
        state.players[volunteerId] === undefined
      ) {
        return { ok: false, reason: 'EQUALISATION_VOLUNTEER_REQUIRED' };
      }
      defusers[team.teamId] = volunteerId;
      equalisingTeams.add(team.teamId);
    }
    // (3) else REST — no pick; handled in the role + bookkeeping passes below.
  }

  if (Object.keys(defusers).length === 0) return { ok: false, reason: 'NO_POPULATED_TEAM' };

  // Role pass: every POPULATED team is reconciled to the single-Defuser rule —
  // the committed pick (if any) is 'defuser', every other 'defuser' on the team
  // (including all of a resting team's) is demoted to 'expert'.
  const players: Record<string, PlayerInfo> = { ...state.players };
  for (const team of Object.values(state.teams)) {
    const defuserId = defusers[team.teamId];
    for (const player of Object.values(state.players)) {
      if (player.teamId !== team.teamId) continue;
      if (player.playerId === defuserId) {
        if (player.role !== 'defuser') players[player.playerId] = { ...player, role: 'defuser' };
      } else if (player.role === 'defuser') {
        players[player.playerId] = { ...player, role: 'expert' };
      }
    }
  }

  // Equalisation bookkeeping: increment the played counter and clear the consumed
  // volunteer for every team that equalised this round (immutable spread).
  let teams = state.teams;
  if (equalisingTeams.size > 0) {
    teams = { ...state.teams };
    for (const teamId of equalisingTeams) {
      const team = state.teams[teamId]!;
      const { equalisationVolunteerId: _consumed, ...rest } = team;
      teams[teamId] = { ...rest, equalisationRoundsPlayed: team.equalisationRoundsPlayed + 1 };
    }
  }

  return {
    ok: true,
    state: { ...state, status: 'active', players, teams },
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
