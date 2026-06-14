import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore.js';
import { useVoiceStore } from '../store/voiceStore.js';
import { getSocket } from '../net/socket.js';
import { connectVoice, disconnectVoice } from '../voice/connectVoice.js';
import Button from './Button.js';
import {
  VOICE_CONNECT_CTA,
  VOICE_CONNECTING,
  VOICE_CONNECTED,
  VOICE_UNAVAILABLE,
  VOICE_DISMISS,
} from './copy.js';

/**
 * Bomb Room voice join entry point (Story 3.2, Task 4) — the minimal,
 * gesture-driven affordance that lets a Defuser/Expert actually connect and
 * talk. It is rendering-only: all connection logic lives in
 * `voice/connectVoice.ts`; this component just drives it from a click and
 * mirrors `voiceStore` into EXPERIENCE.md microcopy.
 *
 * Deliberately NOT here (Story 3.4): the speaker-indicator pill and the
 * self-mute toggle. We publish the mic but render no pill and no mute control.
 *
 * Non-blocking (AC #3/#4): a voice failure renders as dismissible microcopy and
 * never blocks the bomb — there is no modal and no game-state coupling.
 */
export default function VoiceController() {
  const session = useGameStore((s) => s.session);
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

  // Bomb Room participants are Defuser/Expert resolved to a team. The client is
  // room-agnostic (it trusts the token's room), but the affordance only shows
  // for someone who actually has a Bomb Room seat. Spectators/facilitators and
  // un-teamed players get nothing here (their channels are 3.3 / a later story).
  const selfId = getSocket().id;
  const self = selfId !== undefined ? session?.players[selfId] : undefined;
  const isBombRoomParticipant =
    self !== undefined && (self.role === 'defuser' || self.role === 'expert') && self.teamId !== undefined;
  if (!isBombRoomParticipant) return null;

  return (
    <div className="pointer-events-auto absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2">
      {status === 'idle' && (
        // connectVoice() MUST be invoked from this click — autoplay + getUserMedia
        // need the user gesture (Task 2 autoplay note).
        <Button variant="secondary" onClick={() => void connectVoice()}>
          {VOICE_CONNECT_CTA}
        </Button>
      )}

      {status === 'connecting' && (
        <p className="rounded-md bg-surface-raised px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-muted">
          {VOICE_CONNECTING}
        </p>
      )}

      {status === 'connected' && (
        <p className="rounded-md bg-surface-raised px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-muted">
          {VOICE_CONNECTED}
        </p>
      )}

      {status === 'unavailable' && !dismissed && (
        <div className="flex items-center gap-2 rounded-md bg-surface-raised px-3 py-2">
          <p className="font-mono text-xs text-ink-muted">{VOICE_UNAVAILABLE}</p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="font-mono text-xs uppercase tracking-widest text-ink-muted underline hover:text-ink-primary"
          >
            {VOICE_DISMISS}
          </button>
        </div>
      )}
    </div>
  );
}
