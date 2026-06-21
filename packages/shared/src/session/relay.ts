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
 * ── Rotation & completion model (Model B, Story 8.11) ──────────────────────
 * Exactly ONE team is active per round (the other rests). A team's
 * `currentDefuserIndex` is its count of NATURAL rounds played = its next un-played
 * rotation slot; it advances (in `resolveRound`) ONLY when THAT team plays a
 * natural round — pointers are PER-TEAM, not advanced in lockstep. A team of
 * length `n` commits indices `0 … n-1` across its `n` natural rounds (each player
 * Defuser exactly once — AC-1); once the index reaches `n` the team has EXHAUSTED
 * its natural rotation. `startRound` reads the index RAW (no modulo wrap): an
 * exhausted team gets no natural pick — the cap on the old "wraps indefinitely"
 * bug (8.6 human-verification note).
 *
 * This REPLACES Story 8.9's "all teams advance together, index === roundNumber-1,
 * index = last-played slot" invariant (the parallel-defuse model 8.11 corrects).
 *
 * Total natural rounds owed = `maxLen = max(teamA.len, teamB.len)`. The SHORTER
 * team owes `maxLen - len` equalisation rounds (AC-2): one extra round each, with
 * a Facilitator-assigned volunteer Defuser, so both teams play `maxLen` rounds in
 * total. The longer team (and equal-size teams) owe none. A two-team session is
 * `2 × maxLen` turns over `maxLen` shared layout PAIRS; a single-team session is
 * `maxLen` turns.
 *
 * ── Snake turn order (AC-2) ────────────────────────────────────────────────
 * Turns are grouped into pairs (`pairIndex = ceil(roundNumber / 2)`); both teams'
 * matched turns in a pair share the SAME layout (the seed is keyed by `pairIndex`,
 * see Story 8.2 / the ROUND_START handler — FR19). To balance the second-mover
 * spectating advantage the active team alternates by the SNAKE rule: odd pair →
 * A then B, even pair → B then A (A = lower teamId), giving `A,B,B,A,A,B…`.
 * `selectActiveTeam` is the single shared source of that decision.
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

/** A team has an un-played natural rotation slot at its raw current index. */
function hasNaturalSlot(team: TeamState): boolean {
  return team.currentDefuserIndex >= 0 && team.currentDefuserIndex < team.relayOrder.length;
}

/**
 * True while a NATURAL round is still owed to some team — i.e. some team has not
 * yet committed its last player. Under Model B (Story 8.11) the index is the NEXT
 * un-played slot, so a team has a natural round left iff `currentDefuserIndex <
 * relayOrder.length`. (REPLACES 8.9's `index + 1 < len` last-played-slot test.)
 */
export function naturalRoundRemains(session: SessionState): boolean {
  return Object.values(session.teams).some((team) => hasNaturalSlot(team));
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

/**
 * The layout PAIR a turn belongs to (Story 8.11, AC-2). Both teams' matched turns
 * share a pair so they reproduce an IDENTICAL module layout (the seed is keyed by
 * `pairIndex`, not the raw turn `roundNumber` — `templateSeed = hash(sessionId +
 * ":" + pairIndex)`), preserving FR19 (same layout, independent values). `R1,R2 →
 * pair 1`; `R3,R4 → pair 2`; … One line, pure, unit-tested; used by the server bomb
 * generation and any client layout preview so the two never drift.
 */
export function pairIndexFor(roundNumber: number): number {
  return Math.ceil(roundNumber / 2);
}

/**
 * Select the single ACTIVE team for the round ABOUT TO OPEN (Story 8.11, Model B).
 * Pure projection of `SessionState` — SHARED so the server authority
 * (`openPreparation` sets `activeTeamId`; `hasPopulatedTeam` gates the open) and
 * the client (the between-rounds "Up next" surface + the equalisation-volunteer
 * picker) read the SAME decision and can never drift.
 *
 * The round about to open is `roundNumber + 1` (the value AFTER `openPreparation`'s
 * `+1`; in `between-rounds`/`lobby` `roundNumber` is still the just-finished /
 * zero value, so we add one here). Its pair is `pairIndexFor(nextRound)`.
 *
 * SNAKE rule (AC-2): the pair's intended order is odd pair → `[A, B]`, even pair →
 * `[B, A]` (A = lower teamId). The round's POSITION within the pair is its parity:
 * an odd round is the pair's FIRST turn (→ intended[0]), an even round its SECOND
 * (→ intended[1]). We try that positional team first and FALL BACK to the other if
 * it is exhausted (the longer team's tail, or a single-team session where the
 * "other" slot is empty — which is why this is positional, not a naive "first
 * eligible": that would strand a solo team on its second turn).
 *
 * A team is ELIGIBLE iff it still owes a NATURAL round (`currentDefuserIndex <
 * relayOrder.length`) OR an EQUALISATION round (`equalisationRoundsOwed > 0`).
 * Returns `undefined` when neither team is eligible — exactly `isRelayComplete`.
 *
 * NOT a "fewest rounds played" rule (that yields A,B,A,B); the snake is A,B,B,A
 * (Jay, 2026-06-21) to balance the second-mover spectating advantage.
 */
export function selectActiveTeam(session: SessionState): TeamId | undefined {
  const nextRound = session.roundNumber + 1;
  const pairIndex = pairIndexFor(nextRound);
  const owed = equalisationRoundsOwed(session);
  const eligible = (teamId: TeamId): boolean => {
    const team = session.teams[teamId];
    if (team === undefined) return false;
    return hasNaturalSlot(team) || (owed[teamId] ?? 0) > 0;
  };
  // Intended order within the pair (A = lower teamId).
  const intended: [TeamId, TeamId] = pairIndex % 2 === 1 ? ['A', 'B'] : ['B', 'A'];
  // Position in the pair: odd round → first turn, even round → second turn.
  const firstTurn = nextRound % 2 === 1;
  const primary = firstTurn ? intended[0] : intended[1];
  const secondary = firstTurn ? intended[1] : intended[0];
  if (eligible(primary)) return primary;
  if (eligible(secondary)) return secondary;
  return undefined;
}
