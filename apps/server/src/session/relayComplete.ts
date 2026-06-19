import type { SessionState, TeamId, TeamState } from '@bomb-squad/shared';

/**
 * Relay-orchestration predicates (Story 8.9, FR43/FR44). Pure projections of
 * `SessionState` — no I/O, no clock, no randomness — co-located with
 * `openPreparation` / `startRound` / `cancelPreparation`. These are the relay's
 * TERMINAL check + odd-team equalisation bookkeeping that 8.9 layers on top of
 * the Story 8.6 simple `+1` rotation advance.
 *
 * ── Rotation & completion model ────────────────────────────────────────────
 * `openPreparation` advances EVERY team's `currentDefuserIndex` by `+1` on each
 * `between-rounds → preparation` open (round 1 from the lobby leaves it at 0). All
 * teams start at 0 and advance together, so at any point the index equals
 * `roundNumber - 1` for every team. A team of length `n` commits its rotation at
 * indices `0 … n-1` across its first `n` rounds (each player Defuser exactly once
 * — AC-1); once the index passes `n-1` the team has EXHAUSTED its natural
 * rotation. `startRound` reads the index RAW (no modulo wrap): an exhausted team
 * gets no natural pick, which is exactly the cap on the old "wraps indefinitely"
 * bug (8.6 human-verification note).
 *
 * Total natural rounds for the session = `maxLen = max(teamA.len, teamB.len)`.
 * The SHORTER team owes `maxLen - len` equalisation rounds (AC-2): one extra
 * round each, with a Facilitator-assigned volunteer Defuser, so both teams play
 * `maxLen` rounds in total. The longer team (and equal-size teams) owe none.
 *
 * NOTE on the equalisation pointer: the index keeps advancing during equalisation
 * rounds too (the uniform `+1` keeps `openPreparation`/`cancelPreparation`
 * symmetric — Story 8.6 decision). That is harmless here because the pick for an
 * equalisation round is the EXPLICIT Facilitator volunteer, never `relayOrder[i]`
 * (the wrap is removed at the source — `startRound`'s raw read), and these
 * predicates count equalisation progress with `equalisationRoundsPlayed`, not the
 * index. This honours the SPIRIT of "equalisation is an explicit pick, not the
 * next rotation slot" while keeping the advance uniform.
 */

/** The longer team's player count — the session's natural round count. 0 if no team. */
export function maxRelayLength(session: SessionState): number {
  let max = 0;
  for (const team of Object.values(session.teams)) {
    if (team.relayOrder.length > max) max = team.relayOrder.length;
  }
  return max;
}

/**
 * True while a NATURAL round is still owed to some team — i.e. the longest team
 * has not yet committed its last player. Detected via the shared pointer: a team
 * has a natural round left iff its NEXT index (`currentDefuserIndex + 1`) is still
 * within `relayOrder`. (In the between-rounds state the index is the last-played
 * slot, so `index + 1 < len` ⟺ "another player remains".)
 */
export function naturalRoundRemains(session: SessionState): boolean {
  return Object.values(session.teams).some(
    (team) => team.currentDefuserIndex + 1 < team.relayOrder.length,
  );
}

/**
 * Equalisation rounds still OWED per team — `max(0, maxLen - len - played)`. The
 * shorter team owes the shortfall minus what it has already played; the longer
 * (and equal-size) team owes 0. Feeds the Task-5 advance gate, the Task-4
 * volunteer surface, and `isRelayComplete`. Only present teams appear in the map.
 */
export function equalisationRoundsOwed(session: SessionState): Partial<Record<TeamId, number>> {
  const maxLen = maxRelayLength(session);
  const owed: Partial<Record<TeamId, number>> = {};
  for (const [teamId, team] of Object.entries(session.teams) as [TeamId, TeamState][]) {
    owed[teamId] = Math.max(0, maxLen - team.relayOrder.length - team.equalisationRoundsPlayed);
  }
  return owed;
}

/** Total equalisation rounds still owed across both teams. */
export function totalEqualisationOwed(session: SessionState): number {
  return Object.values(equalisationRoundsOwed(session)).reduce((sum, n) => sum + (n ?? 0), 0);
}

/**
 * The relay is COMPLETE when every team has committed its full natural rotation
 * AND no equalisation round is still owed (AC-1/AC-4). This is the pure terminal
 * predicate Story 8.10 imports to transition the session to `'ended'`; 8.9 itself
 * only uses it to GATE the between-rounds advance (refuse the silent wrap-around).
 *
 * Degenerate inputs: a session with no populated team is vacuously "complete"
 * (the every/sum over an empty set) — the handler's `hasPopulatedTeam` guard
 * keeps the advance gate from ever acting on one, so this never strands anyone.
 */
export function isRelayComplete(session: SessionState): boolean {
  return !naturalRoundRemains(session) && totalEqualisationOwed(session) === 0;
}
