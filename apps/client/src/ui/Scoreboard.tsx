import { useEffect, useState } from 'react';
import type { ErrorPayload, TeamId, TeamState } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';
import { formatTimerDisplay } from '../scenes/timerLcd.js';
import ConfirmButton from './ConfirmButton.js';
import {
  SCOREBOARD_EYEBROW,
  SCOREBOARD_HEADING,
  SCOREBOARD_LEADING,
  SCOREBOARD_TOTAL,
  SCOREBOARD_ROUND_LABEL,
  START_NEXT_ROUND,
  BETWEEN_ROUNDS_WAITING,
  TEAM_A,
  TEAM_B,
} from './copy.js';

const TEAM_LABELS: Record<TeamId, string> = { A: TEAM_A, B: TEAM_B };
const TEAM_ORDER: TeamId[] = ['A', 'B'];

/** PREPARATION_OPEN rejections this surface owns (same discipline as Preparation). */
const ADVANCE_ERROR_CODES: ReadonlySet<string> = new Set([
  'NOT_IN_SESSION',
  'NOT_FACILITATOR',
  'CANNOT_OPEN_PREP',
  'PREPARATION_OPEN_FAILED',
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

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
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
          <ConfirmButton label={START_NEXT_ROUND} onConfirm={advance} />
        ) : (
          <p className="text-sm text-ink-muted">{BETWEEN_ROUNDS_WAITING}</p>
        )}
      </div>
    </div>
  );
}
