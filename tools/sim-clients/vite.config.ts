import { defineConfig } from 'vite';

/**
 * Dev-only control panel for the bot swarm. Serves `panel/index.html`, which runs
 * real BotClient sockets IN THE BROWSER (socket.io-client + the framework-free
 * @bomb-squad/shared solvers are browser-safe) and renders one dashboard for all
 * bots. The game server's CORS is `origin: true`, so a page on this dev port can
 * open sockets to it directly — no extra controller process.
 *
 * NB: never import `src/verify.ts` from the panel — it pulls in @bomb-squad/server
 * + socket.io (Node-only) and would break the browser bundle.
 */
export default defineConfig({
  root: 'panel',
  server: { port: 5180, strictPort: false, open: true },
});
