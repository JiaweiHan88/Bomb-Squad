import { useEffect, useMemo, useState } from 'react';
import type { ErrorPayload, TeamId } from '@bomb-squad/shared';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';
import ConfirmButton from './ConfirmButton.js';
import ManualViewer from '../manual/ManualViewer.js';
import { buildChapters } from '../manual/chapters.js';
import { SANDBOX_MODULES } from '../modules/index.js';
import { upcomingDefuserId } from './rotation.js';
import {
  PREP_HEADING,
  PREP_GUIDANCE,
  ON_THE_BOMB_NEXT,
  START_THE_ROUND,
  PREP_DEFUSER_LINE,
  PREP_MANUAL_LINE,
  PREP_DEFUSER_PLACEHOLDER,
  TEAM_A,
  TEAM_B,
} from './copy.js';

const TEAM_LABELS: Record<TeamId, string> = { A: TEAM_A, B: TEAM_B };

/** ROUND_START rejections this surface owns (same filtering discipline as Lobby). */
const START_ERROR_CODES: ReadonlySet<string> = new Set([
  'NOT_IN_SESSION',
  'NOT_FACILITATOR',
  'CANNOT_START_ROUND',
  'ROUND_START_FAILED',
]);

/**
 * Preparation phase (Story 8.3, FR8) — one component, role-gated content
 * (EXPERIENCE.md IA #3). Prep has NO countdown: it lasts until the
 * facilitator starts the round (GDD A9; "2–5 min" is guidance copy only).
 *
 * - Facilitator: guidance, the upcoming Defuser per team (derived with the
 *   same rotation expression the server commits at ROUND_START), and the
 *   "Start the round" two-step confirm.
 * - Upcoming defuser: orientation line + the seam where 4.6's placeholder
 *   bomb (module types, no values) will mount.
 * - Experts / Spectators: the real manual (5.2). Chapters come from every
 *   registered module's getManualPages() — the wiring seam 5.2 left open;
 *   5.3+ chapters appear here automatically.
 */
export default function Preparation() {
  const session = useGameStore((s) => s.session);
  const [startError, setStartError] = useState<string | null>(null);

  // getManualPages() is pure and the registry is import-time static — build once.
  const chapters = useMemo(
    () => buildChapters(SANDBOX_MODULES.flatMap((m) => m.getManualPages())),
    [],
  );

  // ROUND_START has no ack — rejections arrive as typed ERRORs. Only
  // start-class codes paint the banner; cleared on the facilitator's own
  // next emit, never on room broadcasts (2.4 review patch pattern).
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: ErrorPayload) => {
      if (START_ERROR_CODES.has(payload.code)) setStartError(payload.message);
    };
    socket.on('ERROR', onError);
    return () => {
      socket.off('ERROR', onError);
    };
  }, []);

  if (session === null) return null;

  const selfId = getSocket().id;
  const self = selfId !== undefined ? session.players[selfId] : undefined;
  const isFacilitator = self?.role === 'facilitator';

  const teams = Object.values(session.teams);
  const upcoming = teams.map((team) => ({
    teamId: team.teamId,
    playerId: upcomingDefuserId(team),
  }));
  const isUpcomingDefuser = upcoming.some((u) => u.playerId === selfId);

  const startRound = () => {
    setStartError(null);
    getSocket().emit('ROUND_START');
  };

  if (isFacilitator) {
    return (
      <div className="flex flex-1 items-start justify-center p-8">
        <section className="w-full max-w-xl rounded-lg bg-surface-raised p-8">
          <h2 className="mb-1 font-display text-lg font-semibold">{PREP_HEADING}</h2>
          <p className="mb-6 text-sm text-ink-muted">{PREP_GUIDANCE}</p>

          <h3 className="mb-2 font-mono text-xs uppercase tracking-widest text-ink-muted">
            {ON_THE_BOMB_NEXT}
          </h3>
          <ul className="mb-6 flex flex-col gap-2" data-testid="upcoming-defusers">
            {upcoming.map(({ teamId, playerId }) => (
              <li key={teamId} className="flex items-center gap-3 rounded-md bg-surface px-4 py-3">
                <span className="rounded-full border border-ink-muted px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                  {TEAM_LABELS[teamId]}
                </span>
                <span className="font-semibold">
                  {playerId !== null ? session.players[playerId]?.displayName : '—'}
                </span>
              </li>
            ))}
          </ul>

          {startError !== null && (
            <p role="alert" className="mb-3 text-sm text-led-red">
              {startError}
            </p>
          )}
          <ConfirmButton label={START_THE_ROUND} onConfirm={startRound} />
        </section>
      </div>
    );
  }

  if (isUpcomingDefuser) {
    return (
      <div className="flex flex-1 items-start justify-center p-8">
        <section className="w-full max-w-xl rounded-lg bg-surface-raised p-8">
          <h2 className="mb-1 font-display text-lg font-semibold">{PREP_DEFUSER_LINE}</h2>
          {/* Story 4.6 seam: the preparation placeholder bomb (module types,
              no values) mounts here in place of this line. */}
          <p className="text-sm text-ink-muted">{PREP_DEFUSER_PLACEHOLDER}</p>
        </section>
      </div>
    );
  }

  // Experts and Spectators browse the full manual during prep (EXPERIENCE.md).
  return (
    <div className="flex flex-1 flex-col">
      <p className="px-8 pt-4 text-sm text-ink-muted">{PREP_MANUAL_LINE}</p>
      <ManualViewer chapters={chapters} />
    </div>
  );
}
