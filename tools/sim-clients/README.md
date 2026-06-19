# sim-clients — headless bot-swarm simulator

A **dev-only** tool: real socket clients that fill player seats and self-solve
rounds, so a solo dev can verify the multiplayer game loop (Stories **8.6**
between-round flow / scoreboard and **8.1** difficulty dashboard) **without
juggling four-plus browser windows**.

The bots are ordinary `socket.io-client` connections typed against the real
`ClientToServerEvents` / `ServerToClientEvents` contract — indistinguishable from
a browser to the server. They compute each move from the **public** `BOMB_INIT`
snapshot using the shared pure solve functions (`solveWires`, `decideButton` +
`releaseDigitFor`, `isValidPassword`) — the same honest path a human Defuser
reading the manual takes. No baked answer is read (there isn't one to read).

## The hybrid workflow (the common case)

**You stay the Facilitator in one real browser** — that's exactly the UI 8.6 /
8.1 ask you to verify. The bots are the players.

```
1. Browser: host a session as Facilitator  →  note the join code (e.g. ABC123)
2. Terminal: pnpm --filter @bomb-squad/sim-clients sim --code ABC123 --teams 2 --per-team 2
3. Browser: assign the bots to teams, open Preparation, Start the round.
            → the Defuser bots self-solve; watch the scoreboard / between-round flow.
   Next round: just open Preparation + Start again — the bots follow the rotated Defuser.
```

> **Run the server on plain `tsx`, NOT `tsx watch`.** A watch restart drops the
> in-memory `setTimeout` timer wake (single-process V1), which breaks the
> `--outcome timeout` path. (See `timer-verification-tsx-watch-gotcha`.)

## Fully headless (no human)

A bot can also be the Facilitator and drive everything itself — useful for a
quick smoke or future automation:

```
pnpm --filter @bomb-squad/sim-clients sim --create --teams 2 --per-team 2 --rounds 2
```

## Flags

| Flag | Default | Meaning |
|------|---------|---------|
| `--url <url>` | `http://localhost:8080` | Server URL (use your Docker stack origin) |
| `--code <joinCode>` | — | Join an existing human-created session (hybrid mode) |
| `--create` | off | Spawn a bot Facilitator that creates + drives the session |
| `--teams <n>` | `2` | Number of teams (1 or 2) |
| `--per-team <n>` | `2` | Players per team |
| `--outcome <o>` | `defuse` | `defuse` \| `strike` \| `timeout` |
| `--rounds <n>` | `1` | (`--create` only) rounds to play |

`--outcome`:
- **defuse** — the Defuser bot solves every module (cuts the right wire, taps/holds
  the button releasing on the right timer digit, cycles passwords to the unique word).
- **strike** — emits one deliberately-wrong action on the first strikeable module.
- **timeout** — idles and lets the server clock run the round out.

## Verify (Docker-free end-to-end)

```
pnpm --filter @bomb-squad/sim-clients verify
```

Boots an **in-process** Socket.IO server wired with the real session + module
handlers over an in-memory Redis, then runs the autonomous swarm to prove the
bots drive the real reducers: a two-team **defuse** (wires + passwords), a
**multi-round** run (Defuser rotation), a **button** defuse (PRESS/RELEASE +
timer-digit hold loop over sockets), and a **strike**. Exits non-zero on failure.

## Honest boundaries

- **No LiveKit voice and no 3D rendering** — those need real browsers and are out
  of scope (Epic 3 / the bomb scene). 8.6 and 8.1 don't depend on voice.
- The bots hold no game logic beyond *choosing* a move; they mirror server state
  and let the server adjudicate (server-authoritative). Only the current Defuser
  interacts — a non-Defuser's emit just earns a typed `ERROR`, which is logged.
- Team assignment is **sequential** by design: `TEAM_ASSIGN` is a load-modify-store
  on the single session key, and the server's accepted concurrency model is
  human-speed; firing assignments concurrently would race the read-modify-write.

## Layout

```
src/
  main.ts        CLI (hybrid --code / autonomous --create)
  swarm.ts       orchestration: build swarm, assign teams, play rounds
  BotClient.ts   one simulated player (typed socket + state mirror + solve loop)
  solvers.ts     module → shared-solve dispatch (+ wrong-action variants)
  timerDigits.ts timer-LCD digit extraction (mirror of apps/client timerLcd.ts)
  verify.ts      Docker-free in-process end-to-end check
```

The shipped tool depends only on `@bomb-squad/shared` + `socket.io-client`.
`@bomb-squad/server` + `socket.io` are **dev** dependencies used only by
`verify.ts` to boot the in-process server; nothing in the app/server/shared
packages imports this tool.
