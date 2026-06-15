import { useEffect, useState } from 'react';
import { useVoiceStore } from '../store/voiceStore.js';
import { connectVoice, disconnectVoice } from '../voice/connectVoice.js';
import Button from './Button.js';
import {
  MIC_CHECK_CTA,
  MIC_CHECK_CONNECTING,
  MIC_CHECK_CONNECTED,
  VOICE_UNAVAILABLE,
  VOICE_DISMISS,
} from './copy.js';

/**
 * Lobby mic-check affordance (Story 2.5). A gesture-driven connect into the
 * shared `lobby:{sessionId}` LiveKit room so each participant can verify their
 * mic and see everyone's speaker dot light up. Rendering-only: all connection
 * logic lives in `voice/connectVoice.ts`; this just drives it from a click and
 * mirrors `voiceStore` into the EXPERIENCE.md microcopy `VoiceController` uses.
 *
 * The server mints the lobby room because the session is in `lobby` status
 * (Task 2) — the client stays room-agnostic and trusts the token's room.
 *
 * Non-blocking (AR12 / ADR-007): a voice failure renders as dismissible
 * microcopy and never blocks the lobby — no modal, no game-state coupling.
 *
 * Teardown on unmount: when the facilitator opens preparation and App swaps
 * Lobby → Preparation, the lobby voice room is released before the bomb-room
 * VoiceController connects fresh (the lobby-room → bomb-room hand-off).
 */
export default function LobbyMicCheck() {
  const status = useVoiceStore((s) => s.status);
  const [dismissed, setDismissed] = useState(false);

  // Re-show the failure microcopy whenever we (re-)enter `unavailable`.
  useEffect(() => {
    if (status === 'unavailable') setDismissed(false);
  }, [status]);

  // Release the lobby voice room on unmount (surface swap / navigate away).
  // Idempotent + safe even if we never connected.
  useEffect(() => {
    return () => {
      void disconnectVoice();
    };
  }, []);

  return (
    <div className="mt-6 flex flex-col items-start gap-2">
      {status === 'idle' && (
        // connectVoice() MUST be invoked from this click — autoplay + getUserMedia
        // need the user gesture.
        <Button variant="secondary" onClick={() => void connectVoice()}>
          {MIC_CHECK_CTA}
        </Button>
      )}

      {status === 'connecting' && (
        <p className="rounded-md bg-surface px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-muted">
          {MIC_CHECK_CONNECTING}
        </p>
      )}

      {status === 'connected' && (
        <p className="rounded-md bg-surface px-3 py-2 font-mono text-xs uppercase tracking-widest text-ink-muted">
          {MIC_CHECK_CONNECTED}
        </p>
      )}

      {status === 'unavailable' && !dismissed && (
        <div className="flex items-center gap-2 rounded-md bg-surface px-3 py-2">
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
