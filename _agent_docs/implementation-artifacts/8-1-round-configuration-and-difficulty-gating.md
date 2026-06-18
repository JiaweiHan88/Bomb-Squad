---
baseline_commit: 1ad360784ae3d12f3cf2b83e7faf57d70bcb911e
---

# Story 8.1: Round Configuration & Difficulty Gating

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Facilitator,
I want to configure each round's difficulty, module pool, count, timer, and modifiers,
so that I can tune the challenge to my team.

## Acceptance Criteria

1. **Tier gates pool + defaults.** In the dashboard round-setup, when the Facilitator picks a difficulty tier (Easy / Medium / Hard), the module pool and the default module count + timer are gated to that tier:
   - Easy → pool {Wires, Button, Passwords}; default count 3–4; default timer 5:00.
   - Medium → adds {Keypads, Who's on First, Wire Sequences, Mazes}; default count 5–6; default timer 6:00.
   - Hard → adds {Complicated Wires, Simon Says, Memory, Morse Code}; default count 7–9; default timer 7:00.
   - Each tier is a **superset** of the easier one (harder rounds may still draw easy modules).
2. **Overrides accepted + recorded.** When the Facilitator overrides the module pool, module count (3–11), timer, strike speed-up % (0–50%), or modifier toggles, the overrides are accepted and a `ROUND_CONFIGURE` event (Facilitator-only) records them into `SessionState.config`, broadcast to the room.
3. **Calm operator-world styling.** The dashboard round-setup renders in operator-world styling (dark surface, cream ink — NO bakelite/brass/LED-decorative palette) with **no fast-blinking elements and no nested modals**.

## Tasks / Subtasks

- [x] **Task 1 — Canonical tier catalog + tier defaults (shared)** (AC: 1)
  - [x] Add a `TIER_CATALOG: Record<DifficultyTier, readonly ModuleId[]>` in `packages/shared/src/modules/registry.ts` holding the **full canonical KTANE tiering** from Decision 006 (Easy: wires/the-button/passwords; Medium: + keypads/whos-on-first/wire-sequences/mazes; Hard: + complicated-wires/simon-says/memory/morse-code). This is **display/gating metadata only** — it lists modules that may not have generators yet. **Do NOT change `TIER_POOLS`** (the runtime generation pool); see Dev Notes "The two-pool split" — conflating them will make `generateLayout` throw at round start.
  - [x] Add `TIER_DEFAULTS: Record<DifficultyTier, { moduleCount: number; timerMs: number }>` from the GDD table: easy `{3, 300_000}`, medium `{5, 360_000}`, hard `{7, 420_000}`. (Pick the low end of each tier's count range as the default.)
  - [x] Export both from the shared barrel (`packages/shared/src/modules/index.ts` / wherever `TIER_POOLS` is re-exported). Verify with `grep`.
  - [x] Unit test: every `TIER_CATALOG` id is a member of `MODULE_IDS`; each tier is a superset of the easier tier; `TIER_DEFAULTS` counts are within 3–11.

- [x] **Task 2 — Shared config validator extracted + reused** (AC: 2)
  - [x] Extract the per-key `RoundConfig` validation currently inlined in `parseSessionCreatePayload` (`apps/server/src/handlers/sessionHandlers.ts:113-183`) into a reusable `parseRoundConfig(config: unknown, { full: boolean })` helper (co-locate near the handler or in a new `apps/server/src/session/parseRoundConfig.ts`). `full: false` = Partial (SESSION_CREATE today); `full: true` = require ALL fields present (ROUND_CONFIGURE payload carries a complete `RoundConfig`, not a Partial — see `RoundConfigurePayload` at `packages/shared/src/events/payloads.ts:59`).
  - [x] Repoint `parseSessionCreatePayload` at the extracted helper (behavior-preserving; its existing tests must still pass).
  - [x] **Add modulePool generator-existence validation**: reject any `modulePool` id that is not a key of `MODULE_GENERATORS`. This makes a bad pool fail at *configure* time (typed ERROR to the facilitator) instead of throwing inside `generateLayout` at ROUND_START. Keep the existing string-array shape check too.
  - [x] Unit tests for `parseRoundConfig`: full vs partial mode; each out-of-range field rejected (count 2/12, pct -1/51, timer 0, unknown difficulty, unknown modifier key, non-string pool member, **unregistered pool id**); a valid full config round-trips to a fresh object (never the input reference).

- [x] **Task 3 — `ROUND_CONFIGURE` server handler** (AC: 2)
  - [x] Register `socket.on('ROUND_CONFIGURE', …)` inside `registerSessionHandlers` (`apps/server/src/handlers/sessionHandlers.ts`), mirroring the `TEAM_ASSIGN` / `PREPARATION_OPEN` pipeline exactly (lines 734-831 / 836+): parse → `notInSession` guard → load fresh state from Redis → **authority gate FIRST** (`state.players[socket.data.playerId ?? '']?.role !== 'facilitator'` → `NOT_FACILITATOR`) → phase guard → idempotent no-op check → `setJSON` persist → `io.to(sessionRoom(sessionId)).emit('SESSION_STATE', next)` → structured `log.info`.
  - [x] Phase guard: allow when `state.status` is `'lobby'` OR `'between-rounds'` (both are pre-round configuration windows — round 2+ reuses `session.config`). Reject other phases with `code: 'NOT_IN_CONFIGURABLE_PHASE'` (recoverable). Frozen-contract: **no ack** — success is the SESSION_STATE broadcast, failure a typed ERROR.
  - [x] Build the next state immutably: `{ ...state, config: validatedConfig }` (validatedConfig is the fresh object from `parseRoundConfig(..., { full: true })`, with `modifiers` rebuilt — never spread the raw client object). Idempotent no-op: if the new config deep-equals the current one, return without persist/broadcast (match the TEAM_ASSIGN `next === state` pattern — use a small deep-equal or field compare).
  - [x] Error codes: `INVALID_PAYLOAD` (parse fail), `NOT_IN_SESSION`, `NOT_FACILITATOR`, `NOT_IN_CONFIGURABLE_PHASE`, `ROUND_CONFIGURE_FAILED` (catch-all in the `try/catch`).
  - [x] Integration tests in `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` via `testSocketServer`: facilitator configures in lobby → SESSION_STATE carries new config; non-facilitator → `NOT_FACILITATOR` and NO broadcast/persist; bad payload → `INVALID_PAYLOAD`; unregistered pool id → `INVALID_PAYLOAD` (no broadcast); active-phase attempt → `NOT_IN_CONFIGURABLE_PHASE`; idempotent re-send → no second broadcast.

- [x] **Task 4 — Round-config dashboard panel (client)** (AC: 1, 2, 3)
  - [x] Create `apps/client/src/ui/RoundConfigPanel.tsx` — a **Facilitator-only** panel rendered inside `Lobby.tsx` (this is Section A of the Facilitator Dashboard mockup; team roster = Section B already exists, Open Preparation = Section C). Gate render on `session.players[myPlayerId]?.role === 'facilitator'` (use `myPlayerId` from the store, NOT `getSocket().id` — see [[identity-key-change-needs-client-sweep]]).
  - [x] Controls (all from `session.config`, server-truth-driven — derive UI state from the snapshot, emit `ROUND_CONFIGURE` with the full config, let the broadcast reconcile):
    - **Difficulty tier** — 3-way segmented control. Selecting a tier sets `difficulty` AND resets `moduleCount` + `timerMs` to `TIER_DEFAULTS[tier]` AND resets `modulePool` to the tier default (clear the override / set to `TIER_CATALOG[tier]` filtered to generatable ids — see below). Show the tier's count-range hint ("3–4 mod" etc.).
    - **Timer** — slider (range ~3:00–10:00, mm:ss readout). Emits `timerMs`.
    - **Module count** — stepper, clamped 3–11. Emits `moduleCount`.
    - **Strike speed-up %** — slider 0–50 (default 25). Emits `strikeSpeedUpPct`. *(Not in the mockup's Section A — AC-2 requires it; add it in the same operator-world style.)*
    - **Modifier toggles** — two switches: "Asymmetric Expert roles" (`modifiers.asymmetricExpertRoles`) and "Spectator lifelines" (`modifiers.spectatorLifelines`). *(Mockup shows only Asymmetric in Section A; AC-2 requires both modifier toggles.)*
    - **Module pool override** — chips for the tier's catalog modules; clicking toggles membership. **Un-implemented modules (no generator in `MODULE_GENERATORS`) render disabled** with a "coming soon"-style affordance — never selectable, because the server rejects them and `generateLayout` would throw. The selectable set today is effectively {wires, the-button, passwords}.
  - [x] No fast-blink, no nested modals: simple click toggles / sliders only; the panel is inline in the lobby surface (AC-3). Use existing design tokens (`--color-surface`, `--color-surface-raised`, `--color-cream`, `--color-ink-primary`, `--color-ink-muted`, `--font-display`, `--font-mono`) — NO `--color-bakelite` / `--color-brass` / LED colors in this panel.
  - [x] Add all user-facing strings to `apps/client/src/ui/copy.ts` (follow the existing `export const SCREAMING_SNAKE = '…'` convention); do not inline literals.
  - [x] Emit via `getSocket().emit('ROUND_CONFIGURE', { config })`. `ROUND_CONFIGURE` has no ack — surface server rejections by adding the new error codes to the Lobby error-banner's owned-codes set (`ASSIGN_ERROR_CODES` in `Lobby.tsx:57`): `NOT_FACILITATOR`, `NOT_IN_CONFIGURABLE_PHASE`, `INVALID_PAYLOAD`, `ROUND_CONFIGURE_FAILED`.
  - [x] Component test `apps/client/src/ui/__tests__/RoundConfigPanel.test.tsx` (jsdom, follow `Lobby.test.tsx`): panel hidden for non-facilitator; tier select emits a `ROUND_CONFIGURE` whose config has the tier's default count/timer; count stepper clamps at 3 and 11; strike-speedup slider clamps 0–50; un-implemented pool chips are disabled; controls reflect the incoming `session.config` snapshot.

- [ ] **Task 5 — Wire-up, typecheck, and regression sweep** (AC: 1, 2, 3)
  - [x] Confirm `ROUND_CONFIGURE` is already in `ClientToServerEvents` (`packages/shared/src/events/client-to-server.ts:46`) — it is; no event-contract change needed. Confirm `RoundConfigurePayload.config` is a full `RoundConfig`.
  - [x] `pnpm -w typecheck` clean (no `@ts-ignore`); run the full server + client test suites green; no regression in `sessionHandlers.test.ts` or `Lobby.test.tsx`.
  - [ ] **Human verification (Jay) — REQUIRED, not done until observed** [[human-verification-ac-rule]]: on the full Docker stack at `https://localhost` (server on plain `tsx`, NOT `tsx watch` per [[timer-verification-tsx-watch-gotcha]]), as Facilitator: pick each tier and confirm count/timer/pool defaults update; override count/timer/strike-speedup/modifiers/pool and confirm they stick across a refresh (broadcast-reconciled); confirm a joined non-facilitator never sees the panel; confirm the panel reads calmly (no blinking, no nested modal). Record the observed result here.

### Review Findings

_Code review 2026-06-18 (gds-code-review, 3-layer adversarial). 0 decision_needed, 2 patch, 0 defer, 8 dismissed as noise._

- [x] [Review][Patch] `timerMs` has no server-side upper bound — setTimeout 32-bit overflow can detonate a round at t≈0 [apps/server/src/session/parseRoundConfig.ts:53-58] — FIXED 2026-06-18: added `MAX_TIMER_MS = 600_000` upper bound (matches client slider, well under 2³¹); regression tests added for 600_001 and 2_200_000_000.
- [x] [Review][Patch] ROUND_CONFIGURE success log records transient `by: socket.id` instead of durable `socket.data.playerId` [apps/server/src/handlers/sessionHandlers.ts:925] — FIXED 2026-06-18: now logs `socket.data.playerId`.

## Dev Notes

### The two-pool split — the single most important constraint (AC-1 disaster prevention)

AC-1 lists Medium/Hard pools containing modules (Keypads, Simon Says, …) that **do not exist yet** (Epics 6–7 are `backlog`). `generateLayout` (`packages/shared/src/generation/layout.ts:38-45`) throws a `RangeError` at ROUND_START for **any** pool id without a registered generator in `MODULE_GENERATORS`. Therefore:

- **`TIER_POOLS`** (`registry.ts:93`) is the **runtime** generation pool — it must only ever list modules with registered generators. Today all three tiers are the interim Easy trio `['wires','the-button','passwords']`. **Leave it as-is.** Re-expansion is owned by the per-module stories as generators land (the registry comment already says so).
- **`TIER_CATALOG`** (new, Task 1) is **display/gating metadata** — the full canonical tiering, used by the dashboard to show the facilitator what each tier *will* contain and to render un-implemented modules as disabled chips.
- The dashboard's selectable/effective pool = `TIER_CATALOG[tier] ∩ keys(MODULE_GENERATORS)`. The server validates the same way (Task 2). This keeps the UI honest about the design while never letting an un-generatable id reach a bomb.

Do not "fix" `TIER_POOLS` to match AC-1's full lists — that is the regression trap.

### Existing config plumbing (reuse, do NOT reinvent)

This story was sequenced after 8.2–8.6, so the config *type and transport already exist*. Reuse them:
- `RoundConfig` / `DifficultyTier` / `ModifierConfig` types — `packages/shared/src/types/session.ts:6-24`. Already includes `difficulty`, `moduleCount`, `timerMs`, `strikeSpeedUpPct`, optional `modulePool`, `modifiers`. **No type change needed.**
- `ROUND_CONFIGURE` event is already declared in `ClientToServerEvents` (`client-to-server.ts:46`) and `RoundConfigurePayload` (`payloads.ts:59`). **No new event.** Only the *handler* is missing.
- `DEFAULT_ROUND_CONFIG` — `apps/server/src/session/createSession.ts:8` (easy / 3 / 5:00 / 25% / both modifiers off). Tier defaults you add must be consistent with this for the Easy tier.
- Per-key validation already written in `parseSessionCreatePayload` (`sessionHandlers.ts:113-183`) with the correct ranges (count 3–11, pct 0–50, timer positive, modifier whitelist). Extract & reuse — don't rewrite the ranges.
- `TIER_POOLS` consumption: `assembleBomb.ts:63` resolves `config.modulePool ?? TIER_POOLS[config.difficulty]`. Pool may be smaller than count — `generateLayout` repeats ids (KTANE-authentic, `layout.ts:14-15`). **Do not add a "pool.length ≥ count" constraint** — it's intentionally allowed.

### Server handler pattern (copy TEAM_ASSIGN exactly)

`sessionHandlers.ts:734-831` is the canonical facilitator-action pipeline; `PREPARATION_OPEN` (836+) is the payload-light variant. Non-negotiables from project-context.md and the established pattern:
- **Authority gate FIRST**, before revealing anything about session contents.
- `socket.data.sessionId` is a *pointer to load*, never authority; authority is the role check on freshly-loaded Redis state.
- Persist (`setJSON`) **then** emit `SESSION_STATE` to `sessionRoom`. Single-key write, no rollback needed; the accepted load-modify-store race (single V1 process, human-speed lobby action) needs no WATCH/lock.
- Never emit from a reducer; this is a handler, so socket I/O is correct here.
- Idempotent no-op returns without broadcast (TEAM_ASSIGN's `next === state`).

### Where the UI lives

No facilitator-dashboard component exists yet; the facilitator's surface is `Lobby.tsx` (rendered from `App.tsx` for `status === 'lobby'`). Add `RoundConfigPanel` as a facilitator-only section *within* Lobby (mockup Section A). Do **not** build a separate route — App.tsx is snapshot-driven with no router, and AC-3 forbids nested modals. The mockup `_agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/6. Facilitator Dashboard.html` is the visual reference (segmented tier control, slider, stepper, switches) — but note it omits the strike-speedup slider, the spectator-lifelines toggle, and the pool-override UI that AC-2 requires; add those in the same operator-world language.

### Testing standards summary

- Pure shared logic (`TIER_CATALOG`/`TIER_DEFAULTS`, `parseRoundConfig`) — Jest unit tests, zero infra (`packages/shared/src/__tests__/` and/or co-located server `__tests__/`).
- Socket handler — integration test via `apps/server/src/handlers/__tests__/testSocketServer.ts` (see existing `sessionHandlers.test.ts` for the facilitator/non-facilitator setup). Call the real validator; never mock it.
- Client panel — jsdom component test (the `td-1` framework is in place; follow `Lobby.test.tsx`). R3F/visual is not relevant here (operator-world DOM, not bomb scene).
- Forbidden: `Math.random()` anywhere outside `generate()`; `setTimeout`/`Date.now()` in reducer/validator tests.

### Project Structure Notes

- New files: `packages/shared/src/modules/registry.ts` (extend), `apps/client/src/ui/RoundConfigPanel.tsx`, its `__tests__`, optional `apps/server/src/session/parseRoundConfig.ts`. All conform to existing layout (project-context.md "Code Organization").
- Naming: event `ROUND_CONFIGURE` (SCREAMING_SNAKE, already set); component `PascalCase`; copy constants `SCREAMING_SNAKE` in `copy.ts`.
- `packages/shared` stays framework-free (no react/socket imports) — `TIER_CATALOG`/`TIER_DEFAULTS` are plain data.

### Project Context Rules

- **Socket/shared types**: `ROUND_CONFIGURE` is already in the typed `ClientToServerEvents`; never `socket.emit(string, any)`. Payloads live only in `packages/shared/src/events/` — already done.
- **Server-authoritative + pure boundaries**: config validation is pure; the handler owns all I/O (load → validate → persist → emit). No reducer emits sockets; no Postgres on this path (lobby action, Redis only).
- **Security**: client config is untrusted — the handler rebuilds a fresh `RoundConfig` from whitelisted keys/ranges and rejects unregistered pool ids; never forward the raw client object.
- **State boundaries**: session config lives in Redis `SessionState.config`; no Postgres write here.
- **TypeScript**: `tsc --noEmit` must pass with zero errors, no `// @ts-ignore`.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 8.1: Round Configuration & Difficulty Gating]
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Difficulty System] (tier table: pool / default count / placeholder timer)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/decision-log.md#Decision 006 — Difficulty-Gated Module Pool] (canonical tiering, Jay-confirmed)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md] ("operator-world, not bomb-world"; no brass/bakelite in dashboard)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md] ("dashboard must read calmly… No fast-blinking elements, no nested modals")
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/6. Facilitator Dashboard.html] (Section A visual reference)
- [Source: packages/shared/src/types/session.ts:6-24] (`RoundConfig`, `DifficultyTier`, `ModifierConfig`)
- [Source: packages/shared/src/modules/registry.ts:35-97] (`MODULE_GENERATORS`, `MODULE_IDS`, `TIER_POOLS`)
- [Source: packages/shared/src/generation/layout.ts:25-53] (generator-existence guard, duplicate-allowed draw)
- [Source: apps/server/src/handlers/sessionHandlers.ts:113-183, 734-831] (`parseSessionCreatePayload`, TEAM_ASSIGN facilitator pipeline)
- [Source: apps/server/src/session/createSession.ts:8-14] (`DEFAULT_ROUND_CONFIG`)
- [Source: apps/client/src/ui/Lobby.tsx:53-66] (error-banner owned-codes set; facilitator surface)
- [Source: apps/client/src/index.css:43-61] (operator-world design tokens)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (gds-dev-story)

### Debug Log References

- Full suites green: server 425, shared 211, client 310. Workspace `tsc --noEmit` clean across all three packages. No lint script configured in the repo (tsc is the quality gate).

### Completion Notes List

- **Two-pool split honoured (AC-1).** Added `TIER_CATALOG` (full canonical KTANE tiering, display/gating) and `TIER_DEFAULTS` (GDD count/timer per tier) to `registry.ts`; left the runtime `TIER_POOLS` untouched. The dashboard's selectable pool = `TIER_CATALOG[tier] ∩ keys(MODULE_GENERATORS)`; un-implemented modules render as disabled chips. Both client and server reject un-generatable pool ids, so a bad pool fails at configure-time, never inside `generateLayout` at ROUND_START.
- **One validator, two callers.** Extracted `parseRoundConfig(input, { full })` (`apps/server/src/session/parseRoundConfig.ts`) with overloads — `full: true` requires a complete `RoundConfig` (+ both modifier flags), `full: false` accepts a Partial. `parseSessionCreatePayload` now delegates to it in partial mode (behaviour-preserving; all 108 prior session-handler tests still pass). Added two defensive guards beyond the original ranges: modulePool ids must have a registered generator, and an empty modulePool override is rejected (it would otherwise throw at generation).
- **`ROUND_CONFIGURE` handler** mirrors the TEAM_ASSIGN pipeline exactly: parse → notInSession → load fresh state → **authority gate first** (`NOT_FACILITATOR`) → phase guard (`lobby`/`between-rounds` only, else `NOT_IN_CONFIGURABLE_PHASE`) → idempotent no-op (`roundConfigEqual`) → persist → broadcast SESSION_STATE. No ack (frozen contract). Catch-all `ROUND_CONFIGURE_FAILED`.
- **Facilitator dashboard panel** (`RoundConfigPanel.tsx`) rendered inside `Lobby.tsx`, self-gated (facilitator + lobby/between-rounds). Operator-world tokens only (cream accent, no bakelite/brass/LED). Controls: tier segmented (resets count/timer/pool to tier defaults), timer slider, count stepper (clamped 3–11), strike speed-up slider (0–50), two modifier switches, and a module-pool chip set with disabled un-implemented modules. Every control emits a full `RoundConfig`; the SESSION_STATE broadcast reconciles (no optimistic state). ROUND_CONFIGURE rejection codes added to the Lobby error banner's owned set.
- **Pre-existing failure corrected (not a regression).** `apps/client/src/scenes/__tests__/prepLayout.test.ts` asserted the Easy tier pool was `['wires']` — a stale assertion from Story 4.6 never updated when 5.4/5.5 expanded `TIER_POOLS.easy` to the canonical trio. Verified it failed at baseline (via `git stash -u`), then corrected the assertion to the actual trio cycling. Touched because it sits in the tier-pool domain and the suite must be green.
- **Human verification (Jay) — STILL PENDING.** Task 5's interactive subtask is unchecked; per [[human-verification-ac-rule]] this story is not fully done until Jay runs the dashboard on the Docker stack and records the observed result. All automated coverage is complete and green.

### File List

- `packages/shared/src/modules/registry.ts` (modified — added `TIER_CATALOG`, `TIER_DEFAULTS`)
- `packages/shared/src/modules/__tests__/tierGating.test.ts` (new)
- `apps/server/src/session/parseRoundConfig.ts` (new)
- `apps/server/src/session/__tests__/parseRoundConfig.test.ts` (new)
- `apps/server/src/handlers/sessionHandlers.ts` (modified — `parseSessionCreatePayload` delegates; added `roundConfigEqual` + `ROUND_CONFIGURE` handler; trimmed unused imports)
- `apps/server/src/handlers/__tests__/sessionHandlers.test.ts` (modified — added ROUND_CONFIGURE describe block)
- `apps/client/src/ui/RoundConfigPanel.tsx` (new)
- `apps/client/src/ui/__tests__/RoundConfigPanel.test.tsx` (new)
- `apps/client/src/ui/Lobby.tsx` (modified — render `RoundConfigPanel`; added ROUND_CONFIGURE error codes; `flex-wrap`)
- `apps/client/src/ui/copy.ts` (modified — round-config strings)
- `apps/client/src/scenes/__tests__/prepLayout.test.ts` (modified — corrected stale Easy-pool assertion)
- `_agent_docs/implementation-artifacts/sprint-status.yaml` (modified — status tracking)

## Change Log

- 2026-06-17 — Story 8.1 implemented (round configuration & difficulty gating): tier catalog/defaults, shared `parseRoundConfig`, `ROUND_CONFIGURE` server handler, facilitator round-config dashboard panel. Server 425 / shared 211 / client 310 tests green; typecheck clean. Human verification pending. (claude-opus-4-8)
