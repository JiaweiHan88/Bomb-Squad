import type { BombState } from '../types/bomb.js';
import type { ModuleState } from '../types/module.js';
import type { RoundConfig, TeamId } from '../types/session.js';
import {
  deriveTemplateSeed,
  deriveTeamSeed,
  deriveModuleSeed,
} from '../seeding/index.js';
import { MODULE_GENERATORS, TIER_POOLS } from '../modules/registry.js';
import { generateBombContext } from './bombContext.js';
import { generateLayout } from './layout.js';

/**
 * Assemble one team's BombState from the round's shared layout and the team's seed.
 *
 * RNG-stream discipline (correctness-critical): the team's context consumes a
 * makeSeededRng(teamSeed) stream; each module consumes its OWN makeSeededRng
 * (moduleSeed) stream inside its generate. moduleSeeds come from deriveModuleSeed
 * (a hash of teamSeed:index), NOT from continued draws on the context stream — so
 * a module's values are independent of how many RNG calls context generation made.
 * Never thread one rng across stages, or widening a context range silently
 * reshuffles every module and breaks retry-reproducibility across releases.
 */
function generateTeamBomb(teamSeed: number, layout: readonly string[]): BombState {
  const context = generateBombContext(teamSeed);
  const modules: ModuleState<unknown>[] = layout.map((moduleId, i) => {
    const moduleSeed = deriveModuleSeed(teamSeed, i);
    // MODULE_GENERATORS keys are validated against the pool in generateLayout, and
    // layout is drawn only from that pool, so every id here is registered.
    const data = MODULE_GENERATORS[moduleId](moduleSeed, context);
    return { moduleId, status: 'armed', data };
  });
  return { context, modules, strikes: 0, solved: false };
}

/**
 * Generate every team's bomb for a round in one synchronous, pure pass (AC1).
 *
 * Seed-chain wiring (architecture Pattern 4 / the 1.3 contract — call it, don't
 * reimplement): templateSeed derived once from (sessionId, roundNumber); the
 * layout drawn once from templateSeed (identical for all teams); per team a
 * distinct teamSeed → an independent context + module values. Same inputs always
 * reproduce the same bombs, which is what round retry (8.8) depends on (AC3).
 *
 * No await, no I/O, no Date.now() / Math.random() anywhere in this module — pure
 * CPU-cheap functions per the synchronous-generation rule. Persistence and
 * broadcasting live server-side (initializeRoundBombs / the ROUND_START handler).
 *
 * Pool resolution: an explicit config.modulePool wins; otherwise the difficulty
 * tier's default pool. Fails loud (via generateLayout) on an empty/unregistered
 * pool or an out-of-range moduleCount — and generates ALL teams before any caller
 * persists, so a bad config never leaves a partially-written round.
 */
export function generateRoundBombs(
  sessionId: string,
  roundNumber: number,
  config: RoundConfig,
  teamIds: readonly TeamId[],
): Record<TeamId, BombState> {
  const pool = config.modulePool ?? TIER_POOLS[config.difficulty];
  const templateSeed = deriveTemplateSeed(sessionId, roundNumber);
  const layout = generateLayout(templateSeed, config.moduleCount, pool);

  const bombs = {} as Record<TeamId, BombState>;
  for (const teamId of teamIds) {
    const teamSeed = deriveTeamSeed(templateSeed, teamId);
    bombs[teamId] = generateTeamBomb(teamSeed, layout);
  }
  return bombs;
}
