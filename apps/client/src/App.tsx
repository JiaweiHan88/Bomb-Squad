import { useEffect } from 'react';
import { createSocket } from './net/socket.js';
import { bindServerEvents } from './net/bindServerEvents.js';
import { useGameStore } from './store/gameStore.js';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

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
