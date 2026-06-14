/**
 * The PRODUCTION module-action dispatch backend (Story 4.7).
 *
 * Installed at app bootstrap on the real session route (App.tsx), this is the
 * other half of the dispatch seam (modules/dispatch.ts): a DefuserView calls
 * dispatchModuleAction(moduleIndex, action) → this backend emits MODULE_INTERACT
 * to the server, which reduces/persists and broadcasts MODULE_UPDATE back. The
 * client never reduces here — that is the sandbox's LOCAL backend by design.
 *
 * `teamId` is resolved LAZILY at emit time (not captured at install time): the
 * bootstrap installs this before any session exists, and the self player's team
 * is only known once ROUND_START has committed roles. If there is no team for
 * self yet (pre-round, or a non-defuser path that somehow dispatched), the emit
 * is dropped with a warning rather than sending a malformed payload — surfacing
 * mis-wiring instead of hiding it.
 */
import type { ModuleActionDispatch } from '../modules/dispatch.js';
import { getSocket } from './socket.js';
import { getIdentity } from './identity.js';
import { useGameStore } from '../store/gameStore.js';

export function createProductionModuleDispatch(): ModuleActionDispatch {
  return (moduleIndex, action) => {
    const socket = getSocket();
    // Resolve self by the durable playerId (Story 2.7), not socket.id — the
    // roster is keyed by the durable id, so a socket.id lookup finds no team
    // and silently drops the Defuser's interaction.
    const selfId = getIdentity()?.playerId;
    const teamId =
      selfId !== undefined
        ? useGameStore.getState().session?.players[selfId]?.teamId
        : undefined;
    if (teamId === undefined) {
      console.warn('[modules] MODULE_INTERACT dropped: no team for self', { moduleIndex });
      return false;
    }
    socket.emit('MODULE_INTERACT', { teamId, moduleIndex, action });
    return true;
  };
}
