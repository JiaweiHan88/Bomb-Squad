import { useMemo, type ReactNode } from 'react';
import { useGameStore } from '../store/gameStore.js';
import BombStage from '../scenes/BombStage.js';
import BombScene from '../scenes/BombScene.js';
import ManualViewer from '../manual/ManualViewer.js';
import { buildChapters } from '../manual/chapters.js';
import { SANDBOX_MODULES } from '../modules/index.js';
import ResolutionBanner from './ResolutionBanner.js';
import { ROUND_IN_PROGRESS, WATCHING_THE_BOMB_ROOM } from './copy.js';

/**
 * Active-round surface routing (Story 8.3, FR11) — the same session URL shows
 * a different primary surface per committed role (EXPERIENCE.md role-gating
 * principle; roles never see each other's surface).
 *
 * - Defuser: the bomb. BombScene tolerates `bomb === null` (falls back to its
 *   dev placeholder modules) until Story 8.2 broadcasts BOMB_INIT.
 * - Expert: the manual (5.2) — same chapter wiring as Preparation.
 * - Spectator / Facilitator: interim placeholder panels; the Spectator Lounge
 *   is Epic 9 and the in-round facilitator dashboard arrives with 8.5+.
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
  const role = selfId !== null ? session.players[selfId]?.role : undefined;

  let surface: ReactNode;
  if (role === 'defuser') {
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
    </div>
  );
}
