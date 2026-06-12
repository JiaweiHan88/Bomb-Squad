import { useEffect } from 'react';
import { createSocket } from './net/socket.js';
import { bindServerEvents } from './net/bindServerEvents.js';
import { useGameStore } from './store/gameStore.js';
import { AppShell, Landing, Lobby, LoadingScreen, PlatformGate } from './ui/index.js';
import { CONNECTING } from './ui/copy.js';

// Production builds are served through Caddy, which proxies /socket.io/* to
// the game server — same-origin works on any domain without baking a URL into
// the image. Host-run dev serves client (5173) and server (3001) separately,
// so dev keeps the explicit localhost default.
// `||` (not `??`) so an empty VITE_SERVER_URL= line in .env also falls back.
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin);

export default function App() {
  const connection = useGameStore((s) => s.connection);
  const session = useGameStore((s) => s.session);

  useEffect(() => {
    // StrictMode double-invokes this effect in dev — autoConnect:false + explicit
    // connect/disconnect makes the lifecycle idempotent.
    useGameStore.getState().setConnection('connecting');
    const socket = createSocket(SERVER_URL);
    const unbind = bindServerEvents(socket);
    socket.connect();

    return () => {
      // unbind() removes the 'disconnect' listener before disconnect() fires it,
      // so reflect the teardown in the store explicitly.
      unbind();
      socket.disconnect();
      useGameStore.getState().setConnection('disconnected');
    };
  }, []);

  // Precedence: platform gate → loading screen → app shell.
  return (
    <PlatformGate>
      {connection !== 'connected' ? (
        <LoadingScreen status={CONNECTING} />
      ) : (
        <AppShell header={<h1 className="font-display text-lg font-semibold">Bomb Squad</h1>}>
          {/* Surface derives from the server snapshot — no router, no URL state. */}
          {session === null ? <Landing /> : <Lobby />}
        </AppShell>
      )}
    </PlatformGate>
  );
}
