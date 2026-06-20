/**
 * Voice token handler (Story 3.1).
 *
 * Owns the `VOICE_TOKEN` socket event: a participant asks for voice access and
 * the server mints a role-scoped LiveKit token via {@link mintVoiceToken}. The
 * request payload carries NO room/role — the scope is derived solely from the
 * authoritative session state keyed by this socket, so a client can never widen
 * its own grants (FR39, enforced at the token-grant level, not the UI).
 *
 * Per AR12 / ADR-007 voice is an independent subsystem: this handler only
 * *reads* session state to resolve the requester. It writes no state, drives no
 * phase transition, and emits no game event — it just acks the token.
 */
import type { Server as SocketIOServer, DefaultEventsMap } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SessionState,
  VoiceTokenGrantPayload,
  VoiceTokenErrorPayload,
} from '@bomb-squad/shared';
import type { RedisStore } from '../state/redis.js';
import { sessionKey } from '../state/keys.js';
import type { SessionLog, SessionSocketData } from './sessionHandlers.js';
import { mintVoiceToken, VoiceScopeError } from '../voice/mintToken.js';
import { mintTurnIceServers } from '../voice/turnCredentials.js';

/** Typed server alias declared locally to avoid an import cycle with index.ts. */
type VoiceIOServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  DefaultEventsMap,
  SessionSocketData
>;

/** LiveKit credentials + URL the handler needs to mint and return a token.
 * A narrow slice of the server Config (already validated in config/env.ts) so
 * tests can supply a literal without constructing the whole Config. */
export interface VoiceConfig {
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  /** Upper bound for the minted token's lifetime, in seconds. */
  TURN_TTL: number;
  /** coturn static auth secret — signs the short-TTL TURN-REST credential (Story 3.6). */
  TURN_SECRET: string;
  /** Optional browser-reachable TURN URI; absent ⇒ no TURN advertised in the grant (Story 3.6). */
  TURN_URL?: string;
}

export interface VoiceHandlerDeps {
  redis: RedisStore;
  log: SessionLog;
  config: VoiceConfig;
}

/**
 * Hard cap on a voice token's lifetime regardless of the configured TURN_TTL.
 * A voice grant should not outlive a play session by much; six hours is well
 * beyond any single game yet bounded (project-context: TTLs must be limited).
 */
export const MAX_VOICE_TOKEN_TTL_S = 6 * 60 * 60;

export function registerVoiceHandlers(io: VoiceIOServer, deps: VoiceHandlerDeps): void {
  const ttlSeconds = Math.min(deps.config.TURN_TTL, MAX_VOICE_TOKEN_TTL_S);

  io.on('connection', (socket) => {
    socket.on('VOICE_TOKEN', async (_payload, ack) => {
      // A hand-rolled client can omit the ack — calling it would throw.
      if (typeof ack !== 'function') {
        deps.log.error({ socketId: socket.id }, 'VOICE_TOKEN without ack callback — ignored');
        return;
      }

      const fail = (error: string, reason: string): void => {
        // The error string returned to the client is intentionally generic; the
        // specific `reason` is logged server-side only (never the token).
        deps.log.info({ socketId: socket.id, reason }, 'VOICE_TOKEN denied');
        const payload: VoiceTokenErrorPayload = { error };
        ack(payload);
      };

      // socket.data.sessionId is a server-assigned pointer (not authority) to
      // which session to load; absent until the socket has created/joined one.
      const sessionId = socket.data.sessionId;
      if (sessionId === undefined) {
        fail('NOT_IN_SESSION', 'no session pointer on socket');
        return;
      }

      try {
        const state = await deps.redis.getJSON<SessionState>(sessionKey(sessionId));
        if (state === null) {
          fail('NOT_IN_SESSION', 'session state not found');
          return;
        }

        // Authority: resolve role + team from loaded state by the DURABLE
        // playerId (Story 2.7 re-keyed `players` from socket.id), never the
        // payload. `?? ''` keeps a never-joined socket (no socket.data.playerId)
        // a guaranteed miss → NOT_IN_SESSION, rather than an accidental match.
        const playerId = socket.data.playerId ?? '';
        const player = state.players[playerId];
        if (player === undefined) {
          fail('NOT_IN_SESSION', 'socket not a player in session');
          return;
        }

        const { token, room } = await mintVoiceToken(
          {
            // Identity MUST be the durable playerId so the LiveKit participant
            // identity equals the roster playerId — the client maps
            // ActiveSpeakersChanged participants back to roster rows by it (2.5).
            identity: playerId,
            role: player.role,
            sessionId,
            teamId: player.teamId,
            // Thread the phase so the lobby mic check scopes everyone to the
            // shared lobby room (Story 2.5); non-lobby keeps role-scoped routing.
            phase: state.status,
          },
          {
            apiKey: deps.config.LIVEKIT_API_KEY,
            apiSecret: deps.config.LIVEKIT_API_SECRET,
            ttlSeconds,
          },
        );

        // Corporate-NAT relay path (Story 3.6, AC #3): when TURN is configured,
        // mint short-TTL TURN-REST credentials (HMAC-SHA1 over TURN_SECRET) and
        // advertise the coturn relay as ICE servers. Absent TURN_URL ⇒ undefined ⇒
        // grant omits `iceServers` (client connects via LiveKit's own ICE).
        const iceServers = mintTurnIceServers({
          turnUrl: deps.config.TURN_URL,
          turnSecret: deps.config.TURN_SECRET,
          identity: playerId,
          ttlSeconds,
          nowSeconds: Math.floor(Date.now() / 1000),
        });

        const grant: VoiceTokenGrantPayload = {
          url: deps.config.LIVEKIT_URL,
          token,
          room,
          identity: playerId,
          ...(iceServers !== undefined ? { iceServers } : {}),
        };
        // Log only non-secret facts — NEVER the token OR the TURN credential
        // (project-context Security). `turn` here is a boolean, not the secret.
        deps.log.info(
          { sessionId, playerId, role: player.role, room, turn: iceServers !== undefined },
          'VOICE_TOKEN minted',
        );
        ack(grant);
      } catch (err) {
        if (err instanceof VoiceScopeError) {
          // e.g. a Bomb Room role with no team yet — recoverable once assigned.
          fail('VOICE_SCOPE_UNAVAILABLE', err.message);
          return;
        }
        deps.log.error({ err, socketId: socket.id }, 'VOICE_TOKEN failed');
        fail('VOICE_TOKEN_FAILED', 'unexpected mint failure');
      }
    });
  });
}
