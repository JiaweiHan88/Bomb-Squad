import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bomb-squad/shared';
import { config } from './config/index.js';
import { healthRegistry } from './health/index.js';

/** A typed Socket.IO server. Generic order is `<ClientToServer, ServerToClient>` (incoming first). */
export type AppIOServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

export interface BuiltServer {
  fastify: FastifyInstance;
  io: AppIOServer;
}

/**
 * Build the Fastify host with the `/health` route and a typed Socket.IO server
 * attached to its underlying HTTP server. Pure construction — does not listen,
 * so tests can drive it with `fastify.inject()` without binding a port.
 */
export async function buildServer(): Promise<BuiltServer> {
  const fastify = Fastify({ logger: true }).withTypeProvider<TypeBoxTypeProvider>();

  fastify.get('/health', async (_request, reply) => {
    const report = await healthRegistry.runAll();
    if (report.healthy) {
      return reply.code(200).send({ status: 'ok', checks: report.checks });
    }
    return reply.code(503).send({ status: 'unhealthy', checks: report.checks });
  });

  // Attach Socket.IO to Fastify's underlying Node HTTP server, BEFORE listen().
  // Generic order: Server<ClientToServerEvents, ServerToClientEvents> — the client swaps them.
  const io: AppIOServer = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    fastify.server,
    { cors: { origin: true } },
  );
  io.on('connection', (socket) => {
    // No game handlers yet — those land in Story 1.6+. Just a liveness breadcrumb.
    fastify.log.debug({ socketId: socket.id }, 'socket connected');
  });

  return { fastify, io };
}

/** Boot the server: validate config (already done by the `config` import), then listen. */
async function start(): Promise<void> {
  const { fastify, io } = await buildServer();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info({ signal }, 'shutting down');
    try {
      // `io.close()` disconnects clients AND closes the underlying HTTP server
      // (Socket.IO was attached to `fastify.server`). Await it and surface any
      // error it reports rather than discarding the callback argument.
      await new Promise<void>((resolveClose) => {
        io.close((err?: Error) => {
          if (err) fastify.log.error(err, 'error closing Socket.IO');
          resolveClose();
        });
      });
      // The HTTP server is already closed by `io.close()`; `fastify.close()` runs
      // the onClose hooks. Tolerate the expected "already not running" error so a
      // clean shutdown still exits 0.
      await fastify.close().catch((err: NodeJS.ErrnoException) => {
        if (err?.code !== 'ERR_SERVER_NOT_RUNNING') throw err;
      });
      process.exit(0);
    } catch (err) {
      fastify.log.error(err, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await fastify.ready();
  await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
}

// Only boot when run directly (e.g. `tsx src/index.ts` / `node dist/index.js`),
// never when imported by tests.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  start().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
