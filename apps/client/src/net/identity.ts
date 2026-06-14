import type { SessionIdentityPayload } from '@bomb-squad/shared';
import type { AppClientSocket } from './socket.js';

/**
 * Durable-identity client store (Story 2.7). Persists the server-minted
 * `{ sessionId, playerId, reattachToken }` in **sessionStorage** (survives a
 * refresh, scoped per-tab, cleared on tab close) so a reconnecting client can
 * present its secret token via the Socket.IO handshake `auth` and re-attach to
 * the same player record. The token is a secret — never put it in the URL,
 * logs, or any rendered surface.
 */
const STORAGE_KEY = 'bombsquad:identity';

export type StoredIdentity = SessionIdentityPayload;

function isStoredIdentity(value: unknown): value is StoredIdentity {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.sessionId === 'string' &&
    typeof v.playerId === 'string' &&
    typeof v.reattachToken === 'string'
  );
}

/** The persisted identity for this tab, or null if none / storage unavailable. */
export function getIdentity(): StoredIdentity | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persist the identity packet the server unicast via SESSION_IDENTITY. */
export function setIdentity(identity: StoredIdentity): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // sessionStorage unavailable (private mode / SSR) — degrade to no-reattach.
  }
}

/** Forget this tab's identity (after a kick, or an explicit leave). */
export function clearIdentity(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore — nothing to clear if storage is unavailable.
  }
}

/**
 * Push the stored credentials onto the socket's `auth` so Socket.IO replays
 * them on the initial connect and every auto-reconnect. Call BEFORE connect().
 * No stored identity → leaves `auth` empty (a fresh client).
 */
export function applyAuthFromIdentity(socket: AppClientSocket): void {
  const identity = getIdentity();
  socket.auth = identity === null
    ? {}
    : { sessionId: identity.sessionId, reattachToken: identity.reattachToken };
}
