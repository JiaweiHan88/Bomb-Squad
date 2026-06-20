import type { SessionState, TeamId, TeamState } from '../types/index.js';

/**
 * Relay-orchestration predicates (Story 8.9, FR43/FR44). Pure projections of
 * `SessionState` — no I/O, no clock, no randomness. SHARED so the server (the
 * authority: `startRound`/`sessionHandlers`) and the client (the facilitator's
 * between-rounds surface: relay-complete notice + equalisation-volunteer picker)
 * read the SAME truth and can never drift — the same reason `rotation.ts` mirrors
 * the server pick. Story 8.8 lifted these out of `apps/server` into shared when
 * the relay UX was wired into the client.
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
 */

/**
 * Minimum players a team needs to FIELD a round (Story 8.9 follow-up). The game
 * is the Defuser↔Expert information split (GDD: "the Defuser sees the bomb but
 * cannot read the manual; Experts read the manual but cannot see the bomb"), so a
 * team of 1 is a Defuser with nobody to read the manual — it can never solve a
 * bomb. A playable team therefore needs at least 2: one Defuser + ≥1 Expert.
 */
export const MIN_TEAM_SIZE = 2;

/**
 * Populated teams that are too small to play (1 player — a lone Defuser with no
 * Expert). Empty teams are NOT flagged (a single-team session is allowed: the one
 * populated team just needs ≥2). The relay can only start when this is empty.
 */
export function undersizedTeams(session: SessionState): TeamId[] {
  return (Object.entries(session.teams) as [TeamId, TeamState][])
    .filter(([, team]) => team.relayOrder.length >= 1 && team.relayOrder.length < MIN_TEAM_SIZE)
    .map(([teamId]) => teamId);
}

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
 * (and equal-size) team owes 0. Only present teams appear in the map.
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
 * AND no equalisation round is still owed (AC-1/AC-4). The pure terminal predicate
 * Story 8.10 imports to transition the session to `'ended'`; 8.9 uses it to GATE
 * the between-rounds advance and the client uses it to show the relay-complete
 * notice instead of a dead "Start next round" button.
 *
 * Degenerate inputs: a session with no populated team is vacuously "complete"
 * (the every/sum over an empty set) — the handler's `hasPopulatedTeam` guard
 * keeps the advance gate from ever acting on one, so this never strands anyone.
 */
export function isRelayComplete(session: SessionState): boolean {
  return !naturalRoundRemains(session) && totalEqualisationOwed(session) === 0;
}
