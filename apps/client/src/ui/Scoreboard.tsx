import { useEffect, useState } from 'react';
import type { ErrorPayload, TeamId, TeamState } from '@bomb-squad/shared';
import { isRelayComplete, naturalRoundRemains, equalisationRoundsOwed } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';
import { formatTimerDisplay } from '../scenes/timerLcd.js';
import ConfirmButton from './ConfirmButton.js';
import Button from './Button.js';
import PauseOverlay from './PauseOverlay.js';
import {
  SCOREBOARD_EYEBROW,
  SCOREBOARD_HEADING,
  SCOREBOARD_LEADING,
  SCOREBOARD_TOTAL,
  SCOREBOARD_ROUND_LABEL,
  START_NEXT_ROUND,
  BETWEEN_ROUNDS_WAITING,
  RETRY_ROUND,
  RETRY_ROUND_TEAM,
  EQUALISATION_HEADING,
  EQUALISATION_PROMPT,
  EQUALISATION_NEEDS_VOLUNTEER,
  RELAY_COMPLETE_NOTICE,
  TEAM_A,
  TEAM_B,
} from './copy.js';

const TEAM_LABELS: Record<TeamId, string> = { A: TEAM_A, B: TEAM_B };
const TEAM_ORDER: TeamId[] = ['A', 'B'];

/**
 * PREPARATION_OPEN + ROUND_RETRY + equalisation rejections this surface owns
 * (same discipline as Preparation). The retry codes (Story 8.8) and the relay /
 * equalisation codes (Story 8.9) paint the same inline alert so nothing fails
 * silently.
 */
const ADVANCE_ERROR_CODES: ReadonlySet<string> = new Set([
  'NOT_IN_SESSION',
  'NOT_FACILITATOR',
  'CANNOT_OPEN_PREP',
  'PREPARATION_OPEN_FAILED',
  'CANNOT_RETRY',
  'ROUND_NOT_FAILED',
  'ROUND_RETRY_FAILED',
  'RELAY_COMPLETE',
  'EQUALISATION_VOLUNTEER_REQUIRED',
  'NO_EQUALISATION_ROUND',
  'INVALID_VOLUNTEER',
]);

/**
 * Provisional leader for the preview (Story 8.6): the team with the strictly
 * lowest cumulative time among teams that have recorded at least one round.
 * Mirrors the server's `buildScoreboard`. Undefined on a tie / no rounds played.
 * Derived from `session.teams` so it is correct on reconnect (no SCOREBOARD
 * event needed). NOT a session winner — that is Story 8.10.
 */
function provisionalLeader(teams: TeamState[]): TeamId | undefined {
  let leader: TeamId | undefined;
  let best = Infinity;
  let tied = false;
  for (const team of teams) {
    if (team.roundTimesMs.length === 0) continue;
    if (team.cumulativeTimeMs < best) {
      best = team.cumulativeTimeMs;
      leader = team.teamId;
      tied = false;
    } else if (team.cumulativeTimeMs === best) {
      tied = true;
    }
  }
  return tied ? undefined : leader;
}

/**
 * Between-rounds scoreboard preview (Story 8.6). Shown to ALL roles while
 * `session.status === 'between-rounds'`. The next round does not start
 * automatically — the Facilitator advances with "Start next round"
 * (PREPARATION_OPEN), which rotates to the next Defuser.
 *
 * Plain DOM surface (no R3F) — the scoreboard is HUD/overlay, no Three.js
 * objects. Data is derived from the authoritative `session.teams` snapshot
 * (`cumulativeTimeMs` + `roundTimesMs`), so it renders correctly even on a
 * reconnect that arrives without the one-shot SCOREBOARD event.
 */
export default function Scoreboard() {
  const session = useGameStore((s) => s.session);
  const selfId = useGameStore((s) => s.myPlayerId);
  // The one-shot SCOREBOARD payload carries which team(s) failed the just-resolved
  // round (Story 8.8) — drives the facilitator's "Retry round" affordance.
  const scoreboard = useGameStore((s) => s.scoreboard);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // PREPARATION_OPEN has no ack — rejections arrive as typed ERRORs. Only
  // advance-class codes paint the banner; cleared on the facilitator's own next
  // emit, never on room broadcasts (2.4 review patch pattern).
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: ErrorPayload) => {
      if (ADVANCE_ERROR_CODES.has(payload.code)) setAdvanceError(payload.message);
    };
    socket.on('ERROR', onError);
    return () => {
      socket.off('ERROR', onError);
    };
  }, []);

  if (session === null) return null;

  const self = selfId !== null ? session.players[selfId] : undefined;
  const isFacilitator = self?.role === 'facilitator';

  const teams = TEAM_ORDER.map((id) => session.teams[id]).filter(
    (t): t is TeamState => t !== undefined,
  );
  const leader = provisionalLeader(teams);

  const advance = () => {
    setAdvanceError(null);
    getSocket().emit('PREPARATION_OPEN');
  };

  // Teams whose just-resolved round failed (Story 8.8). Only the facilitator gets
  // the confirm-gated "Retry round" affordance, and only for a failed team — a
  // defused round offers no retry (AC-3). The server re-checks eligibility.
  const failedTeams = (scoreboard?.failedTeams ?? []).filter((id) => session.teams[id] !== undefined);
  const retryRound = (teamId: TeamId) => {
    setAdvanceError(null);
    getSocket().emit('ROUND_RETRY', { teamId });
  };

  // Relay orchestration (Story 8.9) — derived from the SAME shared predicates the
  // server authority uses, so the facilitator UI can never drift from the server.
  const relayComplete = isRelayComplete(session);
  const owed = equalisationRoundsOwed(session);
  // Equalisation phase: every natural rotation is exhausted but the shorter team
  // still owes an extra round (with a Facilitator-chosen volunteer Defuser).
  const equalisationPhase = !relayComplete && !naturalRoundRemains(session);
  const owingTeams = TEAM_ORDER.filter(
    (id) => session.teams[id] !== undefined && (owed[id] ?? 0) > 0,
  );
  const needsVolunteer =
    equalisationPhase && owingTeams.some((id) => session.teams[id]!.equalisationVolunteerId === undefined);

  // Designate the equalisation volunteer (reuses TEAM_ASSIGN — the server routes a
  // between-rounds role-only assign to the volunteer designation, Story 8.9).
  const designateVolunteer = (teamId: TeamId, playerId: string) => {
    setAdvanceError(null);
    getSocket().emit('TEAM_ASSIGN', { playerId, teamId, role: 'defuser' });
  };

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center p-8">
      {/* Pause surface (Story 8.7): facilitator break-glass Pause + "Holding the
          clock" strip when the between-rounds session is paused. */}
      <PauseOverlay />
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.34em] text-brass">
        {SCOREBOARD_EYEBROW}
      </p>
      <h2 className="mb-8 font-display text-3xl font-bold">{SCOREBOARD_HEADING}</h2>

      <div
        className="grid w-full max-w-3xl gap-4 sm:grid-cols-2"
        data-testid="scoreboard-teams"
      >
        {teams.map((team) => {
          const isLeader = team.teamId === leader;
          return (
            <section
              key={team.teamId}
              data-testid={`scoreboard-team-${team.teamId}`}
              className={`rounded-lg bg-surface-raised p-6 ${
                isLeader ? 'ring-1 ring-brass' : ''
              }`}
            >
              <header className="mb-4 flex items-center justify-between">
                <span className="font-display text-xl font-bold">{TEAM_LABELS[team.teamId]}</span>
                {isLeader && (
                  <span
                    data-testid={`scoreboard-leader-${team.teamId}`}
                    className="rounded-full border border-brass px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-brass"
                  >
                    {SCOREBOARD_LEADING}
                  </span>
                )}
              </header>

              <ol className="mb-4 flex flex-col gap-1.5">
                {team.roundTimesMs.map((ms, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between text-sm text-ink-muted"
                  >
                    <span className="font-mono uppercase tracking-wide">
                      {SCOREBOARD_ROUND_LABEL} {i + 1}
                    </span>
                    <span className="font-mono tabular-nums text-ink-primary">
                      {formatTimerDisplay(ms)}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="flex items-center justify-between border-t border-ink-muted/20 pt-3">
                <span className="font-mono text-xs uppercase tracking-widest text-ink-muted">
                  {SCOREBOARD_TOTAL}
                </span>
                <span className="font-mono text-lg font-bold tabular-nums">
                  {formatTimerDisplay(team.cumulativeTimeMs)}
                </span>
              </div>
            </section>
          );
        })}
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        {advanceError !== null && (
          <p role="alert" className="text-sm text-led-red">
            {advanceError}
          </p>
        )}
        {isFacilitator ? (
          <>
            {/* Retry a failed round (Story 8.8): one confirm-gated button per
                failed team. Single team → unlabelled "Retry round"; both failed →
                per-team labels so the facilitator picks. Available even at relay
                completion (a failed final round is still retryable). */}
            {failedTeams.map((teamId) => (
              <ConfirmButton
                key={teamId}
                label={failedTeams.length > 1 ? RETRY_ROUND_TEAM(TEAM_LABELS[teamId]) : RETRY_ROUND}
                onConfirm={() => retryRound(teamId)}
              />
            ))}

            {relayComplete ? (
              /* Relay done — everyone defused. No advance (session-end is 8.10);
                 show a clear notice instead of a dead button (Story 8.9 fix). */
              <p data-testid="relay-complete" className="text-sm text-ink-muted">
                {RELAY_COMPLETE_NOTICE}
              </p>
            ) : equalisationPhase ? (
              /* Odd-team equalisation (Story 8.9): the shorter team plays an extra
                 round with a Facilitator-chosen volunteer Defuser. Pick first, then
                 start — the advance is gated until a volunteer is chosen. */
              <>
                {owingTeams.map((teamId) => {
                  const team = session.teams[teamId]!;
                  const chosen = team.equalisationVolunteerId;
                  return (
                    <div
                      key={teamId}
                      data-testid={`equalisation-${teamId}`}
                      className="flex flex-col items-center gap-2"
                    >
                      <p className="font-mono text-xs uppercase tracking-widest text-brass">
                        {EQUALISATION_HEADING}
                      </p>
                      <p className="text-sm text-ink-muted">
                        {EQUALISATION_PROMPT(TEAM_LABELS[teamId])}
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {team.relayOrder.map((pid) => (
                          <Button
                            key={pid}
                            variant={pid === chosen ? 'primary' : 'secondary'}
                            onClick={() => designateVolunteer(teamId, pid)}
                          >
                            {session.players[pid]?.displayName ?? pid}
                          </Button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {needsVolunteer && (
                  <p className="text-sm text-ink-muted">{EQUALISATION_NEEDS_VOLUNTEER}</p>
                )}
                <ConfirmButton label={START_NEXT_ROUND} onConfirm={advance} disabled={needsVolunteer} />
              </>
            ) : (
              <ConfirmButton label={START_NEXT_ROUND} onConfirm={advance} />
            )}
          </>
        ) : (
          <p className="text-sm text-ink-muted">{BETWEEN_ROUNDS_WAITING}</p>
        )}
      </div>
    </div>
  );
}
