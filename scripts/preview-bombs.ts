/**
 * preview-bombs — eyeball Story 8.2 per-team bomb generation.
 *
 * Usage (tsx is the server runtime — no new deps):
 *   pnpm --filter @bomb-squad/server exec tsx ../../scripts/preview-bombs.ts [sessionId] [roundNumber]
 *
 * Prints both teams' bombs for a round so a human can confirm, by eye:
 *   1. both teams show the SAME module layout (identical slot order),
 *   2. serial / batteries / indicators / ports DIFFER between teams,
 *   3. re-running with the same args reproduces byte-identical bombs (retry),
 *   4. changing roundNumber changes the bomb.
 *
 * Pure, in-process, no infra — mirrors the smoke-test script's "report what you
 * see" tone but for generation rather than service reachability.
 */
import {
  generateRoundBombs,
  type RoundConfig,
  type TeamId,
  type BombState,
} from '@bomb-squad/shared';

const sessionId = process.argv[2] ?? 'preview-session';
const roundNumber = Number(process.argv[3] ?? '1');
const TEAMS: readonly TeamId[] = ['A', 'B'];

const config: RoundConfig = {
  difficulty: 'easy',
  moduleCount: 4,
  timerMs: 300_000,
  strikeSpeedUpPct: 25,
  modulePool: ['dev-demo'], // only generatable module until Story 5.3
  modifiers: { asymmetricExpertRoles: false, spectatorLifelines: false },
};

function printTeam(teamId: TeamId, bomb: BombState): void {
  const { context, modules } = bomb;
  const indicators =
    context.indicators.map((i) => `${i.label}${i.lit ? '*' : ''}`).join(' ') || '(none)';
  const ports = context.ports.join(' ') || '(none)';
  console.log(`\n  Team ${teamId}`);
  console.log(`    serial     : ${context.serialNumber}`);
  console.log(`    batteries  : ${context.batteryCount}`);
  console.log(`    indicators : ${indicators}   (* = lit)`);
  console.log(`    ports      : ${ports}`);
  modules.forEach((m, i) => {
    console.log(`    slot ${i} [${m.status}] ${m.moduleId}  ${JSON.stringify(m.data)}`);
  });
}

function layoutOf(bombs: Record<TeamId, BombState>): string {
  return bombs.A.modules.map((m) => m.moduleId).join(', ');
}

function main(): void {
  console.log('=========================================');
  console.log(`Bomb preview — sessionId="${sessionId}" roundNumber=${roundNumber}`);
  console.log(`config: difficulty=${config.difficulty} moduleCount=${config.moduleCount} pool=[${config.modulePool?.join(', ')}]`);
  console.log('=========================================');

  const bombs = generateRoundBombs(sessionId, roundNumber, config, TEAMS);

  const layoutA = bombs.A.modules.map((m) => m.moduleId).join(', ');
  const layoutB = bombs.B.modules.map((m) => m.moduleId).join(', ');
  console.log(`\nlayout (identical for both teams): [${layoutA}]`);
  console.log(`  teams share layout: ${layoutA === layoutB}`);

  for (const teamId of TEAMS) printTeam(teamId, bombs[teamId]);

  // (2) independence: serials differ between teams.
  console.log(
    `\nserials differ between teams: ${bombs.A.context.serialNumber !== bombs.B.context.serialNumber}`,
  );

  // (3) retry: re-run in-process with the same args → byte-identical.
  const rerun = generateRoundBombs(sessionId, roundNumber, config, TEAMS);
  const reproduces = JSON.stringify(rerun) === JSON.stringify(bombs);
  console.log(`re-run reproduces (same args): ${reproduces}`);

  // (4) roundNumber sensitivity: next round differs.
  const nextRound = generateRoundBombs(sessionId, roundNumber + 1, config, TEAMS);
  const changed = JSON.stringify(nextRound) !== JSON.stringify(bombs);
  console.log(`round ${roundNumber + 1} differs from round ${roundNumber}: ${changed}  (layout=[${layoutOf(nextRound)}])`);
  console.log('=========================================');
}

main();
