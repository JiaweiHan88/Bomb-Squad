import { useEffect, useState } from 'react';
import { getSocket } from '../net/socket.js';
import Button from './Button.js';
import { HOST_A_SESSION, HOST_PITCH, HOST_BUSY, HOST_FAILED } from './copy.js';

/**
 * Landing surface (operator world): the Facilitator's "Host a session" path.
 * The join-by-code panel (6 mono cells, paste split, auto-submit) is Story 2.3 —
 * deliberately not rendered here rather than shipped as a dead form.
 *
 * The SESSION_CREATE ack is only a success/failure receipt — the lobby renders
 * from the SESSION_STATE broadcast via gameStore (client is render-only).
 */
export default function Landing() {
  // Presentation state only — never Zustand (2.1 rule).
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Server-side rejections (INVALID_PAYLOAD / SESSION_CREATE_FAILED) arrive as
  // ERROR events without an ack — surface them instead of waiting out the timeout.
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: { message: string }) => {
      setCreating(false);
      setError(payload.message);
    };
    socket.on('ERROR', onError);
    return () => {
      socket.off('ERROR', onError);
    };
  }, []);

  const hostSession = () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    // .timeout() flips the ack to an error-first callback (err set on timeout).
    getSocket()
      .timeout(5000)
      .emit('SESSION_CREATE', {}, (err) => {
        if (err) {
          setCreating(false);
          setError(HOST_FAILED);
        }
        // On success: SESSION_STATE sets gameStore.session and App swaps to Lobby.
      });
  };

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <section className="w-full max-w-md rounded-lg bg-surface-raised p-8">
        <h2 className="mb-2 font-display text-lg font-semibold">{HOST_A_SESSION}</h2>
        <p className="mb-6 text-sm text-ink-muted">{HOST_PITCH}</p>
        <Button onClick={hostSession} disabled={creating}>
          {creating ? HOST_BUSY : HOST_A_SESSION}
        </Button>
        {error !== null && (
          <p role="alert" className="mt-4 text-sm text-led-red">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}
