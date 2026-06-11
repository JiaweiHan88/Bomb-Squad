import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv, EnvValidationError, type Config } from './env.js';

/**
 * Find the nearest `.env` by walking up from `start` toward the repo root.
 * The monorepo keeps a single root `.env` (gitignored; `.env.example` documents
 * it), but pnpm runs scripts with cwd set to the package dir — so a plain
 * cwd-relative lookup would miss it. The search stops at the repo root (the dir
 * holding `pnpm-workspace.yaml` or `.git`) so a stray ancestor `.env`
 * (`$HOME/.env`, `/.env`) can never be silently hydrated. Returns undefined if
 * none is found.
 */
function findEnvFile(start: string): string | undefined {
  let dir = start;
  for (;;) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    // Reached the repo root without finding a `.env` — stop rather than escaping
    // the project tree.
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml')) || existsSync(resolve(dir, '.git'))) {
      return undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load and freeze config from `process.env`, failing fast on invalid input.
 * Runs at module load so importing `config` *before* any `listen()` call
 * guarantees the process never serves traffic with bad config.
 *
 * The pure validation lives in `env.ts` (testable with an injected object);
 * this barrel owns the impure steps — hydrating `process.env` from a local
 * `.env` (best-effort; in containers env comes from the environment and no
 * `.env` exists), then reading `process.env` and exiting on invalid config.
 */
function loadConfig(): Config {
  try {
    // Hydrate `process.env` from the nearest project `.env` (best-effort; in
    // containers env comes from the environment and no `.env` exists). Inside the
    // try so a malformed/unreadable `.env` surfaces the clean config-error path
    // instead of a raw stack trace.
    const envFile = findEnvFile(process.cwd());
    if (envFile) {
      process.loadEnvFile(envFile);
      console.info(`Loaded environment from ${envFile}`);
    }
    return Object.freeze(parseEnv(process.env));
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error('✖ Server configuration is invalid — refusing to start:');
      for (const issue of err.issues) {
        console.error(`  - ${issue}`);
      }
    } else {
      console.error('✖ Unexpected error while loading configuration:', err);
    }
    process.exit(1);
  }
}

export const config: Config = loadConfig();
export { parseEnv, EnvValidationError } from './env.js';
export type { Config } from './env.js';
