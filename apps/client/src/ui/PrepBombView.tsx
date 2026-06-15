import { useMemo } from 'react';
import { useGameStore } from '../store/gameStore.js';
import BombStage from '../scenes/BombStage.js';
import BombScene from '../scenes/BombScene.js';
import { buildPrepModules } from '../scenes/prepLayout.js';

/**
 * Preparation placeholder bomb (Story 4.6) — the upcoming Defuser's orientation
 * surface. Mounts the same `BombStage > BombScene` stack the live bomb uses
 * (ActiveRound's precedent), but in `typesOnly` mode: the bays carry module
 * TYPES with empty, value-free faces and no active-round chrome.
 *
 * Layout source is Task 0 Option A — the config-derived orientation board:
 * `session.config` (`moduleCount` + the resolved tier pool) gives the candidate
 * types and slot count with zero server work and no leak of any randomised
 * value. The committed per-slot assignment is only fixed at generation; this is
 * a faithful "here are the module types on your bomb", not that commitment.
 */
export default function PrepBombView() {
  const config = useGameStore((s) => s.session?.config);
  const modules = useMemo(() => (config ? buildPrepModules(config) : []), [config]);

  if (modules.length === 0) return null;

  return (
    <BombStage>
      <BombScene typesOnly modules={modules} />
    </BombStage>
  );
}
