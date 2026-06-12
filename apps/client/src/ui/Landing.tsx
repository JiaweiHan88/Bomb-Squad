import { useEffect, useRef, useState } from 'react';
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
  // Tracks an in-flight create so a failure resolves exactly once: whichever of
  // the ack-timeout or the ERROR event arrives first settles it, the later is
  // ignored, and an unrelated ERROR (no create pending) is not surfaced here.
  const pending = useRef(false);

  const settleFailure = (message: string) => {
    if (!pending.current) return;
    pending.current = false;
    setCreating(false);
    setError(message);
  };

  // Server-side rejections (INVALID_PAYLOAD / SESSION_CREATE_FAILED) arrive as
  // ERROR events without an ack — surface them instead of waiting out the timeout.
  useEffect(() => {
    const socket = getSocket();
    const onError = (payload: { message: string }) => settleFailure(payload.message);
    socket.on('ERROR', onError);
    return () => {
      socket.off('ERROR', onError);
    };
  }, []);

  const hostSession = () => {
    if (creating) return;
    pending.current = true;
    setCreating(true);
    setError(null);
    // .timeout() flips the ack to an error-first callback (err set on timeout).
    getSocket()
      .timeout(5000)
      .emit('SESSION_CREATE', {}, (err) => {
        if (err) {
          settleFailure(HOST_FAILED);
          return;
        }
        // Success: SESSION_STATE will mount Lobby (unmounting Landing). Clear the
        // in-flight flag so a dropped broadcast can't wedge the button disabled.
        if (!pending.current) return;
        pending.current = false;
        setCreating(false);
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
