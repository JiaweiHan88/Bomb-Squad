/**
 * Durable-identity helpers (Story 2.7).
 *
 * A player's identity is a durable `playerId` (the public roster + authority
 * key) decoupled from the ephemeral `socket.id`. A reconnecting client proves
 * ownership with a secret `reattachToken` presented via the Socket.IO handshake
 * `auth`; the server resolves token → `playerId` from the reattach record.
 *
 * These helpers own the *minting* and *record I/O* only — emitting SESSION_IDENTITY
 * and stamping `socket.data` stays in the handler (it needs the live socket).
 */
import { randomUUID } from 'node:crypto';
import type { PlayerRole } from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { reattachKey, reattachByPlayerKey } from '../state/keys.js';

/** The token-gated record that lets a reconnecting socket re-materialise its seat. */
export interface ReattachRecord {
  playerId: string;
  displayName: string;
  role: PlayerRole;
}

/** Mint a fresh durable identity: a public playerId and a secret reattach token. */
export function mintPlayerIdentity(): { playerId: string; reattachToken: string } {
  return { playerId: randomUUID(), reattachToken: randomUUID() };
}

/**
 * Persist the token → identity record (and the playerId → token companion, so a
 * later PLAYER_REMOVE can invalidate the token without a reverse scan).
 */
export async function storeReattachRecord(
  redis: RedisStore,
  sessionId: string,
  reattachToken: string,
  record: ReattachRecord,
): Promise<void> {
  await redis.setJSON(reattachKey(sessionId, reattachToken), record);
  await redis.setJSON(reattachByPlayerKey(sessionId, record.playerId), reattachToken);
}

/** Resolve a presented token back to its identity record, or null if unknown. */
export async function resolveReattachRecord(
  redis: RedisStore,
  sessionId: string,
  reattachToken: string,
): Promise<ReattachRecord | null> {
  return redis.getJSON<ReattachRecord>(reattachKey(sessionId, reattachToken));
}

/**
 * Invalidate a player's reattach record (both directions) so a removed (kicked)
 * player can never reattach. Resolves the secret token via the playerId → token
 * companion. No-op if the player has no record.
 */
export async function deleteReattachRecord(
  redis: RedisStore,
  sessionId: string,
  playerId: string,
): Promise<void> {
  const token = await redis.getJSON<string>(reattachByPlayerKey(sessionId, playerId));
  if (token !== null) await redis.del(reattachKey(sessionId, token));
  await redis.del(reattachByPlayerKey(sessionId, playerId));
}
