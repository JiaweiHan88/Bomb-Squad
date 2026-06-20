/**
 * Swarm orchestration — spawn a cluster of BotClients and run rounds.
 *
 * Two modes, because TEAM_ASSIGN / PREPARATION_OPEN / ROUND_START are
 * facilitator-only (server authority):
 *
 *  - AUTONOMOUS (`buildAutonomousSwarm` + `playRound`): one bot is the
 *    Facilitator (mints itself via SESSION_CREATE), assigns teams, and drives the
 *    round lifecycle. Fully headless — used by the verify harness and any future
 *    automated E2E.
 *
 *  - HYBRID/JOIN (`buildJoinSwarm`): player bots join an existing session a HUMAN
 *    created; the human Facilitator (in a real browser) assigns teams and drives
 *    rounds, while the bots react to each BOMB_INIT. This is the workflow that
 *    unblocks the 8.6 / 8.1 human-verification gates without juggling browsers.
 *
 * The reactive Defuser loop lives in BotClient and serves BOTH modes — the only
 * difference is WHO performs the facilitator actions.
 */
import type { RoundConfig, TeamId } from '@bomb-squad/shared';
import { BotClient, type Outcome } from './BotClient.js';

const TEAM_IDS: readonly TeamId[] = ['A', 'B'];

export interface SwarmOptions {
  url: string;
  /** Number of teams (1 or 2). Ignored when `sizes` is set. */
  teams: number;
  /** Players per team (uniform). Ignored when `sizes` is set. */
  perTeam: number;
  /**
   * Explicit per-team sizes for ASYMMETRIC teams, e.g. `[3, 2]` → 3 on A, 2 on B.
   * Overrides `teams`/`perTeam`. `sizes[i]` maps to TEAM_IDS[i] (A, then B). Use
   * this to exercise odd-team equalisation (the smallest valid odd case is 3v2 —
   * a team of 1 is unplayable and the server now refuses it).
   */
  sizes?: number[];
  /** What each Defuser does per round. */
  outcome: Outcome;
  pacingMs?: number;
  log?: (msg: string) => void;
}

/**
 * The per-player team assignment plan: one TeamId per bot, grouped by team in
 * A-then-B order. Derived from `sizes` when present, else `teams × perTeam`
 * uniform. Used by BOTH `makePlayers` (naming) and `assignTeams` (assignment) so
 * names and team membership always agree.
 */
function resolveTeamPlan(opts: SwarmOptions): TeamId[] {
  const sizes =
    opts.sizes && opts.sizes.length > 0
      ? opts.sizes
      : Array.from({ length: opts.teams }, () => opts.perTeam);
  const plan: TeamId[] = [];
  sizes.forEach((count, teamIndex) => {
    const teamId = TEAM_IDS[teamIndex];
    if (teamId === undefined) return; // ignore sizes beyond the 2 supported teams
    for (let i = 0; i < count; i++) plan.push(teamId);
  });
  return plan;
}

export interface Swarm {
  facilitator: BotClient | null;
  players: BotClient[];
  all: BotClient[];
}

function makePlayers(opts: SwarmOptions, plan: TeamId[]): BotClient[] {
  // Name each bot by its planned team + index (Bot-A1, Bot-A2, …, Bot-B1), so the
  // display name matches the team `assignTeams` gives it.
  const seenPerTeam: Record<string, number> = {};
  return plan.map((teamId) => {
    const idxInTeam = (seenPerTeam[teamId] = (seenPerTeam[teamId] ?? 0) + 1);
    return new BotClient({
      url: opts.url,
      displayName: `Bot-${teamId}${idxInTeam}`,
      outcome: opts.outcome,
      pacingMs: opts.pacingMs,
      log: opts.log,
    });
  });
}

/**
 * Assign each player round-robin across the teams; first per team = Defuser.
 * SEQUENTIAL by design: TEAM_ASSIGN is a load-modify-store on the single session
 * key, and the server's accepted concurrency model is human-speed (one lobby
 * action at a time, no WATCH/lock). Firing assignments concurrently races the
 * read-modify-write and only the last write survives — so we await each
 * assignment's reflection in the facilitator snapshot before the next.
 */
async function assignTeams(facilitator: BotClient, players: BotClient[], plan: TeamId[]): Promise<void> {
  const seenPerTeam: Record<string, number> = {};
  for (let i = 0; i < players.length; i++) {
    const bot = players[i];
    const teamId = plan[i]!;
    const count = (seenPerTeam[teamId] ??= 0);
    facilitator.assignTeam(bot.playerId!, teamId, count === 0 ? 'defuser' : 'expert');
    seenPerTeam[teamId] = count + 1;
    await facilitator.waitUntil(() => facilitator.session?.players[bot.playerId!]?.teamId === teamId);
  }
}

/**
 * AUTONOMOUS: facilitator bot creates the session, players join + ready,
 * facilitator assigns teams (+ optional round config). Returns the swarm ready
 * to `playRound`. Resolves the join code via the returned facilitator's session.
 */
export async function buildAutonomousSwarm(
  opts: SwarmOptions,
  config?: Partial<RoundConfig>,
): Promise<Swarm & { joinCode: string }> {
  const log = opts.log ?? (() => {});
  const facilitator = new BotClient({ url: opts.url, displayName: 'Bot-Facilitator', log });
  await facilitator.connect();
  const { joinCode } = await facilitator.createSession(config);
  log(`[swarm] session created, join code ${joinCode}`);

  const plan = resolveTeamPlan(opts);
  const players = makePlayers(opts, plan);
  for (const bot of players) {
    await bot.connect();
    await bot.join(joinCode, 'defuser');
    bot.ready(true);
  }

  await assignTeams(facilitator, players, plan);
  const teamCount = new Set(plan).size;
  log(`[swarm] ${players.length} players assigned across ${teamCount} team(s)`);

  return { facilitator, players, all: [facilitator, ...players], joinCode };
}

/**
 * HYBRID/JOIN: player bots join a human-created session and ready up. No bot
 * facilitator — the human assigns teams and drives rounds; the bots react to
 * each BOMB_INIT automatically (multi-round safe: a fresh BOMB_INIT re-triggers
 * the Defuser of that round).
 */
export async function buildJoinSwarm(opts: SwarmOptions, joinCode: string): Promise<Swarm> {
  const log = opts.log ?? (() => {});
  const players = makePlayers(opts, resolveTeamPlan(opts));
  for (const bot of players) {
    await bot.connect();
    await bot.join(joinCode, 'defuser');
    bot.ready(true);
  }
  log(`[swarm] ${players.length} player bots joined ${joinCode}; waiting for the human Facilitator…`);
  return { facilitator: null, players, all: players };
}

/**
 * AUTONOMOUS: open preparation, start the round, and wait for it to resolve
 * (status → between-rounds | ended). Use only with a resolving outcome
 * (defuse / timeout); a strike does not end a round.
 */
export async function playRound(swarm: Swarm, timeoutMs = 60_000): Promise<void> {
  const fac = swarm.facilitator;
  if (fac === null) throw new Error('playRound requires an autonomous swarm (no facilitator bot)');
  fac.openPreparation();
  await fac.waitUntil(() => fac.session?.status === 'preparation');
  fac.startRound();
  await fac.waitUntil(() => fac.session?.status === 'active');
  await fac.waitUntil(
    () => fac.session?.status === 'between-rounds' || fac.session?.status === 'ended',
    timeoutMs,
  );
}

/** Disconnect every socket in the swarm. */
export function teardown(swarm: Swarm): void {
  for (const bot of swarm.all) bot.disconnect();
}
