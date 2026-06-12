import { useEffect } from 'react';
import { createSocket } from './net/socket.js';
import { bindServerEvents } from './net/bindServerEvents.js';
import { useGameStore } from './store/gameStore.js';
import { AppShell, Landing, Lobby, LoadingScreen, PlatformGate } from './ui/index.js';
import { CONNECTING } from './ui/copy.js';
import DevBombHarness from './scenes/DevBombHarness.js';
import SandboxHarness from './sandbox/SandboxHarness.js';

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

  // Dev harness for the bomb scene (Story 4.1) — no router exists yet; the
  // real round flow mounts the scene from session state in later stories.
  // Known gap: `vite preview` has no SPA fallback, so this 404s in the prod
  // container (deferred-work.md) — acceptable for a dev-mode harness.
  const isBombDevRoute =
    window.location.pathname === '/dev/bomb' &&
    (import.meta.env.DEV || connection === 'connected');

  // Module sandbox (Story 5.1) — same dev-route pattern and the same known
  // `vite preview` SPA-fallback gap as /dev/bomb (deferred-work.md).
  const isSandboxDevRoute =
    window.location.pathname === '/dev/sandbox' &&
    (import.meta.env.DEV || connection === 'connected');

  // Precedence: platform gate → loading screen → app shell.
  return (
    <PlatformGate>
      {isSandboxDevRoute ? (
        <SandboxHarness />
      ) : isBombDevRoute ? (
        <DevBombHarness />
      ) : connection !== 'connected' ? (
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
