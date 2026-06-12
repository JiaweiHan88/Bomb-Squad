---
baseline_commit: 2aa2ad0
---

# Story 4.5: Strike Indicator & Strike Roll-Up

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser,
I want a visible strike indicator that reacts to mistakes,
So that the whole team feels the shared pressure.

## Acceptance Criteria

1. **Strike LED row.** Given the HUD, when the bomb has 0–2 strikes, then a row of 2 LED dots beside the timer shows inactive/active states matching the strike count.

2. **Roll-up behaviour.** Given a module transitions to `struck`, when the bomb reducer rolls it up, then the team strike count increments (shared, no individual attribution), the affected module flashes red 600ms, and no modal interrupts play.

## Tasks / Subtasks

- [x] **Task 0 — Read the existing roll-up chain before writing anything (AC: 2)**
  - [x] Most of AC2 **already exists and is reviewed/tested** — this story renders it and proves it end-to-end, it does not rebuild it. Read, in order: `apps/server/src/reducers/bombReducer.ts` (`applyModuleResult` — `struck` is transient: increments `strikes` clamped to 3, resets module to `armed`; tested in `bombReducer.test.ts`), `apps/client/src/scenes/moduleLed.ts` + `ModuleBay.tsx` (edge-triggered 600ms red flash from 4.3 — the AC2 "module flashes red 600ms" clause is DONE), `apps/client/src/store/gameStore.ts` (`setStrike({ strikes, timer })` updates both — strikes are bomb-level, no player attribution anywhere in the payload), `apps/client/src/net/bindServerEvents.ts` (`STRIKE` → `setStrike` already bound), `packages/shared/src/events/payloads.ts` (`StrikePayload { teamId: TeamId; strikes: StrikeCount; timer: TimerState }` — absolute total, not a delta; `TeamId = 'A' | 'B'`).
  - [x] Net-new code in this story: the diegetic strike-LED chassis feature (pure module + thin component), the dev-harness full-strike path, and tests. **Zero server diffs, zero shared diffs, zero store diffs, zero `net/` diffs.**

- [x] **Task 1 — Pure visual + geometry module: `scenes/strikeIndicator.ts` (AC: 1)**
  - [x] House pattern (`moduleLed.ts`/`timerLcd.ts`): pure module, no React/three imports, every decision unit-tested. Contents:
  - [x] `strikeLedVisual(dotIndex: 0 | 1, strikes: StrikeCount): { color; emissive; emissiveIntensity }` (shape mirrors `SolveLedVisual`) — DESIGN `componentSpec.strikeIndicator`, literal values: **inactive** = `#7A0000` (`--led-red-glow`) at opacity-0.25-equivalent intensity; **active** (`dotIndex < strikes`) = `#FF2E2E` (`--led-red`) with glow (12px-equivalent emissive). Return shared constant objects (both states are static — no per-frame branch, no scratch object needed; this is simpler than `moduleLed`'s animated case, don't copy its scratch-object machinery). At `strikes === 3` both dots are active (display floor — the 3rd strike is the explosion, Epic 8's event, not a 3rd dot).
  - [x] **Active state is red, not amber.** DESIGN's semantic-reservations line ("LED amber = strike-1 escalation cue") loses to the explicit `componentSpec.strikeIndicator.states.active: ledRed` and the mockup (both dots red). Specific spec over general reservation — same precedence ruling as 4.2/4.3. Note it in a comment.
  - [x] Geometry constants for the chassis-top placement (see Task 2): plate size/position, LED radius, gap. **LED size:** mockup `.strike-led` is 18px → ≈**0.075 world units** diameter via the 0.0042 wu/px overview conversion (document the math in a comment, same trace convention as the 10px solve LED and 84px timer digits).
  - [x] Unit tests `scenes/__tests__/strikeIndicator.test.ts`: dot states across `strikes` 0/1/2/3 for both dots (0→none active, 1→dot 0 only, 2→both, 3→both); returned objects are the shared constants (identity check — proves no allocation); **overlap test** for the plate footprint against `TIMER_HOUSING_FOOTPRINT` (from `timerLcd.ts`) and the indicator/battery zones from `computeChassisFeatureLayout` at the supported envelope (≤6 indicators / ≤8 batteries) — the 4.1–4.4 house standard: layout claims are tested, never eyeballed.

- [x] **Task 2 — `StrikeIndicator` component + placement (AC: 1)**
  - [x] New `scenes/StrikeIndicator.tsx`, mounted from `BombScene` (one new child beside `TimerLcd`). **Diegetic** — EXPERIENCE.md: "Strike indicator LEDs (on the chassis face)"; it orbits with the bomb, it is not a screen-space overlay.
  - [x] **Placement:** "adjacent right of timer" (EXPERIENCE HUD hierarchy #2; mockup `.right-cluster`). 4.4's completion notes reserved exactly this space: the timer housing is 1.1 wide centred at x = 0 — **the top-face band right of x ≈ 0.6 is free** (single-row feature envelope; the overlap test from Task 1 enforces it). Build a small graphite plate (`#1A1A1F`, matching the timer housing material) on the top face carrying the 2 LEDs in a horizontal row (mockup gap 9px ≈ 0.038wu), tilted to the same −0.18rad upward-forward angle as the timer's LCD plate so both read together at the overview pose ([0, 1.1, 5.2]). Keep the plate clear of the battery tray's worst-case single-row extent — verify against `computeChassisFeatureLayout` output in the test, not by eyeball.
  - [x] **`STRIKES` caption** below/beside the dots (mockup `.cap`: jetbrains-mono-700, ~9px ≈ 0.038wu cap height, letterspaced). Ink: use `#5A5560` (bay-tag convention), NOT the mockup's `#3A1410` — 4.4 ruled that ink illegible on graphite (documented deviation; same surface here). Existing vendored font — **zero new assets, zero new deps**.
  - [x] Optional flourish from the mockup: the faint `✕` glyph inside each dot (`rgba(255,46,46,.35)`). Take it or leave it — if taken, it's a static `<Text>` per dot, never animated.
  - [x] **State access:** strikes change at event rate, not tick rate — a reactive Zustand selector is correct here (`useGameStore((s) => s.bomb?.strikes ?? 0)`), the same pattern `TimerLcd` uses for its glow base. **No `useFrame` in this component** — there is nothing to animate (DESIGN's strikeIndicator spec has no motion; activation is an instant state change, which also satisfies reduced-motion for free). Memoize the component; materials swap via the visual-fn result on re-render.
  - [x] Render both dots data-driven from a 2-element index map — never two hardcoded JSX branches (project rule: geometry data-driven, no JSX repetition).

- [x] **Task 3 — Dev harness: the full strike path (AC: 1, 2)**
  - [x] No server emits `STRIKE` until Epic 8 — the harness must model it faithfully (4.3/4.4 precedent: real store actions, exact production path, never a parallel fake). Upgrade `DevBombHarness.tsx`'s **Shift+digit** from "struck pulse only" to the **complete strike experience**, exactly what the server will do (bombReducer roll-up + `STRIKE` broadcast):
    1. `applyModuleUpdate` struck→armed pulse (existing code — keep; this is the `MODULE_UPDATE` the server sends with the module reset to `armed`);
    2. then `setStrike({ teamId: 'A', strikes: min(current + 1, 3), timer: rebasedTimer })` — the rebased timer is a **fresh segment** at `speedMultiplier × 1.25` computed via `timerRemainingMs` (the segment-reset convention; the math already exists in the harness's S-key handler — reuse it, don't duplicate).
  - [x] **When `timer` is null** (no T pressed yet): `StrikePayload.timer` is required and non-null, and in production a strike can only happen mid-round with a running clock — so dispatch the full strike **only when a timer exists**; otherwise keep the 4.3 flash-only behaviour (document this guard in the header comment).
  - [x] **Remove the now-redundant S key** (its rebase math moves into the strike path) — two divergent "strike" paths in one harness is drift waiting to happen. Update the harness header comment: Shift+digit = full strike (flash + LED + timer escalation + glow step), T/P/U unchanged.
  - [x] Fixed constants only, no `Math.random()`; respect `isTextEntryTarget`; all through real store actions.

- [x] **Task 4 — Integration discipline, gates & verification (AC: 1, 2)**
  - [x] **Untouched:** `packages/shared`, `apps/server` (the roll-up is already correct — if you think it needs a change, you've misread the story), both stores, everything in `net/` (`STRIKE` already bound), `TimerLcd.tsx`/`timerLcd.ts` (the +20%/strike glow is already live and will step automatically when `setStrike` lands — that's the point), `moduleLed.ts`, `ModuleBay.tsx`, `chassis.ts`, `layout.ts`, camera/stage files, `App.tsx`. `BombScene.tsx`: mount `<StrikeIndicator />` + update the header comment (4.5 lands; 4.6 preparation view next).
  - [x] **AC2's "no modal" clause in code terms:** this story adds zero overlays, zero toasts, zero modals. The strike toast ("Strike. Don't do that again.") is a non-diegetic toast belonging to the toast system (mockup 7) — **out of scope**, note it for the epic that builds toasts. Grep yourself honest: no `Toast`/`Modal`/`overlay` strings in files this story creates.
  - [x] Memoization audit: a `TIMER_UPDATE` must not re-render `StrikeIndicator` (its only subscription is the strikes selector — primitive value, Zustand bails on equality); a `MODULE_UPDATE` must not re-render it either (same reason — `bomb` identity changes but the selected primitive doesn't).
  - [x] Gates: `pnpm -r exec tsc --noEmit` → 0 errors, no `@ts-ignore`; `pnpm --filter @bomb-squad/client build` → green; `pnpm -r test` → no regressions (baseline: shared 24 ✓, client 120 ✓, server 147 ✓).
  - [x] **Manual smoke (record honestly, check by check, in Completion Notes — house standard):** `/dev/bomb`, then: (a) idle: strike plate + 2 dim dots + `STRIKES` caption visible beside the timer at overview, nothing crowds indicators/batteries/timer from a normal orbit; (b) **T** then **Shift+1** → module LED flashes red 600ms AND dot 1 lights red AND the countdown visibly accelerates AND the LCD glow steps brighter — all four from one keypress, no modal, no overlay; (c) second **Shift+2** → dot 2 lights, speed compounds (×1.5625); (d) third **Shift+3** → both dots stay lit, count clamps, nothing explodes client-side (explosion is the server's, Epic 8); (e) **Shift+digit with no timer** → flash only, dots unchanged (guard works); (f) digit-toggle a module solved → solve LED green, strike dots unaffected; (g) `prefers-reduced-motion: reduce` → dots still swap state instantly (no animation to disable), module flash uses its static fallback (4.3 behaviour intact); (h) 4.1–4.4 regression: orbit/zoom/focus/ESC, cursor hide, serial/indicators/batteries/ports, timer T/P/U behaviours all intact (S is gone — expected); (i) several minutes running → no frame collapse (this component adds zero per-frame work — verify no new `useFrame` exists via grep).
  - [x] **Jay verifies interactively (required — story is not done until his observed result is recorded in Completion Notes):** real browser, run (b) and (c) — does a strike *land* as one coherent event (flash + dot + faster clock + brighter glow, no interruption)? Can he read the strike count at overview without zooming? Note: run the worktree dev server directly (`pnpm --filter @bomb-squad/client dev`) — worktrees lack compose env files.

### Review Findings

_Adversarial code review 2026-06-13 (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Result: 0 decision-needed, 0 patch, 2 defer, 7 dismissed. Both ACs confirmed met; no Critical/High/Medium issues._

- [x] [Review][Defer] STRIKE-before-`BOMB_INIT` shows the wrong dot floor [`apps/client/src/scenes/StrikeIndicator.tsx`] — if a `STRIKE` arrives before `BOMB_INIT`, `gameStore.setStrike` drops the count (keeps timer only, with a warn) and the `s.bomb?.strikes ?? 0` selector renders 0 dots while the server believes ≥1. Pre-existing store ordering guard; unreachable in the dev harness (`if (!module) return` guarantees a bomb). Defer to 8.4 (real server emitter / reconnect semantics).
- [x] [Review][Defer] Strike-housing overlap proven only at the single-row envelope [`apps/client/src/scenes/strikeIndicator.ts`, `__tests__/strikeIndicator.test.ts`] — the footprint tests assert clearance at `≤6` indicators / `≤8` batteries (the single-row corner), but not the two-row transition edge (9th battery / 7th indicator) where a second row consumes the band. The strike housing inherits the timer housing's z-band verbatim, so it extends the existing 8.2 two-row deferral; a range widening past the envelope must renegotiate both housings together (the overlap test fails loudly to catch it).

## Dev Notes

### What this story is — and is not

4.4 made the bomb legible under time pressure; this story makes **mistakes legible**: the shared strike count becomes a physical pair of LEDs beside the timer, and the whole strike experience (flash → dot → faster clock → brighter glow) fires as one server-driven event with no modal interruption. The roll-up itself (server reducer), the module flash (4.3), the strike→timer rebase (4.4's glow + speed plumbing), and the `STRIKE` event path (1.x) all exist — **this story is mostly a rendering story plus an honest end-to-end demonstration of an already-built chain.** Resist the urge to "improve" the chain.

**Out of scope (do not build):** strike toast "Strike. Don't do that again." (toast system, mockup 7 — flag in Completion Notes for the owning epic), strike SFX / klaxon (10.1), explosion at 3 strikes (8.4/8.5 — server authority), real server `STRIKE` emitter (8.4), preparation gating (4.6), optimistic render / 60fps profiling pass (4.7), per-player strike attribution (does not exist by design — strikes are team-wide, GDD). No server code, no shared-type changes, no new npm deps, no new fonts.

### The strike model — the chain you are rendering

- **Server truth:** `bombReducer.applyModuleResult` — a module reducer returning `status: 'struck'` is transient: the bomb reducer increments `strikes` (clamped `StrikeCount` 0|1|2|3), resets the module to `'armed'`, in one pure transition. Already tested.
- **Wire format:** `STRIKE` carries `StrikePayload { teamId, strikes, timer }` — strikes is the **absolute** new total; timer is the **rebased** fresh segment at the escalated multiplier (architecture Pattern 5: strike escalation rebases `startedAt`/`remainingAtStart` so the new rate never retro-applies). `MODULE_UPDATE` arrives separately with the module reset to `armed` — bomb-level changes are never bundled in it (payloads.ts doc comment).
- **Client store:** `setStrike({ strikes, timer })` updates `bomb.strikes` and `timer` together — one dispatch reaches the strike dots, the LCD glow base, and the countdown speed simultaneously. If `STRIKE` arrives before `BOMB_INIT` it warns and keeps the timer only (existing guard — don't touch).
- **Why 2 dots for a 0–3 count:** the third strike *is* the explosion (GDD win/loss: "the team accumulates 3 strikes" = round failure). The dots show survivable strikes (0–2); `strikes === 3` renders both lit as a display floor for the instant before the server's `BOMB_EXPLODED` arrives.
- **Escalation math (GDD, default 25% compounding):** ×1.00 → ×1.25 → ×1.5625. The harness models this; the real emitter is 8.4's.

### Current state of the code you're touching (all reviewed & done — read before editing)

- `apps/client/src/scenes/BombScene.tsx` — chassis + ribs + screws + `ChassisFeatures` + `ModuleBay` map + `TimerLcd` + `CameraRig`. Your diff: mount `<StrikeIndicator />`, header comment. Nothing else.
- `apps/client/src/scenes/timerLcd.ts` — exports `TIMER_HOUSING_SIZE` ([1.1, 0.55, 0.16]), `TIMER_HOUSING_FOOTPRINT` (x half-width 0.55, z ∈ [−0.16, 0]), `TIMER_HOUSING_CENTER_Z`, `TIMER_DIGIT_HEIGHT` (0.35, the 0.0042 wu/px conversion) — import the footprint for your overlap test; import nothing into it.
- `apps/client/src/scenes/TimerLcd.tsx` — already reads `bomb?.strikes` reactively for the glow base and tilts its LCD plate −0.18rad. Match the tilt; do not modify the file.
- `apps/client/src/scenes/chassis.ts` — `computeChassisFeatureLayout(...)` gives exact indicator/battery positions for the overlap test. Indicator zone back edge ≈ z = −0.18; battery tray single-row front extent ≈ z = +0.02 — but **test against the function's output, not these prose numbers**.
- `apps/client/src/scenes/DevBombHarness.tsx` — Shift+digit struck pulse + T/P/S/U timer keys; S-key holds the exact rebase math your strike path needs (snapshot remaining via `timerRemainingMs`, fresh segment, ×1.25). Move it, don't copy it.
- `apps/client/src/scenes/moduleLed.ts` / `ModuleBay.tsx` — the 600ms edge-triggered flash. AC2's flash clause is satisfied here already; your smoke verifies it still fires, your code never touches it.
- `apps/client/src/scenes/devBombState.ts` — `DEV_BOMB_STATE` ships `strikes: 0`. Unchanged.
- `apps/client/src/scenes/dom.ts` — `isTextEntryTarget()` / `prefersReducedMotion()` helpers. Reuse.

### Installed 3D stack (verified 4.1–4.4 — no version work)

`three 0.184.0` · `@react-three/fiber 8.18.0` · `@react-three/drei 9.122.0` · `camera-controls 2.10.1` · React 18.3. **Never upgrade React or jump to fiber@9/drei@10** (React-19-only). Fonts already vendored (`jetbrains-mono-700.ttf` for the caption). Zero new assets this story.

### Architecture & project-rule compliance (what review will judge)

- **Pure-fn + thin-component split** (`moduleLed.ts`/`timerLcd.ts` precedent) — review greps for this first. All visual decisions and geometry in `strikeIndicator.ts` with tests; `StrikeIndicator.tsx` applies them verbatim. If the component needs a logic test, logic has leaked.
- **Reactive vs `getState()`:** strikes are event-rate → reactive selector is the *correct* pattern (the same ruling CameraRig documents for click-rate focus). Do not add a `useFrame` to a component with nothing per-frame to do.
- **No per-frame allocations** — trivially satisfied by having no frame loop; keep it that way.
- **Colors are raw hexes with token names in comments** (CSS vars can't reach WebGL): led-red `#FF2E2E`, led-red-glow `#7A0000`, graphite `#1A1A1F`, caption ink `#5A5560` (bay-tag convention).
- **Data-driven geometry** — dots from an index map; plate constants in the pure module; overlap-tested.
- **Server-authoritative state:** the client never derives strikes (store doc comment, verbatim) — the dots render `bomb.strikes`, period. The harness increments only as a stand-in for the server's broadcast, through the real `setStrike`.
- **No modal (AC2, verbatim UX):** "module flashes red 600ms, strike LED activates, timer speed updates. No modal interruption" — EXPERIENCE.md's strike entry is this story's definition of done.

### UX requirements bound into the ACs

- **HUD glance hierarchy #2:** "Strike indicator — adjacent right of timer, 2 LED dots" (EXPERIENCE.md, verbatim). The timer stays the loudest element — the dots support it, never compete.
- **Diegetic:** "Strike indicator LEDs (on the chassis face)" — physical, describable in object language ("we're at one strike, the second light just came on").
- **componentSpec.strikeIndicator (DESIGN.md, literal):** layout "row of 2 LED dots beside the timer"; inactive `ledRedGlow` opacity 0.25; active `ledRed`, glow 0 0 12px.
- **Mockup anatomy** (`3. Defuser Bomb View.html` `.right-cluster`/`.strikes`): 18px dots, 9px gap, inset-shadowed sockets, faint `✕` glyph, `STRIKES` cap label — anatomy reference, not dimension authority (4.2/4.3/4.4 precedence ruling; the 0.0042 conversion is the bridge).
- **Second strike is silent** (microcopy note: the strike *toast* fires once; "second strike is silent because the timer speed-up speaks for itself") — toast is out of scope, but this confirms the dots + speed-up are the load-bearing strike-2 feedback. Get them right.
- **Reduced motion:** the a11y rule converts the *module flash* to instant states (4.3's job, done); the strike dots have no animation to disable — instant activation is already conformant.

### Previous story intelligence (4.4, reviewed clean 2026-06-12)

- **The handoff was explicit:** "the strike LEDs belong beside the timer (mockup right-cluster); the housing is 1.1 wide centred at x=0 — the top-face band right of x≈0.6 is free. The glow's +20%/strike base is already live (reads `bomb.strikes`) — 4.5 only adds the LED dots." Build exactly there.
- **Label-ink lesson:** mockup ink `#3A1410` is illegible on graphite — 4.4 deviated to `#5A5560` and documented it. Your caption sits on the same graphite; inherit the deviation, don't rediscover it.
- **Occlusion lesson:** 4.4's first smoke found the battery tray occluding content near the housing's bottom edge at overview — check your caption placement against the same sightline before declaring smoke (a) done.
- **Reviews walk boundary domains:** 4.1 count≥13, 4.2 battery 9–12, 4.3 flash 0/599/600ms, 4.4 0/9_999/10_000ms. Yours: strikes 0/1/2/3 per dot, the clamp at 3, the no-timer harness guard, plate↔housing/battery overlap at the envelope edges.
- **Numeric smoke beats eyeball smoke:** 4.4 caught an invisible glow plane only via pixel-mean measurement. The dot active/inactive delta is measurable the same way (headless Playwright + SwiftShader harness from `/tmp/pw-smoke` precedent) — but Jay's interactive check is additionally required.
- **Honest smoke notes:** record (a)–(i) individually; an earlier story's unexecuted smoke claim was caught by the auditor.
- **Keep diffs surgical:** 4.3 and 4.4 proved zero-diff outside `apps/client` is achievable for Epic 4 stories — repeat it. Expected diff: 3 new files + 2 modified.
- **Type narrowing recurs in review:** `strikes` is `StrikeCount` (0|1|2|3), `dotIndex` should be `0 | 1`, `teamId` is `'A' | 'B'` — type them precisely, not `number`/`string`.
- **Known deferrals you may observe but must not fix:** camera clips chassis ends at max zoom (4.7/10.2); stale focus index on remount (4.6/4.7); permanent-`struck` rendering (8.4); server-clock offset not reset on reconnect (8.4); two-row feature layouts vs top-band housings (8.2 — your overlap test extends this same envelope contract).

### Git intelligence

This worktree (`worktree-story-4-4-4-5`, baseline `4126960`, HEAD `2aa2ad0`) hosts 4.4 (done, reviewed clean) then 4.5 — implement here, not on master. Cadence: implement → adversarial review → patches folded → single story commit. Parallel worktrees exist for 5-1/5-2/8-3-8-4 — keep the surface area inside `apps/client/src/scenes/` to stay merge-clean (this story's expected diff does exactly that).

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Stack for this story:** React 18 + Three.js/R3F + Zustand + TypeScript only. No server, no sockets, no LiveKit, no new deps.
- **R3F (verbatim):** geometry data-driven, never hardcoded JSX; rendering-only components — zero game logic; tick-rate reads via `getState()` (n/a here — event-rate is reactive).
- **Don't-miss rules in play:** all game truth is server-owned — never derive strikes client-side (the harness *simulates the server*, it does not derive); NEVER `Math.random()`; no Postgres/Redis/socket writes anywhere near this story.
- **Performance:** 60fps budget; this story adds zero per-frame work — keep it that way; memoize; dispose via declarative JSX.
- **Build rules:** `tsc --noEmit` 0 errors, no `@ts-ignore`; naming — `StrikeIndicator` PascalCase component, `strikeLedVisual` camelCase, `strikeIndicator.ts` camelCase module.
- **Testing boundaries:** pure logic unit-tested in Node (all of Task 1); R3F components visual-only; no `Date.now()`/`setTimeout` in tests — time is an input (no time in this story's pure fns at all).

### Project Structure Notes

- New files: `apps/client/src/scenes/strikeIndicator.ts`, `apps/client/src/scenes/StrikeIndicator.tsx`, `apps/client/src/scenes/__tests__/strikeIndicator.test.ts`.
- Modified: `apps/client/src/scenes/BombScene.tsx` (StrikeIndicator mount + header comment), `apps/client/src/scenes/DevBombHarness.tsx` (Shift+digit full strike, S key removed, header comment).
- Untouched: `packages/shared`, `apps/server`, stores, `net/`, `App.tsx`, all timer/LED/chassis/layout/camera files.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 4.5: Strike Indicator & Strike Roll-Up] (ACs verbatim; Epic 4 objective; 4.6/4.7 boundaries)
- [Source: apps/server/src/reducers/bombReducer.ts#applyModuleResult] (the roll-up: struck→transient, strikes clamp at 3, module resets to armed — already built and tested, AC2's mechanism)
- [Source: packages/shared/src/events/payloads.ts#StrikePayload] (`{ teamId, strikes, timer }` — absolute total; bomb-level changes never bundled into MODULE_UPDATE)
- [Source: apps/client/src/store/gameStore.ts#setStrike] (one dispatch updates strikes + rebased timer together; pre-BOMB_INIT guard)
- [Source: apps/client/src/net/bindServerEvents.ts] (`STRIKE` → `setStrike` already bound — zero net/ diff this story)
- [Source: apps/client/src/scenes/timerLcd.ts#TIMER_HOUSING_FOOTPRINT, TIMER_DIGIT_HEIGHT] (free band right of x≈0.6; the 0.0042 wu/px conversion; −0.18rad plate tilt in TimerLcd.tsx)
- [Source: apps/client/src/scenes/moduleLed.ts + ModuleBay.tsx] (600ms edge-triggered flash — AC2's flash clause, done in 4.3)
- [Source: _agent_docs/game-architecture.md#Pattern 5 — Timer Authority] (strike escalation rebases the segment, compounding ×1.00/×1.25/×1.5625)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#componentSpec.strikeIndicator, colors.hud, semantic reservations] (2 LED dots beside timer; inactive ledRedGlow 0.25 / active ledRed glow 12px; red-over-amber precedence)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#HUD information hierarchy / HUD & Diegetic UI / Empty, loading, error states / Microcopy / Accessibility] (strike indicator = glance priority #2, adjacent right of timer; diegetic on chassis; "module flashes red 600ms, strike LED activates, timer speed updates. No modal interruption"; strike toast out of scope; second strike silent)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/3. Defuser Bomb View.html#.strikes/.strike-led/.cap] (18px dots, 9px gap, ✕ glyph, STRIKES caption — anatomy reference, not dimension authority)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#Win/Loss Conditions + Strike escalation] (3 strikes = explosion → only 2 survivable strikes displayed; default 25% compounding escalation)
- [Source: _agent_docs/implementation-artifacts/4-4-diegetic-timer-lcd-with-client-extrapolation.md#Completion Notes] (the 4.5 handoff: free band, glow already live; label-ink + occlusion lessons; numeric smoke methodology)
- [Source: _agent_docs/project-context.md#Critical Implementation Rules, Performance Rules, Testing Rules] (server-owned truth; R3F discipline; pure-fn testing boundaries)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- Red→green TDD: `strikeIndicator.test.ts` (11 tests) written first and confirmed failing (module absent, baseline 120 client tests green), then implemented → all green.
- Gates after implementation: `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm --filter @bomb-squad/client build` → green (pre-existing three.js chunk-size note only); `pnpm -r test` → shared 24 ✓, client 131 ✓ (120 baseline + 11 new), server 147 ✓ — no regressions.
- Headless smoke (playwright-core chromium + SwiftShader against `vite --port 5199`, 1920×1080, `/tmp/pw-smoke` harness reused from 4.2–4.4, server stopped after), screenshot inspection + numeric pixel analysis (pngjs red-channel means over each 24×24px dot region) — results in Completion Notes.
- Hygiene greps: no `useFrame` in either new file (one comment explaining its deliberate absence); no `Toast`/`Modal`/`overlay`/`EXPLOD`/`emit` strings in files this story creates.

### Completion Notes List

- **Task 0 — chain audit:** confirmed before writing code: `bombReducer.applyModuleResult` roll-up (strikes clamp at 3, struck→armed reset) already built + tested server-side; module 600ms flash already built (4.3, `moduleLed.ts`/`ModuleBay.tsx`); `setStrike` + `STRIKE` binding already live. AC2's mechanism needed zero new code — this story renders it and proves it end-to-end. Zero diffs to `packages/shared`, `apps/server`, stores, or `net/`.
- **Task 1 — pure module:** `scenes/strikeIndicator.ts` — `strikeLedVisual(dotIndex, strikes)` returning two shared static constants (inactive `#7A0000` @ 0.25, active `#FF2E2E` @ 1.5; identity-tested — zero allocation; red-over-amber precedence documented in a comment), `STRIKE_DOT_INDICES`, housing geometry (`STRIKE_HOUSING_SIZE` [0.36, 0.55, 0.16] at x = 0.82 — a graphite sibling of the timer housing in the same z-band, 0.09 gap right of it), `STRIKE_LED_RADIUS` 0.0375 (mockup 18px via the 0.0042 wu/px conversion, math in comment), gap 0.038. 11 tests: dot states 0/1/2/3 per dot, clamp-at-3 display floor, shared-constant identity, row-fits-face, footprint on-face + rib clearance, x-clear of the timer housing, z-band containment, and direct indicator/battery clearance at the single-row envelope (≤6/≤8) via `computeChassisFeatureLayout`.
- **Task 2 — component:** `scenes/StrikeIndicator.tsx`, one new child in `BombScene` beside `TimerLcd`. Same tilt (−0.18rad) and seating math as the timer housing — the pair reads as one instrument cluster. Sole store subscription is the `bomb?.strikes ?? 0` primitive selector (equality-bailed — MODULE_UPDATE/TIMER_UPDATE never re-render it); **no `useFrame`** (nothing animates; instant state swap satisfies reduced-motion for free). Dots data-driven from `STRIKE_DOT_INDICES` with recessed near-black sockets; `STRIKES` caption in jetbrains-mono-700 @ 0.038wu, ink `#5A5560` (4.4's graphite-label ruling inherited).
- **Deviation (documented in code):** caption rides ABOVE the dots, not below per the mockup — same battery-tray occlusion reasoning as 4.4's `T — MINUS` nameplate (measured there, inherited here). The mockup's faint `✕` glyph inside each dot was dropped: glyph-coverage gamble in the vendored mono font for a decorative detail.
- **Task 3 — harness:** Shift+digit upgraded to the full strike — (1) existing struck→armed pulse (the MODULE_UPDATE the server will send), then (2) `setStrike({ teamId: 'A', strikes: min(+1, 3), timer: fresh segment × 1.25 })` — the server's two broadcasts in order, through the real store actions. Guard: with no running timer the pulse fires alone (production strikes only exist mid-round; `StrikePayload.timer` is non-null). The 4.4-era S key removed — its rebase math moved into the strike path; header comment rewritten. Fixed constants, no `Math.random()`, `isTextEntryTarget` respected.
- **Task 4 — headless smoke (executed 2026-06-12/13, screenshots + pixel measurements inspected):** (a) idle: strike plate + 2 dim dots + `STRIKES` caption beside the timer at overview, nothing crowds indicators/batteries/timer ✓; (e-first) Shift+1 with NO timer → module flash fires, dots numerically unchanged (49.3 = idle baseline) ✓ guard works; (b) T → P (frozen digits for clean diffs) → Shift+1: one keypress produced module-LED flash peak (mid-flash shot), dot 1 lit, and the rebased (still-paused) timer — dot red-mean 49.3 → 128.7, dot 2 unchanged ✓; (c) Shift+2 → dot 2 lit (129.0) ✓; (d) Shift+3 → both dots unchanged-lit, count clamped, timer still frozen, nothing exploded, zero new console errors ✓; speed: after resume, 4:59 → 4:54 (~5 displayed seconds) across 2.167s wall — consistent with the compounded multiplier after three rebases (×1.95) ✓; (f) digit-4 solve toggle → green solve LED, strike dots untouched ✓; (g) `prefers-reduced-motion: reduce` → identical dot means (instant state swaps, no animation to disable) ✓; (h) regression: bay click → focus dolly ✓, ESC → overview with timer running + dots intact ✓, orbit shows back face cleanly ✓; (i) zero per-frame work added (no new `useFrame` — verified by grep, not just intent) ✓. Only console error across the run: the known pre-existing favicon 404.
- **Harness fidelity fix from Jay's verification:** he observed that repeated Shift+digit kept compounding the timer speed indefinitely — the original guard clamped the *count* at 3 but still rebased the timer on every press, a broadcast sequence no real server can produce (at 3 strikes the server explodes, it never emits another STRIKE). Fixed: the strike path now goes quiet at `bomb.strikes === 3` (flash only, no setStrike, no escalation). Gates re-run green after the fix (tsc 0 errors, client 131 ✓).
- **Note for the toast epic:** the strike toast ("Strike. Don't do that again." — first strike only) remains unbuilt; no toast system exists yet. This story adds zero overlays/modals (AC2's "no modal" clause verified by grep + smoke).
- **Jay verified interactively (2026-06-13):** ran the worktree dev server and confirmed the strike experience works as described — flash + dot + faster clock + brighter glow land as one coherent event, strike count readable. His words: "confirmed as you described." Two observations from his session: (1) repeated Shift+1 increased clock speed continuously — a harness fidelity bug, fixed this session (see above); (2) the red glow on the clock decreases the readability of the counter as strikes accumulate — a 4.4 TimerLcd / DESIGN.md spec concern outside 4.5's scope, logged in `deferred-work.md` for the UX/polish pass. Human-verification AC satisfied.

### File List

- apps/client/src/scenes/strikeIndicator.ts (created — pure dot visuals + housing geometry with 18px→wu conversion)
- apps/client/src/scenes/__tests__/strikeIndicator.test.ts (created — 11 tests incl. footprint overlap vs timer housing + chassis features)
- apps/client/src/scenes/StrikeIndicator.tsx (created — graphite plate, 2 socketed LED dots, STRIKES caption; reactive-only, no useFrame)
- apps/client/src/scenes/BombScene.tsx (modified — StrikeIndicator mount + header comment; nothing else)
- apps/client/src/scenes/DevBombHarness.tsx (modified — Shift+digit full strike via setStrike with rebased ×1.25 segment, no-timer guard, S key removed, header comment)
- _agent_docs/implementation-artifacts/sprint-status.yaml (modified — story status tracking)
- _agent_docs/implementation-artifacts/deferred-work.md (modified — timer-glow readability observation logged for the UX/polish pass)

## Change Log

- 2026-06-13: Story 4.5 implemented — diegetic strike indicator (2 LED dots on a graphite plate beside the timer housing, same tilt/band, dim `#7A0000`/lit `#FF2E2E` per DESIGN componentSpec) rendering `bomb.strikes` verbatim via a reactive primitive selector (no useFrame, zero per-frame work). Dev harness Shift+digit now models the server's full strike (MODULE_UPDATE pulse + STRIKE with rebased ×1.25 segment, clamped at 3, mid-round guard); S key folded in. Roll-up chain (bombReducer, 600ms flash, setStrike, STRIKE binding) confirmed pre-existing — zero server/shared/store/net diffs. Typecheck/build/suite green (24/131/147); headless smoke with numeric dot-region pixel verification passes all checks. Jay verified interactively (coherent strike event, readable count); his session surfaced a harness fidelity bug (speed kept compounding past 3 strikes — fixed: strike path goes quiet at the clamp) and a timer-glow readability concern (4.4/DESIGN scope — logged in deferred-work.md). Story → review.
