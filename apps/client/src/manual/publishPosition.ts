import { useUiStore } from '../store/uiStore.js';
import { useGameStore } from '../store/gameStore.js';
import { getSocket } from '../net/socket.js';

/**
 * Single entry point for "the Expert moved to a chapter" (AC5).
 *
 * Always updates the observable uiStore position; additionally emits the typed
 * MANUAL_NAVIGATE event when there is someone to tell — connected AND in a
 * session. The dev harness (`/dev/manual`) has no session, so it exercises the
 * full viewer without emitting. The server ignores non-expert navigation, so
 * emitting for every role is safe and keeps this helper role-agnostic.
 */
export function publishManualPosition(chapterId: string): void {
  useUiStore.getState().setManualChapterId(chapterId);

  const { connection, session } = useGameStore.getState();
  if (connection !== 'connected' || session === null) return;
  getSocket().emit('MANUAL_NAVIGATE', { chapterId });
}
