import type { BuiltServer } from '../index.js';
import type { HealthRegistry } from '../health/registry.js';

// /health builds the full app (which imports `config`, validated at module load),
// so give the config module a valid env before the dynamic import below.
const validEnv = {
  PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bombsquad',
  LIVEKIT_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'devsecret',
  TURN_SECRET: 'changeme',
  TURN_TTL: '86400',
};

describe('GET /health', () => {
  let built: BuiltServer;
  let healthRegistry: HealthRegistry;

  beforeAll(async () => {
    Object.assign(process.env, validEnv);
    // Dynamic import AFTER env is set so `config` validation passes.
    const appModule = await import('../index.js');
    const healthModule = await import('../health/index.js');
    healthRegistry = healthModule.healthRegistry;
    built = await appModule.buildServer();
    await built.fastify.ready();
  });

  afterAll(async () => {
    built.io.close();
    await built.fastify.close();
  });

  it('returns 200 {status:"ok"} with an empty readiness registry', async () => {
    const res = await built.fastify.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('returns 503 {status:"unhealthy"} once a registered check fails', async () => {
    healthRegistry.register('always-fails', async () => ({ ok: false, detail: 'down' }));
    // `healthRegistry` is a process-wide singleton — remove the probe afterwards
    // so it cannot leak into other test files that import the same instance.
    try {
      const res = await built.fastify.inject({ method: 'GET', url: '/health' });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ status: 'unhealthy' });
      expect(res.json().checks['always-fails']).toMatchObject({ ok: false, detail: 'down' });
    } finally {
      healthRegistry.unregister('always-fails');
    }
  });
});
