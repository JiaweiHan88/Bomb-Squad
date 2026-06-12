import { randomBytes as cryptoRandomBytes } from 'node:crypto';

/**
 * Join-code alphabet: uppercase A–Z0–9 (36 chars). Codes are the session's only
 * secret (NFR9), so they must be crypto-random and never sequential.
 *
 * MUST NOT contain ':' — Redis key builders (`state/keys.ts`) interpolate raw
 * IDs into colon-delimited keys, so a colon would corrupt the keyspace.
 */
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Largest multiple of CHARSET.length that fits in a byte (252). Bytes at or
 * above this are rejected so every character is uniformly likely (no modulo
 * bias from 256 % 36 !== 0).
 */
const REJECTION_BOUND = Math.floor(256 / CHARSET.length) * CHARSET.length;

export type RandomBytesFn = (size: number) => Buffer;

/**
 * Generate an unguessable join code of `length` uppercase alphanumerics from
 * `crypto.randomBytes` via rejection sampling. The injectable `randomBytes`
 * exists only so unit tests can feed fixed bytes — production callers pass
 * nothing. Never Math.random(), never a counter.
 */
export function generateJoinCode(
  length = 6,
  randomBytes: RandomBytesFn = cryptoRandomBytes,
): string {
  let code = '';
  while (code.length < length) {
    // Ask for the remaining count; rejected bytes trigger another round.
    const bytes = randomBytes(length - code.length);
    for (const byte of bytes) {
      if (byte >= REJECTION_BOUND) continue;
      code += CHARSET[byte % CHARSET.length];
      if (code.length === length) break;
    }
  }
  return code;
}
