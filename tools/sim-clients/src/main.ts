/**
 * sim-clients CLI — spawn a bot swarm against a running server.
 *
 *   pnpm sim --code ABC123                 # join a human-created session (hybrid)
 *   pnpm sim --code ABC123 --outcome strike
 *   pnpm sim --create --rounds 2           # fully headless (bot is Facilitator)
 *
 * See README.md for the hybrid workflow and the honest boundaries (no voice / no
 * 3D — those need real browsers).
 */
import { buildAutonomousSwarm, buildJoinSwarm, playRound, teardown, type SwarmOptions } from './swarm.js';
import type { Outcome } from './BotClient.js';

interface Args {
  url: string;
  code?: string;
  create: boolean;
  teams: number;
  perTeam: number;
  sizes?: number[];
  outcome: Outcome;
  rounds: number;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    url: 'http://localhost:8080',
    create: false,
    teams: 2,
    perTeam: 2,
    outcome: 'defuse',
    rounds: 1,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i];
    switch (a) {
      case '--url': args.url = next(); break;
      case '--code': args.code = next(); break;
      case '--create': args.create = true; break;
      case '--teams': args.teams = Number(next()); break;
      case '--per-team': args.perTeam = Number(next()); break;
      // Asymmetric teams, e.g. --sizes 3,2 → 3 on A, 2 on B. Overrides --teams/--per-team.
      case '--sizes':
        args.sizes = next()
          .split(',')
          .map((n) => Number(n.trim()))
          .filter((n) => Number.isFinite(n) && n > 0);
        break;
      case '--outcome': args.outcome = next() as Outcome; break;
      case '--rounds': args.rounds = Number(next()); break;
      case '--help': case '-h': args.help = true; break;
      default: console.error(`Unknown flag: ${a}`); args.help = true;
    }
  }
  return args;
}

const USAGE = `
sim-clients — headless bot swarm for the Bomb Squad game loop

Usage:
  pnpm sim --code <joinCode> [options]     Join a human-created session (hybrid)
  pnpm sim --create [options]              Run fully headless (a bot is Facilitator)

Options:
  --url <url>          Server URL (default http://localhost:8080)
  --code <joinCode>    Join an existing session as players (human drives rounds)
  --create            Spawn a bot Facilitator that creates + drives the session
  --teams <n>          Number of teams, 1 or 2 (default 2)
  --per-team <n>       Players per team (default 2)
  --sizes <a,b>        Asymmetric team sizes, e.g. 3,2 (3 on A, 2 on B). Overrides
                       --teams/--per-team. Smallest valid odd case is 3,2 — a team
                       of 1 is unplayable (no Expert) and the server refuses it.
  --outcome <o>        defuse | strike | timeout (default defuse)
  --rounds <n>         (--create only) rounds to play (default 1)
  -h, --help           Show this help

Hybrid workflow (the common case):
  1. Open a browser, host a session as Facilitator → note the join code.
  2. pnpm sim --code <joinCode> --teams 2 --per-team 2
  3. In the browser: assign the bots to teams, open Preparation, Start the round.
     The Defuser bots self-solve; watch the scoreboard / between-round flow.
  NB: run the server on plain 'tsx' (NOT 'tsx watch') — a watch restart drops the
  in-memory timer wake, breaking the --outcome timeout path.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.code && !args.create)) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const opts: SwarmOptions = {
    url: args.url,
    teams: args.teams,
    perTeam: args.perTeam,
    ...(args.sizes ? { sizes: args.sizes } : {}),
    outcome: args.outcome,
    log: (m) => console.log(m),
  };

  if (args.create) {
    const swarm = await buildAutonomousSwarm(opts);
    console.log(`[sim] join code ${swarm.joinCode} — playing ${args.rounds} round(s), outcome=${args.outcome}`);
    for (let r = 0; r < args.rounds; r++) {
      if (args.outcome === 'strike') {
        console.log('[sim] strike outcome does not resolve a round; open/start it once and observe strikes');
        swarm.facilitator!.openPreparation();
        await swarm.facilitator!.waitUntil(() => swarm.facilitator!.session?.status === 'preparation');
        swarm.facilitator!.startRound();
        await new Promise((r) => setTimeout(r, 3000));
        break;
      }
      await playRound(swarm);
      console.log(`[sim] round ${r + 1} resolved`);
    }
    teardown(swarm);
    process.exit(0);
  }

  const swarm = await buildJoinSwarm(opts, args.code!);
  console.log('[sim] bots joined. Drive the round from your browser; Ctrl-C to stop.');
  const stop = (): void => {
    teardown(swarm);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Keep the process alive while the bots react to BOMB_INIT broadcasts.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
