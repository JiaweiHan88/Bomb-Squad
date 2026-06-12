import type { BuiltServer } from '../index.js';
import { HealthRegistry } from '../health/registry.js';

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

describe('HealthRegistry hardening (fresh registry, no infra)', () => {
  it('a probe resolving {ok:false} makes runAll().healthy === false', async () => {
    const registry = new HealthRegistry();
    registry.register('db', async () => ({ ok: false, detail: 'down' }));
    const report = await registry.runAll();
    expect(report.healthy).toBe(false);
    expect(report.checks['db']).toMatchObject({ ok: false });
  });

  it('a probe resolving undefined is normalized to {ok:false, detail:"malformed readiness result"}', async () => {
    const registry = new HealthRegistry();
    // Cast to bypass type-check — simulates a badly-typed real probe.
    registry.register('bad', async () => undefined as unknown as { ok: boolean });
    const report = await registry.runAll();
    expect(report.healthy).toBe(false);
    expect(report.checks['bad']).toEqual({ ok: false, detail: 'malformed readiness result' });
  });

  it('a probe resolving null is normalized to {ok:false, detail:"malformed readiness result"}', async () => {
    const registry = new HealthRegistry();
    registry.register('bad', async () => null as unknown as { ok: boolean });
    const report = await registry.runAll();
    expect(report.healthy).toBe(false);
    expect(report.checks['bad']).toEqual({ ok: false, detail: 'malformed readiness result' });
  });

  it('a probe resolving a non-{ok:boolean} shape is normalized', async () => {
    const registry = new HealthRegistry();
    registry.register('bad', async () => ({ ok: 'yes' } as unknown as { ok: boolean }));
    const report = await registry.runAll();
    expect(report.healthy).toBe(false);
    expect(report.checks['bad']).toEqual({ ok: false, detail: 'malformed readiness result' });
  });

  it('registering a duplicate name throws', () => {
    const registry = new HealthRegistry();
    registry.register('redis', async () => ({ ok: true }));
    expect(() => registry.register('redis', async () => ({ ok: true }))).toThrow(
      'HealthRegistry: duplicate probe name "redis"',
    );
  });

  it('empty registry reports healthy: true', async () => {
    const registry = new HealthRegistry();
    const report = await registry.runAll();
    expect(report.healthy).toBe(true);
    expect(report.checks).toEqual({});
  });
});
