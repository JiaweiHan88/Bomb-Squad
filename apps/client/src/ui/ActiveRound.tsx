import { useMemo, type ReactNode } from 'react';
import { useGameStore } from '../store/gameStore.js';
import BombStage from '../scenes/BombStage.js';
import BombScene from '../scenes/BombScene.js';
import ManualViewer from '../manual/ManualViewer.js';
import { buildChapters } from '../manual/chapters.js';
import { SANDBOX_MODULES } from '../modules/index.js';
import ResolutionBanner from './ResolutionBanner.js';
import VoiceController from './VoiceController.js';
import PauseOverlay from './PauseOverlay.js';
import SpeakerIndicator from './SpeakerIndicator.js';
import MuteControl from './MuteControl.js';
import AudioUnblockPrompt from './AudioUnblockPrompt.js';
import { ROUND_IN_PROGRESS, WATCHING_THE_BOMB_ROOM, RESTING_SPECTATE } from './copy.js';

/**
 * Active-round surface routing (Story 8.3, FR11) — the same session URL shows
 * a different primary surface per committed role (EXPERIENCE.md role-gating
 * principle; roles never see each other's surface).
 *
 * ACTIVE-TEAM ROUTING (Story 8.11, Model B): exactly one team plays per round.
 * We route by ACTIVE TEAM FIRST, role second — a player whose team is NOT
 * `session.activeTeamId` is RESTING and sees a spectate/standby surface for ALL
 * roles (never a dead bomb or a manual for a bomb nobody on their team is
 * solving). The full split-pane lounge is Story 9.4; this is the legible interim.
 *
 * - Active-team Defuser: the bomb. BombScene tolerates `bomb === null` (falls back
 *   to its dev placeholder modules) until BOMB_INIT.
 * - Active-team Expert: the manual (5.2) — same chapter wiring as Preparation.
 * - Resting team (any role) / Spectator / Facilitator: standby panels; the
 *   Spectator Lounge is Epic 9 and the in-round facilitator dashboard is 8.5+.
 * No HUD work here — the timer LCD and strike indicator are Stories 4.4/4.5.
 */
export default function ActiveRound() {
  const session = useGameStore((s) => s.session);
  const selfId = useGameStore((s) => s.myPlayerId);

  const chapters = useMemo(
    () => buildChapters(SANDBOX_MODULES.flatMap((m) => m.getManualPages())),
    [],
  );

  if (session === null) return null;

  // Resolve "which player am I" by the durable playerId (Story 2.7) from the
  // reactive store, not socket.id — socket.id is no longer a roster key.
  const self = selfId !== null ? session.players[selfId] : undefined;
  const role = self?.role;
  // Resting players (their team is not the active team) are routed to standby for
  // ALL roles — gate on activeTeamId BEFORE role. The facilitator (no teamId) is
  // never "resting"; it falls through to its own placeholder below.
  const myTeamId = self?.teamId;
  const isResting = myTeamId !== undefined && myTeamId !== session.activeTeamId;

  let surface: ReactNode;
  if (isResting) {
    surface = (
      <div className="flex flex-1 items-center justify-center p-8">
        <p
          data-testid="resting-standby"
          className="max-w-md text-center font-mono text-sm uppercase tracking-widest text-ink-muted"
        >
          {RESTING_SPECTATE}
        </p>
      </div>
    );
  } else if (role === 'defuser') {
    surface = (
      <BombStage>
        <BombScene />
      </BombStage>
    );
  } else if (role === 'expert') {
    surface = <ManualViewer chapters={chapters} />;
  } else {
    surface = (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="font-mono text-sm uppercase tracking-widest text-ink-muted">
          {role === 'spectator' ? WATCHING_THE_BOMB_ROOM : ROUND_IN_PROGRESS}
        </p>
      </div>
    );
  }

  // The result banner overlays whatever role surface is showing (Story 8.5). It
  // self-hides while `resolution` is null, so this wrapper is inert mid-round.
  return (
    <div className="relative flex flex-1 flex-col">
      {surface}
      <ResolutionBanner />
      {/* Pause surface (Story 8.7): the facilitator's break-glass Pause control, and
          the "Holding the clock" / amber disconnect strip + scene dim when paused. */}
      <PauseOverlay />
      {/* Voice HUD corners (non-blocking, self-gating). Story 3.2 connect CTA is
          bottom-right; Story 3.4 adds the speaker pill (top-left, all in-round
          roles incl. a spectator watching the Bomb Room) and the self-mute toggle
          (bottom-left, publisher-only — self-gates internally). The timer LCD
          (top-center/right) is reserved for Stories 4.4/4.5 — pill stays clear. */}
      <SpeakerIndicator />
      <MuteControl />
      <AudioUnblockPrompt />
      <VoiceController />
    </div>
  );
}
