import { Type, type Static } from '@fastify/type-provider-typebox';
import { Errors, Parse } from 'typebox/value';

/**
 * Schema for the raw process environment. Every value arrives as a string;
 * numeric coercion (PORT, TURN_TTL) happens in {@link parseEnv} after the
 * shape is validated.
 *
 * `Type` / `Static` are imported from `@fastify/type-provider-typebox` so the
 * env schema stays on the exact same TypeBox (v1) version as the route type
 * provider. `Errors` / `Parse` come from the `typebox/value` subpath.
 */
// minLength: 1 so a present-but-blank var (e.g. `REDIS_URL=` in .env) fails
// validation rather than silently booting with an empty value.
const NonEmpty = Type.String({ minLength: 1 });
const EnvSchema = Type.Object({
  PORT: NonEmpty,
  REDIS_URL: NonEmpty,
  DATABASE_URL: NonEmpty,
  LIVEKIT_URL: NonEmpty,
  LIVEKIT_API_KEY: NonEmpty,
  LIVEKIT_API_SECRET: NonEmpty,
  TURN_SECRET: NonEmpty,
  TURN_TTL: NonEmpty,
});

type RawEnv = Static<typeof EnvSchema>;

/** The validated, coerced server configuration. */
export interface Config {
  PORT: number;
  REDIS_URL: string;
  DATABASE_URL: string;
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
  TURN_SECRET: string;
  TURN_TTL: number;
}

/** Raised when the environment fails validation. Carries one message per offending variable. */
export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Pure validation: takes an env-like object and returns a typed {@link Config},
 * or throws {@link EnvValidationError} naming every offending variable.
 *
 * Pure by design — never reads `process.env`, never calls `process.exit`, so it
 * is trivially unit-testable with an injected object.
 */
export function parseEnv(source: Record<string, unknown>): Config {
  // Enumerate the full error set before Parse so the caller sees every problem at once.
  // typebox@1 emits ajv-style errors: the offending var is in `instancePath`
  // (e.g. "/REDIS_URL") for value violations; a missing key has an empty
  // `instancePath` but carries the absent name(s) in `params.requiredProperties`
  // (keyword "required") — extract that so every error names its variable.
  const issues = [...Errors(EnvSchema, source)].map((e) => {
    const err = e as {
      instancePath?: string;
      message: string;
      keyword?: string;
      params?: { requiredProperties?: string[] };
    };
    if (err.keyword === 'required' && err.params?.requiredProperties?.length) {
      return `${err.params.requiredProperties.join(', ')}: ${err.message}`;
    }
    const field = err.instancePath ? err.instancePath.replace(/^\//, '') : '(root)';
    return `${field}: ${err.message}`;
  });
  if (issues.length > 0) {
    throw new EnvValidationError(issues);
  }

  const raw = Parse(EnvSchema, source) as RawEnv;

  // Strict decimal-integer parsing. `Number()` would accept hex ("0x10"),
  // exponent ("1e3"), and whitespace-padded (" 3001 ") forms, silently booting
  // on an unintended value — so require plain digits via `^\d+$` first.
  const DECIMAL_INT = /^\d+$/;
  const numericIssues: string[] = [];
  const PORT = Number(raw.PORT);
  if (!DECIMAL_INT.test(raw.PORT) || PORT < 1 || PORT > 65535) {
    numericIssues.push(`PORT: must be an integer in 1–65535 (got "${raw.PORT}")`);
  }
  const TURN_TTL = Number(raw.TURN_TTL);
  if (!DECIMAL_INT.test(raw.TURN_TTL) || TURN_TTL <= 0) {
    numericIssues.push(`TURN_TTL: must be a positive integer (got "${raw.TURN_TTL}")`);
  }
  if (numericIssues.length > 0) {
    throw new EnvValidationError(numericIssues);
  }

  return {
    PORT,
    REDIS_URL: raw.REDIS_URL,
    DATABASE_URL: raw.DATABASE_URL,
    LIVEKIT_URL: raw.LIVEKIT_URL,
    LIVEKIT_API_KEY: raw.LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET: raw.LIVEKIT_API_SECRET,
    TURN_SECRET: raw.TURN_SECRET,
    TURN_TTL,
  };
}
