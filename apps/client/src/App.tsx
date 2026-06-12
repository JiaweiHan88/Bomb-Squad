import { useEffect } from 'react';
import { createSocket } from './net/socket.js';
import { bindServerEvents } from './net/bindServerEvents.js';
import { useGameStore } from './store/gameStore.js';
import { AppShell, LoadingScreen, PlatformGate } from './ui/index.js';
import { CONNECTING } from './ui/copy.js';

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

  // Precedence: platform gate → loading screen → app shell.
  return (
    <PlatformGate>
      {connection !== 'connected' ? (
        <LoadingScreen status={CONNECTING} />
      ) : (
        <AppShell header={<h1 className="font-display text-lg font-semibold">Bomb Squad</h1>}>
          <div className="flex flex-1 items-center justify-center text-ink-muted">
            <p>Connected. Lobby lands in Story 2.2.</p>
          </div>
        </AppShell>
      )}
    </PlatformGate>
  );
}
