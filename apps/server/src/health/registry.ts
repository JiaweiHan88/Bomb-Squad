/** Result of a single readiness probe. */
export interface ReadinessResult {
  ok: boolean;
  detail?: string;
}

/** A readiness probe: resolves to whether its dependency is reachable. */
export type ReadinessCheck = () => Promise<ReadinessResult>;

/** Aggregate readiness across all registered probes. */
export interface HealthReport {
  healthy: boolean;
  checks: Record<string, ReadinessResult>;
}

/**
 * Registry of readiness probes consulted by `GET /health`.
 *
 * Story 1.5 registers Redis and Postgres readiness probes here.
 * With no checks registered, `runAll()` reports `healthy: true`.
 */
export class HealthRegistry {
  private readonly checks = new Map<string, ReadinessCheck>();

  /**
   * Register a named readiness probe.
   * Throws if a probe with this name is already registered — duplicate registration
   * is a boot bug that should be caught immediately (fail-loud).
   */
  register(name: string, check: ReadinessCheck): void {
    if (this.checks.has(name)) {
      throw new Error(`HealthRegistry: duplicate probe name "${name}"`);
    }
    this.checks.set(name, check);
  }

  /** Remove a named readiness probe. No-op if it was never registered. */
  unregister(name: string): void {
    this.checks.delete(name);
  }

  /**
   * Run every registered probe concurrently and aggregate. A probe that throws
   * OR resolves a malformed (non-`{ok:boolean}`) shape counts as
   * `{ ok: false, detail: 'malformed readiness result' }` — a crashing probe must
   * never crash the endpoint.
   */
  async runAll(): Promise<HealthReport> {
    const entries = [...this.checks.entries()];
    const results = await Promise.all(
      entries.map(async ([name, check]): Promise<[string, ReadinessResult]> => {
        try {
          const result = await check();
          if (result === null || result === undefined || typeof result.ok !== 'boolean') {
            return [name, { ok: false, detail: 'malformed readiness result' }];
          }
          return [name, result];
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          return [name, { ok: false, detail }];
        }
      }),
    );

    const checks: Record<string, ReadinessResult> = {};
    for (const [name, result] of results) {
      checks[name] = result;
    }
    const healthy = results.every(([, result]) => result.ok);
    return { healthy, checks };
  }
}

/** Process-wide singleton. Later stories register store probes against this. */
export const healthRegistry = new HealthRegistry();
