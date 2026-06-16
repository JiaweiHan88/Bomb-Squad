import type { DifficultyTier, RoundConfig } from '@bomb-squad/shared';
import { MODULE_GENERATORS } from '@bomb-squad/shared';

const DIFFICULTIES: readonly DifficultyTier[] = ['easy', 'medium', 'hard'];

/** Keys a RoundConfig may carry; `modulePool` is optional (undefined = tier default). */
const REQUIRED_KEYS = ['difficulty', 'moduleCount', 'timerMs', 'strikeSpeedUpPct', 'modifiers'] as const;

export type ParseRoundConfigResult<C> = { ok: true; config: C } | { ok: false; message: string };

/**
 * Boundary validation for an untrusted RoundConfig object. Accepts only known
 * keys with in-range values and rebuilds a fresh object — the raw client object
 * is never forwarded (nested `modifiers`/`modulePool` are copied too).
 *
 * `full: true`  — ROUND_CONFIGURE carries a COMPLETE RoundConfig; every required
 *                 field (and both modifier flags) must be present.
 * `full: false` — SESSION_CREATE carries a Partial; any subset is accepted and
 *                 only provided keys are carried through.
 *
 * `modulePool` ids are validated against MODULE_GENERATORS so an un-generatable
 * module is rejected here (typed ERROR to the facilitator) rather than throwing
 * inside generateLayout at ROUND_START.
 */
export function parseRoundConfig(input: unknown, opts: { full: true }): ParseRoundConfigResult<RoundConfig>;
export function parseRoundConfig(input: unknown, opts: { full: false }): ParseRoundConfigResult<Partial<RoundConfig>>;
export function parseRoundConfig(
  input: unknown,
  opts: { full: boolean },
): ParseRoundConfigResult<RoundConfig | Partial<RoundConfig>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, message: 'config must be an object' };
  }

  const out: Partial<RoundConfig> = {};
  for (const [key, value] of Object.entries(input)) {
    // JSON transport cannot carry undefined, but a hand-rolled in-process client
    // can — treat explicitly-undefined keys as absent.
    if (value === undefined) continue;
    switch (key) {
      case 'difficulty':
        if (!DIFFICULTIES.includes(value as DifficultyTier)) {
          return { ok: false, message: 'config.difficulty must be easy|medium|hard' };
        }
        out.difficulty = value as DifficultyTier;
        break;
      case 'moduleCount':
        if (!Number.isInteger(value) || (value as number) < 3 || (value as number) > 11) {
          return { ok: false, message: 'config.moduleCount must be an integer in 3–11' };
        }
        out.moduleCount = value as number;
        break;
      case 'timerMs':
        if (!Number.isInteger(value) || (value as number) <= 0) {
          return { ok: false, message: 'config.timerMs must be a positive integer' };
        }
        out.timerMs = value as number;
        break;
      case 'strikeSpeedUpPct':
        if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 50) {
          return { ok: false, message: 'config.strikeSpeedUpPct must be an integer in 0–50' };
        }
        out.strikeSpeedUpPct = value as number;
        break;
      case 'modulePool': {
        if (!Array.isArray(value) || !value.every((id) => typeof id === 'string')) {
          return { ok: false, message: 'config.modulePool must be an array of strings' };
        }
        if (value.length === 0) {
          // An empty override would throw inside generateLayout at ROUND_START;
          // reject it here. Omit modulePool entirely to use the tier default.
          return { ok: false, message: 'config.modulePool must list at least one module' };
        }
        for (const id of value as string[]) {
          if (!(id in MODULE_GENERATORS)) {
            return {
              ok: false,
              message: `config.modulePool contains "${id}", which has no registered generator yet`,
            };
          }
        }
        out.modulePool = [...(value as string[])];
        break;
      }
      case 'modifiers': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          return { ok: false, message: 'config.modifiers must be an object' };
        }
        const modifiers: Partial<RoundConfig['modifiers']> = {};
        for (const [modKey, modValue] of Object.entries(value)) {
          if (modValue === undefined) continue;
          if (modKey !== 'asymmetricExpertRoles' && modKey !== 'spectatorLifelines') {
            return { ok: false, message: `config.modifiers.${modKey} is not a known modifier` };
          }
          if (typeof modValue !== 'boolean') {
            return { ok: false, message: `config.modifiers.${modKey} must be a boolean` };
          }
          modifiers[modKey] = modValue;
        }
        // In full mode both flags are mandatory; in partial mode a subset is fine.
        if (opts.full && (modifiers.asymmetricExpertRoles === undefined || modifiers.spectatorLifelines === undefined)) {
          return { ok: false, message: 'config.modifiers must set both asymmetricExpertRoles and spectatorLifelines' };
        }
        out.modifiers = modifiers as RoundConfig['modifiers'];
        break;
      }
      default:
        return { ok: false, message: `config.${key} is not a known setting` };
    }
  }

  if (opts.full) {
    for (const key of REQUIRED_KEYS) {
      if (out[key] === undefined) {
        return { ok: false, message: `config.${key} is required` };
      }
    }
    return { ok: true, config: out as RoundConfig };
  }
  return { ok: true, config: out };
}
