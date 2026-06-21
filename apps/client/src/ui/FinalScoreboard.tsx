import type { RoundOutcome, TeamId } from '@bomb-squad/shared';
import { buildFinalScoreboard } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { formatTimerDisplay } from '../scenes/timerLcd.js';
import {
  FINAL_EYEBROW,
  FINAL_HEADING,
  FINAL_WINNER,
  FINAL_DRAW,
  FINAL_COMPLETE,
  FINAL_WINNER_BADGE,
  FINAL_DEFUSED_LABEL,
  FINAL_FAILED_LABEL,
  SCOREBOARD_TOTAL,
  SCOREBOARD_ROUND_LABEL,
  TEAM_A,
  TEAM_B,
} from './copy.js';

const TEAM_LABELS: Record<TeamId, string> = { A: TEAM_A, B: TEAM_B };

function isFailure(outcome: RoundOutcome): boolean {
  return outcome === 'exploded' || outcome === 'time-expired';
}

/**
 * Final scoreboard (Story 8.10). Shown to ALL roles once the session reaches
 * `status === 'ended'` (the Facilitator's SESSION_END archived the run). Distinct
 * from the between-rounds preview: this is AUTHORITATIVE — the winner headline reads
 * "wins"/"final", and each round carries its defused ✓ / detonated ✗ outcome.
 *
 * Derived from the SHARED `buildFinalScoreboard(session)` so the client winner can
 * never drift from the server's archived winner. Plain DOM (HUD overlay, no R3F).
 */
export default function FinalScoreboard() {
  const session = useGameStore((s) => s.session);
  if (session === null) return null;

  const final = buildFinalScoreboard(session);

  const headline =
    final.winnerTeamId !== undefined
      ? FINAL_WINNER(TEAM_LABELS[final.winnerTeamId])
      : final.isDraw
        ? FINAL_DRAW
        : FINAL_COMPLETE;

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center p-8">
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.34em] text-brass">{FINAL_EYEBROW}</p>
      <h2 className="mb-2 font-display text-3xl font-bold">{FINAL_HEADING}</h2>
      {/* Winner headline — the display font (UX-DR: "display headline font"). */}
      <p data-testid="final-headline" className="mb-8 font-display text-4xl font-bold text-brass">
        {headline}
      </p>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2" data-testid="final-teams">
        {final.teams.map((team) => {
          const isWinner = team.teamId === final.winnerTeamId;
          return (
            <section
              key={team.teamId}
              data-testid={`final-team-${team.teamId}`}
              className={`rounded-lg bg-surface-raised p-6 ${isWinner ? 'ring-1 ring-brass' : ''}`}
            >
              <header className="mb-4 flex items-center justify-between">
                <span className="font-display text-xl font-bold">{TEAM_LABELS[team.teamId]}</span>
                {isWinner && (
                  <span
                    data-testid={`final-winner-${team.teamId}`}
                    className="rounded-full border border-brass px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-brass"
                  >
                    {FINAL_WINNER_BADGE}
                  </span>
                )}
              </header>

              <ol className="mb-4 flex flex-col gap-1.5">
                {team.rounds.map((round, i) => {
                  const failed = isFailure(round.outcome);
                  return (
                    <li
                      key={i}
                      data-testid={`final-round-${team.teamId}-${i}`}
                      className="flex items-center justify-between text-sm text-ink-muted"
                    >
                      <span className="flex items-center gap-2 font-mono uppercase tracking-wide">
                        <span
                          aria-label={failed ? FINAL_FAILED_LABEL : FINAL_DEFUSED_LABEL}
                          className={failed ? 'text-led-red' : 'text-led-green'}
                        >
                          {failed ? '✗' : '✓'}
                        </span>
                        {SCOREBOARD_ROUND_LABEL} {i + 1}
                      </span>
                      <span className="font-mono tabular-nums text-ink-primary">
                        {formatTimerDisplay(round.elapsedMs)}
                      </span>
                    </li>
                  );
                })}
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
    </div>
  );
}
