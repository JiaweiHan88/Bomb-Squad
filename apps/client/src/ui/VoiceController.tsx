import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { useVoiceStore } from '../store/voiceStore.js';
import { connectVoice, disconnectVoice } from '../voice/connectVoice.js';
import Button from './Button.js';
import {
  VOICE_CONNECT_CTA,
  VOICE_CONNECTING,
  VOICE_CONNECTED,
  VOICE_LOUNGE_CTA,
  VOICE_LOUNGE_CONNECTING,
  VOICE_LOUNGE_CONNECTED,
  VOICE_UNAVAILABLE,
  VOICE_DISMISS,
  VOICE_RECONNECT,
} from './copy.js';

/**
 * Voice join entry point — the minimal, gesture-driven affordance that connects
 * a player to their server-assigned voice room. It is rendering-only: all
 * connection logic lives in `voice/connectVoice.ts`; this component just drives
 * it from a click and mirrors `voiceStore` into EXPERIENCE.md microcopy.
 *
 * Two role-gated modes share this one mount (it already rides ActiveRound):
 * - Bomb Room (Story 3.2): a Defuser/Expert with a team connects + PUBLISHES
 *   the mic (`publish: true`) so they can talk. "Connect to Bomb Room voice".
 * - Spectator Lounge (Story 3.3): a spectator connects LISTEN-ONLY
 *   (`publish: false`) — no mic acquired, no mic prompt (AC #2) — and HEARS the
 *   Bomb Room. Lounge microcopy ("Listen to the Bomb Room"); a spectator is not
 *   "in" the Bomb Room.
 *
 * Deliberately NOT here (Story 3.4): the speaker-indicator pill and the
 * self-mute toggle. No pill, no mute control in either mode.
 *
 * Non-blocking (AC #4): a voice failure renders as dismissible microcopy and
 * never blocks the game — there is no modal and no game-state coupling.
 *
 * Graceful degradation (Story 3.6): the `unavailable` state also offers a manual
 * "Reconnect voice" affordance that re-runs `connectVoice` with a FRESH token in
 * the player's existing role mode. The reconnect control stays reachable even
 * after the banner is dismissed — dismissing only hides the message line, never
 * the ability to re-attempt voice. There is no auto-backoff loop here (that
 * hardening is Story 10-3).
 */
export default function VoiceController() {
  const session = useGameStore((s) => s.session);
  // Resolve self via the reactive durable id (Story 2.7), NOT getSocket().id —
  // `players` is keyed by the durable playerId, so the socket.id lookup always
  // missed post-2.7 and the bomb-room CTA never rendered (Story 2.5 fix).
  const selfId = useGameStore((s) => s.myPlayerId);
  const status = useVoiceStore((s) => s.status);
  const [dismissed, setDismissed] = useState(false);

  // Re-show the failure microcopy whenever we (re-)enter `unavailable`.
  useEffect(() => {
    if (status === 'unavailable') setDismissed(false);
  }, [status]);

  // Teardown on unmount (AC #5): round ends / role changes / navigate away.
  // Idempotent + safe even if we never connected.
  useEffect(() => {
    return () => {
      void disconnectVoice();
    };
  }, []);

  // Resolve which voice mode this role gets. The client is room-agnostic (it
  // trusts the token's room); the role only decides whether we publish the mic
  // and which microcopy to show.
  // - Bomb Room: a Defuser/Expert resolved to a team → publish + talk (3.2).
  // - Lounge: a spectator → listen-only, no mic (3.3).
  // Facilitators and un-teamed players get nothing here (later stories).
  const self = selfId !== null ? session?.players[selfId] : undefined;
  const isBombRoomParticipant =
    self !== undefined && (self.role === 'defuser' || self.role === 'expert') && self.teamId !== undefined;
  const isSpectator = self !== undefined && self.role === 'spectator';
  if (!isBombRoomParticipant && !isSpectator) return null;

  // Mode-specific config. Spectator → listen-only (publish: false) + lounge copy.
  const publish = isBombRoomParticipant;
  const ctaCopy = isBombRoomParticipant ? VOICE_CONNECT_CTA : VOICE_LOUNGE_CTA;
  const connectingCopy = isBombRoomParticipant ? VOICE_CONNECTING : VOICE_LOUNGE_CONNECTING;
  const connectedCopy = isBombRoomParticipant ? VOICE_CONNECTED : VOICE_LOUNGE_CONNECTED;

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
      {status === 'idle' && (
        // connectVoice() MUST be invoked from this click — autoplay (and, for the
        // Bomb Room, getUserMedia) need the user gesture (Task 2 autoplay note).
        // A spectator connects listen-only: no mic, no prompt (Story 3.3 AC #2).
        <Button variant="secondary" onClick={() => void connectVoice({ publish })}>
          {ctaCopy}
        </Button>
      )}

      {status === 'connecting' && (
        <p className="rounded-md bg-surface-raised px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-muted">
          {connectingCopy}
        </p>
      )}

      {status === 'connected' && (
        <p className="rounded-md bg-surface-raised px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-muted">
          {connectedCopy}
        </p>
      )}

      {status === 'unavailable' && (
        // The banner message + Dismiss hide once dismissed, but the Reconnect
        // affordance ALWAYS stays reachable while unavailable (AC #1/#2): a
        // dismissed banner must never strip the ability to re-attempt voice.
        <div className="flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2">
          {!dismissed && (
            <>
              <p className="font-mono text-xs text-ink-muted">{VOICE_UNAVAILABLE}</p>
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="font-mono text-xs uppercase tracking-widest text-ink-muted underline hover:text-ink-primary"
              >
                {VOICE_DISMISS}
              </button>
            </>
          )}
          <Button variant="secondary" onClick={() => void connectVoice({ publish })}>
            {VOICE_RECONNECT}
          </Button>
        </div>
      )}
    </div>
  );
}
