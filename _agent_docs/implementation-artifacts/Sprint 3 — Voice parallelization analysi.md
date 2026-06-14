 Sprint 3 — Voice parallelization analysis

  Sprint 3 stories (all backlog): 3-1 LiveKit token mint, 3-2 Bomb Room channel, 2-5 Lobby roster/ready/mic-check, 2-6
  Capacity & join-window guards, 2-7 Lobby resilience & Facilitator controls.

  What's already in place that shapes the waves:
  - apps/server/src/config/env.ts already validates LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET / TURN_SECRET /
  TURN_TTL — 3-1 can mint immediately, no config plumbing.
  - apps/client/src/store/voiceStore.ts already exists as a shape-only stub (idle | connecting | connected |
  unavailable), explicitly "no LiveKit SDK calls in this story" — 3-2 fills it in.
  - LiveKit container is already wired in docker-compose.yml (livekit/livekit-server:v1.8, single UDP mux 7882). No
  livekit-server-sdk/livekit-client npm deps installed yet — 3-1/3-2 add them.
  - Lobby roster already renders team/role/"You" and re-broadcasts on assignment (Lobby.tsx:69-78); the file comments
  say mic check + ready + empty-state are "Story 2.5 — intentionally absent."
  - Session/role/join machinery (session/joinSession.ts, handlers/sessionHandlers.ts, teamRoom/sessionRoom) is merged —
  the 2-x lobby stories build straight on it.

  Wave 1 — start now, two parallel worktrees

  Worktree: A
  Stories: 3-1 Token mint + 3-2 Bomb Room channel
  Why it's independent: The voice subsystem. 3-2 needs 3-1's bomb-room:{sessionId}:{teamId} token, so they chain
    naturally in one worktree (the 8-3+8-4 pattern). Server adds a voice/ module + VOICE_TOKEN request/grant event;
    client wires LiveKit connect into the existing voiceStore stub. Per AR12/ADR-007 voice never gates game state, so it

    touches no reducer/session logic.
  ────────────────────────────────────────
  Worktree: B
  Stories: 2-6 Capacity & join-window + 2-7 Lobby resilience
  Why it's independent: Pure lobby-server hardening + Lobby UI: capacity (2–16) and no-mid-round-join guards,
    PLAYER_REMOVE (Facilitator-only), lobby-phase disconnect cleanup, refresh-rejoin dedupe, and the share-link "Join"
    button. No voice dependency. Bundled because both edit sessionHandlers.ts and Lobby.tsx — splitting them would just
    create an intra-sprint conflict.

  Two worktrees is the honest width here — Sprint 3 is only 5 stories and the voice track is a server chain, so it can't
  fan out as wide as Sprint 2's four.

  Merge surface: packages/shared/src/events/* (client-to-server.ts, server-to-client.ts, payloads.ts) — A adds
  VOICE_TOKEN, B adds PLAYER_REMOVE + a capacity error. Small and additive, same easy reconcile as Sprint 2's A/D.

  Wave 2 — blocked on Wave 1

  - 2-5 Lobby roster, ready state & mic check — splits across both Wave-1 outputs:
    - The mic-check speaker indicator (green when a player's mic is live, gray when silent, visible to the Facilitator
  for every player) is cross-player presence — that requires real LiveKit active-speaker data, so it builds on 3-2's
  room/token infra, not a local-only meter.
    - It also re-edits Lobby.tsx, which 2-7 rewrites — so it must rebase on B.

  → Do 2-5 last, on master, after A and B merge.

  ▎ If you'd rather widen Wave 1 to three worktrees, 2-6 and 2-7 can split — the cost is one sessionHandlers.ts
  ▎ reconcile (2-6's capacity guard in the JOIN handler vs. 2-7's new PLAYER_REMOVE/disconnect handlers). I'd keep them
  ▎ bundled; the gain isn't worth the merge.

  Two execution gotchas for the voice worktrees (from past sprints)

  These bit earlier full-stack/timer work and Sprint 3 is the first voice sprint, so they apply hard to worktree A:
  - Worktree env + build: worktrees don't get the gitignored .env, and a stale main-built image will run old code.
  Provision .env (now including the LiveKit/TURN secrets) and always --build with a worktree-scoped compose project
  name, or voice will silently connect to the wrong/old stack. ([[worktree-fullstack-testing-gap]])
  - Real container + port collisions: voice can only be verified against the actual LiveKit + coturn containers (per
  AR16), and worktree host-port collisions land you on the wrong passworded Redis/Postgres. Don't trust a mock.
  ([[timer-verification-tsx-watch-gotcha]])
  - Human-verification AC: 3-2 and 2-5 are user-visible/e2e ("Defuser + Expert talk over voice", mic-check indicator) —
  each needs the explicit "Jay verifies interactively" subtask, not done until his observed result is in Completion
  Notes. ([[human-verification-ac-rule]])

  TL;DR: kick off A = 3-1+3-2 (voice) and B = 2-6+2-7 (lobby hardening) in two parallel worktrees now; finish with 2-5
  on master once both land, since its mic-check rides on 3-2's voice room and its UI rides on 2-7's lobby. Provision
  .env + --build per worktree, and verify voice against the real LiveKit/coturn containers.

  Want me to spin up the two Wave-1 worktrees and draft story context for 3-1/3-2 and 2-6/2-7?