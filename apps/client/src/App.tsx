import { useEffect } from 'react';
import { createSocket } from './net/socket.js';
import { bindServerEvents } from './net/bindServerEvents.js';
import { useGameStore } from './store/gameStore.js';

// Production builds are served through Caddy, which proxies /socket.io/* to
// the game server — same-origin works on any domain without baking a URL into
// the image. Host-run dev serves client (5173) and server (3001) separately,
// so dev keeps the explicit localhost default.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

export default function App() {
  const connection = useGameStore((s) => s.connection);

  useEffect(() => {
    // StrictMode double-invokes this effect in dev — autoConnect:false + explicit
    // connect/disconnect makes the lifecycle idempotent.
    useGameStore.getState().setConnection('connecting');
    const socket = createSocket(SERVER_URL);
    const unbind = bindServerEvents(socket);
    socket.connect();

    return () => {
      unbind();
      socket.disconnect();
    };
  }, []);

  return (
    <div style={{ fontFamily: 'monospace', padding: '2rem' }}>
      <h1>Bomb Squad</h1>
      <p>
        Server:{' '}
        <strong
          style={{
            color:
              connection === 'connected'
                ? 'green'
                : connection === 'connecting'
                  ? 'orange'
                  : 'red',
          }}
        >
          {connection}
        </strong>
      </p>
    </div>
  );
}
