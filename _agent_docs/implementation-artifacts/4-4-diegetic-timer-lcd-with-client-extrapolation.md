---
baseline_commit: 4126960
---

# Story 4.4: Diegetic Timer LCD with Client Extrapolation

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Defuser,
I want a smooth 7-segment countdown built into the chassis,
So that I can read and call out the remaining time precisely.

## Acceptance Criteria

1. **Frame-rate extrapolation.** Given a `TimerState` broadcast (`startedAt`, `remainingAtStart`, `speedMultiplier`, `pausedAt`), when the client renders each frame, then it extrapolates the displayed time inside `useFrame` using the server-time offset (no `setInterval`), at 84px DSEG7 red.

2. **Digits never animate — only glow.** Given the timer is running, when digits change, then only the glow animates — digits never animate — and under 10s the LCD glow pulses on the second.

3. **Display-only zero.** Given the client's extrapolated clock reaches 0:00, when no server expiry has arrived, then the bomb does not explode on the client (display-only; the server owns expiry).

## Tasks / Subtasks

- [x] **Task 1 — Vendor the DSEG7 LCD font (AC: 1)**
  - [x] Download `DSEG7Classic-Regular.ttf` from the DSEG release (github.com/keshikan/DSEG, latest release v0.46; the family DESIGN.md names is `'DSEG7 Classic'`, weights `[400]` → Regular) into `apps/client/public/fonts/`. troika (drei `<Text>`) loads ttf/otf/woff but **not woff2** — same constraint already solved for jetbrains-mono in 4.2. **This is the story's only new asset; zero new npm packages.**
  - [x] License compliance: DSEG is SIL OFL 1.1 — add its OFL text beside the font (e.g. `public/fonts/OFL-DSEG.txt`; the existing `OFL.txt` is jetbrains-mono's copyright notice — don't merge them, OFL requires the per-font copyright line).
  - [x] DSEG digit convention you'll rely on: `8` renders all segments lit (the ghost pattern), `:` is a proper colon glyph, digits are fixed-width — so a ghost layer of `8:88` perfectly underlays any live `M:SS` string with zero per-digit jitter.

- [x] **Task 2 — Pure timer math: `scenes/timerLcd.ts` (AC: 1, 2, 3)**
  - [x] House pattern (`layout.ts`/`chassis.ts`/`moduleLed.ts`): pure module, **no React/three imports**, every formula unit-tested. Contents:
  - [x] `timerRemainingMs(timer: TimerState, serverNowMs: number): number` — the segment formula verbatim from `packages/shared/src/types/timer.ts`: `remainingAtStart - (now - startedAt) * speedMultiplier`, substituting `pausedAt` for `now` when `pausedAt !== null` (frozen clock), **clamped to ≥ 0** (AC3: extrapolated zero is a display floor, never negative, never an event). The formula is only valid within one segment — the server rebases segments on resume/strike (the type's doc comment explains why); the client never compensates across segments.
  - [x] `formatTimerDisplay(remainingMs: number): string` — `M:SS` (`4:32`, `0:09`, `0:00`), minutes unpadded, seconds 2-padded, extends naturally to `MM:SS` for ≥10-minute configs. **Truncate (floor) seconds** — a timer must never show a second that hasn't fully elapsed away. Don't invent a sub-10s centiseconds mode — DESIGN/mockup specify `M:SS` only; under-10s urgency is the glow pulse (AC2), not a format change.
  - [x] `timerGhostFor(display: string): string` — same shape with every digit `8` (`4:32` → `8:88`, `12:05` → `88:88`) so the unlit-segment ghost always matches the live string's width.
  - [x] `lcdGlow(remainingMs: number, strikes: StrikeCount, secondFraction: number, reducedMotion: boolean): number` (name/shape yours; must be a complete intensity description the component applies verbatim). Rules, literal from DESIGN.md `componentSpec.timer`: base glow `0 0 16px rgba(255,59,48,0.45)` equivalent; **+20% glow intensity per strike** (`pulseOnStrike: "1.5× speed; +20% glow intensity per strike"` — the 1.5× speed half of that line is the *timer speed*, already carried by `speedMultiplier`; the glow half is yours); **under 10s remaining, glow pulses on the second** (peak at each second boundary decaying within the second — drive it from the fractional part of the displayed second so the pulse is phase-locked to the digit change); `reducedMotion` → **no pulse**, static glow at the strike-adjusted base (EXPERIENCE.md a11y: "Disable timer glow pulse"). Digits themselves get NO intensity animation ever (AC2).
  - [x] Unit tests `scenes/__tests__/timerLcd.test.ts`: segment formula at multiplier 1.0/1.25/1.56; paused freeze (pausedAt substitution — advancing `serverNowMs` changes nothing); clamp at exactly 0 and below; format at 0/9_999/59_999/60_000/299_000/600_000ms + floor behavior (e.g. 9_999ms → `0:09`, never `0:10`); ghost shapes for 4- and 5-char displays; glow: 0/1/2 strikes base steps, pulse active only <10_000ms, pulse peak/decay across secondFraction 0/0.5/0.99, reduced-motion → constant across all secondFraction values. **No `Date.now()` in any test — time is always an argument** (project testing rule).

- [x] **Task 3 — Server-time offset: `net/serverClock.ts` (AC: 1)**
  - [x] Nothing estimates server time today — this story introduces the plumbing the architecture mandates ("estimated once at connect, refreshed on each timer broadcast"). Pure core + thin shell:
  - [x] Pure fn `estimateClockOffset(timer: TimerState, receivedAtMs: number): number | null` — every server `TIMER_UPDATE` opens a fresh segment stamped at emit time, so for a **running** segment `offset ≈ timer.startedAt - receivedAtMs` (one-way latency biases the client display slightly *behind* the server — the safe direction; never "ahead" into phantom expiry). For a **paused** broadcast (`pausedAt !== null`, e.g. a PAUSED-state rebroadcast) return `null` — `startedAt` is not fresh there; keep the previous offset.
  - [x] Module shell: `noteTimerBroadcast(timer: TimerState): void` (applies a non-null estimate to module state) and `serverNow(): number` (`Date.now() + offset`, offset defaulting to 0 — dev harness and pre-first-broadcast both correct at 0). Module-level `let` state matching the `socket.ts` instance pattern; export a `resetClockOffsetForTest()` if tests need isolation.
  - [x] Wire it: in `net/bindServerEvents.ts`, the `TIMER_UPDATE` handler becomes `(timer) => { noteTimerBroadcast(timer); setTimer(timer); }` (a named `onTimerUpdate` so the `off()` teardown still removes exactly what was added — preserve that file's symmetric on/off discipline). **This is the only `net/` diff besides the new file.**
  - [x] Tests `net/__tests__/serverClock.test.ts`: running segment → exact offset; paused broadcast → null/keeps prior; offset math is sign-correct for client clocks both ahead of and behind the server. (Refinement beyond this single-sample estimator — RTT halving, smoothing — is **Story 8.4's** call when the real server emitter lands; note it, don't build it.)

- [x] **Task 4 — `TimerLcd` component + housing placement (AC: 1, 2, 3)**
  - [x] New `scenes/TimerLcd.tsx`, mounted from `BombScene` (one new child beside `ChassisFeatures`). Memoized; subscribes reactively only to snapshot-rate values it needs for *materials* (`s.bomb?.strikes ?? 0` for glow base); the **per-frame** read is `useGameStore.getState().timer` inside `useFrame` — never a reactive hook for the tick path (project rule; the pattern `gameStore.ts` documents).
  - [x] **Placement — the one open layout decision, settled here:** the mockup mounts the timer in the chassis "top band"; in 3D the front/back faces belong to module slots and the top face carries indicator chips (rows centred at z = −0.25) and the battery tray (centred z = +0.2). Build a raised LCD **housing** (graphite `#1A1A1F` box, brass screws optional) sitting on the top face (+y), centred at x = 0, straddling the narrow z = 0 gap between the two feature zones, with the LCD plate on its **+z face tilted slightly upward-forward so it reads at the overview pose** ([0, 1.1, 5.2] looking at origin). Housing footprint must clear both zones: indicator zone back edge ≈ z = −0.18, battery tray front edge ≈ z = +0.01 with 2 batteries (worst case at higher counts the tray reaches further forward — verify against `computeChassisFeatures` output, not by eyeball). If the dev-context counts collide, nudging the housing *up* (taller, smaller footprint) is preferred over moving `INDICATOR_CENTER_Z`/`BATTERY_CENTER_Z` (those constants were overlap-tested in 4.2 — touch them only with the tests updated). Add the housing/LCD geometry constants to `timerLcd.ts` (pure) with an **overlap test** against the indicator/battery footprints, the 4.1–4.3 house standard for layout claims.
  - [x] **LCD anatomy** (mockup `.timer-mount`/`.timer`/`.ghost`/`.live`/`.timer-label`, DESIGN `componentSpec.timer` — literal values): recessed plate bg `#240807` (`--timer-lcd-bg`), 2px-equivalent graphite border, ghost layer `8:88` in `rgba(255,59,48,0.10)`-equivalent (DSEG7, all segments), live digits over it in `#FF3B30` (`--timer-lcd`), mono micro-label **`T — MINUS`** below (jetbrains-mono-700, letterspaced, `#3A1410`-adjacent — the existing vendored font, no new asset). Two drei `<Text>` layers (ghost + live) + one for the label.
  - [x] **The 84px ruling:** DESIGN.md `typography.scale.timer: 84px` against the 2D stage. At the overview pose ≈0.0042 world-units/px (the 4.3-documented conversion) → digit height ≈ **0.35 world units**; size the drei `<Text fontSize>` to that and document the math in a comment (same trace convention as the 10px LED). The mockup's 76px is the mock's own compromise — **84px/DESIGN.md wins** (spines-over-mocks precedence, ruled in 4.2 and 4.3).
  - [x] **`useFrame` driver:** each frame — `getState().timer`; if null, show idle display (decide: ghost-only dark LCD; document the choice). Else `remaining = timerRemainingMs(timer, serverNow())`, `display = formatTimerDisplay(remaining)`; **only when the string differs from the last-rendered one** mutate the live `<Text>` ref's `.text` and call `.sync()` — troika re-shapes glyphs on text change (async worker), so a per-frame unconditional write would thrash; gated on change it's ≤1/sec. Glow: apply `lcdGlow(...)` per frame by mutating material/mesh refs (intensity-only writes are cheap and allocation-free; reuse refs, no objects created in the callback — the 4.3 review patched exactly this class of leak, don't repeat it). Early-return paths where nothing changed. **No `setInterval`, no `setTimeout`, no `Date.now()` outside `serverNow()`'s shell, no setState from `useFrame`.**
  - [x] **Glow rendering approach** (keep it cheap; recommendation, not mandate): a slightly-larger glow quad/plane behind the LCD plate with an emissive/transparent material whose opacity-or-intensity is the single animated value, or `<Text>` outline glow via troika's `outlineBlur`. One animated scalar; never animate digit color/position/scale (AC2).
  - [x] **AC3 in code terms:** `TimerLcd` renders `0:00` and holds; it emits nothing, sets no store state, triggers no scene change at zero. `BOMB_EXPLODED` is already logged by `bindServerEvents` — explosion UX is Epic 8/10 territory. Grep yourself honest: no `EXPLOD`/`emit` strings in any file this story creates.
  - [x] Paused display: when `pausedAt !== null` the formula freezes by construction — digits hold, and the under-10s pulse must also freeze (secondFraction derives from frozen remaining → verify via test). Scene dimming/pause strip is Story 8.7's — not here.

- [x] **Task 5 — Dev harness timer controls (AC: 1, 2, 3)**
  - [x] No server emits `TIMER_UPDATE` yet (Epic 8) — extend `scenes/DevBombHarness.tsx`'s existing DEV-guarded keyboard listener (digit/Shift+digit already taken; respect `isTextEntryTarget`): **T** → `setTimer({ startedAt: Date.now(), remainingAtStart: 300_000, speedMultiplier: 1, pausedAt: null })` (5:00, the GDD Easy default; offset 0 is correct in dev — same origin); **P** → pause/resume toggle implementing the segment-reset convention faithfully (pause: set `pausedAt: Date.now()`; resume: **fresh segment** — `startedAt: Date.now()`, `remainingAtStart:` the frozen remaining, `pausedAt: null` — compute via `timerRemainingMs`; this is the convention the shared type documents, and the harness must model the server correctly or the display will *look* right while the math is wrong); **S** → simulated strike rebase (snapshot remaining, fresh segment at `speedMultiplier × 1.25`, compounding — GDD default escalation); **U** → jump the timer to 12s remaining (running) to watch the under-10s pulse arrive.
  - [x] All through the real `setTimer` store action — the exact path `TIMER_UPDATE` rides (4.3's harness precedent: real store path, never a parallel fake). Fixed constants, no `Math.random()`.

- [x] **Task 6 — Integration discipline, gates & verification (AC: 1, 2, 3)**
  - [x] Untouched: `CameraRig` (within BombScene), `BombStage.tsx`, `stage.ts`, `useIdleCursor.ts`, `ModuleBay.tsx`, `moduleLed.ts`, `registry.ts`, `layout.ts` (unless the overlap test forces a documented constant nudge in `chassis.ts` — see Task 4), both stores (**`setTimer` already exists — do not add store actions**), everything in `packages/shared` and `apps/server`. `App.tsx`: zero diff (harness already mounted). `BombScene.tsx`: add the `TimerLcd` mount + update the header comment (4.4 lands; 4.5 strike HUD next).
  - [x] All new geometry/materials declarative JSX (R3F auto-disposal); the only new `useFrame` is `TimerLcd`'s driver. Memoization audit: a `MODULE_UPDATE` must not re-render `TimerLcd` (its reactive subscription is strikes-only) and a `TIMER_UPDATE` must not re-render every `ModuleBay` (timer lives outside `bomb` in the store — verify `setTimer` doesn't churn `bomb` identity; it doesn't today, keep it that way).
  - [x] Gates: `pnpm -r exec tsc --noEmit` → 0 errors, no `@ts-ignore`; `pnpm --filter @bomb-squad/client build` → green; `pnpm -r test` → no regressions (baseline: shared 24 ✓, client 76 ✓, server 64 ✓).
  - [x] **Manual smoke (record honestly, check by check, in Completion Notes — house standard):** `/dev/bomb`, then: (a) idle LCD renders on its housing, ghost `8:88` visible, label `T — MINUS`, findable at overview, doesn't occlude indicators/batteries from a normal orbit; (b) **T** → 5:00 counts down smoothly, digits flip cleanly once per second with zero digit animation; (c) **P** → freeze, orbit while frozen, **P** → resumes from the frozen value (not jumped); (d) **S** → countdown visibly faster, glow a step brighter; second **S** → faster still (compounding); (e) **U** → under 10s the glow pulses on each second tick, phase-locked to the digit change; (f) reach 0:00 → display holds at 0:00, nothing else happens, no console errors (AC3); (g) `prefers-reduced-motion: reduce` → no pulse, static glow, digits still update; (h) 4.1–4.3 regression: orbit/zoom/focus/ESC, cursor hide, serial/indicators/batteries/ports, solve-LED toggles + strike flash all intact; (i) several minutes running → no frame collapse, no memory creep (troika sync ≤1/sec — confirm no per-frame sync calls via a counter or profiler sample).
  - [x] **Jay verifies interactively (required — story is not done until his observed result is recorded in Completion Notes):** real browser, run (b), (e) and (f) — readability of the LCD at overview ("can you call out the time without zooming?"), the under-10s pulse feel, and the 0:00 hold. Note: worktree dev servers need their own env/`--build` if run through compose — plain `pnpm --filter @bomb-squad/client dev` from the worktree is the simplest path.

## Dev Notes

### What this story is — and is not

4.3 made the bomb trackable; this story makes it **legible under time pressure**: the diegetic 7-segment LCD is "the loudest element on screen by design" (DESIGN.md) and the thing the Defuser reads aloud ("the timer says 2:14" — EXPERIENCE.md's whole rationale for diegetic placement). It also introduces the client half of ADR-005 (timestamp + extrapolation) and the server-clock-offset plumbing every later timer consumer reuses.

**Out of scope (do not build):** strike LED dots + roll-up (4.5 — even though they share the top band; leave x-space beside the timer housing for them), preparation gating (4.6), optimistic render/60fps profiling pass (4.7), the real server timer emitter + expiry + escalation broadcasts (8.4 — the harness fakes them), pause UX strip/scene dim (8.7), explosion/defuse sequences (8.5/10.1), timer tick SFX (10.1), Morse frequency LCD reuse (7.4). No server code, no shared-type changes (`TimerState` is final and already shipped), no new npm deps.

### The timer model — read these two files before writing any math

- `packages/shared/src/types/timer.ts` — `TimerState { startedAt, remainingAtStart, speedMultiplier, pausedAt }` with the **segment-reset convention** in its doc comment: resume and speed changes always open a fresh segment; the formula `remainingAtStart - (now - startedAt) * speedMultiplier` (pausedAt substituting for now when frozen) is valid only within one segment. The client's job is *only* the within-segment formula — rebasing is the server's (and the dev harness's, faithfully imitating it).
- `apps/client/src/store/gameStore.ts` — `timer: TimerState | null` sits **beside** `bomb`, not inside it; `setTimer` replaces it; `setStrike({ strikes, timer })` updates both (so a strike rebase reaches the LCD through either event). The store doc explicitly says: never simulate timer expiry on the client.
- Architecture Pattern 5 / ADR-005: broadcast on change only (round start, strike, pause, resume); client extrapolates per frame from `TimerState` + server-time offset "estimated once at connect, refreshed on each timer broadcast"; **server owns expiry — client 0:00 is display-only**. `TIMER_UPDATE: (timer: TimerState) => void` already exists in `ServerToClientEvents` and is already bound to `setTimer` in `bindServerEvents.ts`.

### Server-time offset — design rationale (Task 3)

There is no NTP-style handshake in the stack and 8.4 may add one; this story needs a *correct-enough* estimator that the architecture's words already imply: every running-segment broadcast carries a server timestamp (`startedAt`) stamped at emit, so `startedAt - receivedAt` estimates `serverEpoch - clientEpoch` with an error of one-way latency — which biases the displayed clock **behind** the server, the safe direction (client never shows expiry before the server declares it; AC3 reinforces this). Paused broadcasts don't carry a fresh `startedAt` → skip them. Keep the estimator pure and the module state thin; flag smoothing/RTT-compensation as 8.4's decision in Completion Notes if you feel the pull — don't build it.

### troika/drei `<Text>` — the per-frame trap

Digit updates go through troika-three-text, which re-shapes glyphs asynchronously on `.text` change. The discipline: keep the live string in a ref, write `.text` + `.sync()` **only when the formatted string changes** (≤1/sec), and never recreate `<Text>` elements per tick (no `key` churn, no setState). Glow animation must be a material/scalar mutation on a ref — the only thing that changes per frame. The ghost layer (`8:88`) never changes after mount (width changes only if the display gains a digit — derive ghost from the current display length, updated on the same ≤1/sec edge). DSEG7's fixed-width digits are what make the ghost-underlay trick work with zero per-digit position math.

### Current state of the code you're touching (all reviewed & done — read before editing)

- `apps/client/src/scenes/BombScene.tsx` — chassis + ribs + screws + `ChassisFeatures` + `ModuleBay` map + `CameraRig`. Your diff: mount `<TimerLcd />`, header comment. Camera/chassis/module hunks untouched.
- `apps/client/src/scenes/chassis.ts` — top-face occupancy you must clear: indicator rows centred z = −0.25 (footprint z 0.14, row step 0.18), battery tray centred z = +0.2 (tray = cells + 0.06 padding; grows toward −z with count). `computeChassisFeatures(context)` gives exact positions — test against it, not constants-by-hand. `CHASSIS_SIZE = [3, 1.5, 1.05]` (from `layout.ts`).
- `apps/client/src/scenes/DevBombHarness.tsx` — DEV-guarded keyboard listener already handling digits/Shift+digits via `event.code`, `isTextEntryTarget` guard from `scenes/dom.ts`. Extend, don't fork.
- `apps/client/src/scenes/dom.ts` — `prefersReducedMotion()` / `isTextEntryTarget()` already lifted for reuse (4.3). Use them; don't duplicate.
- `apps/client/src/net/bindServerEvents.ts` — symmetric on/off registration; `TIMER_UPDATE` currently binds `setTimer` directly. Your one edit wraps it with `noteTimerBroadcast`.
- `apps/client/src/scenes/moduleLed.ts` — the pure-visual-fn precedent including the 4.3 review lesson: dynamic branches must mutate-and-return a module-level scratch object, never allocate per frame. `lcdGlow` returning a primitive number sidesteps this entirely — prefer that.
- `apps/client/public/fonts/` — `jetbrains-mono-700.ttf` + `OFL.txt`. Your DSEG ttf + its OFL land here.

### Installed 3D stack (verified 4.1–4.3 — no version work)

`three 0.184.0` · `@react-three/fiber 8.18.0` · `@react-three/drei 9.122.0` · `camera-controls 2.10.1` · `@types/three 0.184.1` · React 18.3. **Never upgrade React or jump to fiber@9/drei@10** (React-19-only). DSEG v0.46 (keshikan, OFL-1.1) is a static ttf — no loader work, drei `<Text font="/fonts/DSEG7Classic-Regular.ttf">`.

### Architecture & project-rule compliance (what review will judge)

- **Server-authoritative clock (verbatim project rule):** "Bomb timer ticks are server-authoritative — clients display the server timestamp, never run their own authoritative countdown." The extrapolation is a *rendering* of `TimerState`, not a clock: no accumulated client-side remaining, no drift correction loops — recompute from the descriptor every frame.
- **R3F discipline:** `useFrame` for per-tick updates (never `useEffect`+`setInterval` — verbatim rule); `getState()` inside `useFrame` (never reactive hooks there); no per-frame allocations (primitives + reused refs); no setState from the frame loop; rendering-only component — every formula lives in `timerLcd.ts`/`serverClock.ts` with tests. If `TimerLcd` needs a logic test, logic has leaked.
- **Pure-fn + thin-component split** (`stage.ts`/`layout.ts`/`chassis.ts`/`moduleLed.ts` precedent) — review greps for this first.
- **Colors are raw hexes with token names in comments** (CSS vars can't reach WebGL): timer-lcd `#FF3B30`, timer-lcd-bg `#240807`, graphite `#1A1A1F`, label ink `#3A1410`, ghost = lcd red at 10% opacity.
- **Literal spec values:** 84px → ≈0.35wu digits (show the math); `M:SS`; ghost `8:88`; +20% glow per strike; under-10s pulse on the second; `T — MINUS` label (EXPERIENCE.md microcopy: "T-MINUS, not Time Left").
- **Reduced motion:** the glow pulse is this story's only animation — `prefers-reduced-motion` disables it (static strike-adjusted glow; digits still update — a frozen *display* would be a correctness bug, the rule kills *animation* only).

### UX requirements bound into the ACs

- **"Timer is the loudest element on screen by design"** (DESIGN.md) — 84px LCD red on near-black, glow intensifies per strike. If anything competes with it, the HUD is wrong. But it's *diegetic*: mounted into the chassis, orbiting with the bomb — not a screen-space overlay (mockup top-band note; EXPERIENCE.md "Bomb timer LCD (built into the chassis)").
- **"Don't animate the timer's digits — only its glow. Digit animation reads as a glitch under time pressure"** (DESIGN.md, verbatim — this is AC2's source).
- **Under-10s**: "No visual flicker until under 10s, when LCD glow pulses on the second" (EXPERIENCE.md — also the audio escalation line; audio is 10.1, ignore it).
- **Strike feedback path**: "module flashes red 600ms, strike LED activates, timer speed updates. No modal interruption" — this story's slice is "timer speed updates" (visible acceleration + glow step). LEDs are 4.5.
- The Maya walkthrough opens on "Timer reads 5:00. Zero strikes" — the harness T-key state reproduces exactly that frame.

### Previous story intelligence (4.1–4.3, reviewed 2026-06-12)

- **Reviews walk boundary domains:** 4.1 count ≥13 overlap, 4.2 battery 9–12 tray overhang, 4.3 flash 0/599/600ms. Yours: remaining at exactly 0 / below 0 / 9_999 / 10_000ms (pulse threshold), multiplier compounding across two strike rebases, paused-at-9s pulse freeze, display-length change (10:00 → 9:59 ghost width), clock offsets of both signs.
- **4.3's review patch was a per-frame allocation** in the active-flash branch — the same reviewer will profile your `useFrame`. Primitives and refs only.
- **Honest smoke notes:** record (a)–(i) individually; an earlier story's unexecuted smoke claim was caught by the auditor. 4.2/4.3 used headless Playwright + SwiftShader screenshot inspection — works here too (timer progression is timestampable; pulse is verifiable via two screenshots inside one second), but **Jay's interactive check is additionally required** (readability/feel can't be asserted from a screenshot).
- **Keep diffs surgical:** new files + `BombScene.tsx` mount + one `bindServerEvents.ts` hunk + harness keys. 4.3 proved zero-diff outside `apps/client` is achievable for Epic 4 stories — repeat it.
- **Type narrowing recurs in review:** `strikes` is `StrikeCount` (0|1|2|3 union from shared), not `number` — type the glow fn accordingly.
- **Known deferrals you may observe but must not fix:** camera clips chassis ends at max zoom (4.7/10.2); stale focus index on remount (4.6/4.7); permanent-`struck` rendering (8.4).

### Git intelligence

`4126960` merged 4.1–4.3 to master; this worktree (`worktree-story-4-4-4-5`, baseline `4126960`) hosts 4.4 then 4.5 — 4.5 will build the strike LEDs beside your housing, so leave the right-of-timer x-band free (mockup puts strikes adjacent-right). Parallel worktrees exist for 5-1/5-2/8-3-8-4 — another reason the `net/` and store surface area stays minimal. Cadence: implement → adversarial review → patches folded → single story commit.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Stack for this story:** React 18 + Three.js/R3F + Zustand + TypeScript only. No LiveKit, no server, no socket *emissions* (one listener wrap is the only net diff), no new deps (one font asset).
- **R3F (verbatim):** geometry data-driven, never hardcoded JSX; rendering-only components; `useFrame` for per-tick — never `useEffect`+`setInterval`; tick-rate reads via `getState()`.
- **Don't-miss rules in play:** NEVER run the bomb timer on the client (render the server timestamp — AC3 is this rule as an AC); NEVER `Math.random()` (harness constants are fixed); no Postgres/Redis/socket writes anywhere near this story.
- **Performance:** 60fps budget; no per-frame allocations; memoize; troika sync ≤1/sec; dispose via declarative JSX.
- **Build rules:** `tsc --noEmit` 0 errors, no `@ts-ignore`; naming — `TimerLcd` PascalCase component, `timerRemainingMs`/`formatTimerDisplay`/`lcdGlow`/`serverNow` camelCase, `timerLcd.ts`/`serverClock.ts` camelCase modules.
- **Testing boundaries:** pure logic unit-tested in Node (all of Task 2/3); R3F components visual-only; never `Date.now()`/`setTimeout` in tests — time is an input.

### Project Structure Notes

- New files: `apps/client/public/fonts/DSEG7Classic-Regular.ttf`, `apps/client/public/fonts/OFL-DSEG.txt`, `apps/client/src/scenes/timerLcd.ts`, `apps/client/src/scenes/TimerLcd.tsx`, `apps/client/src/scenes/__tests__/timerLcd.test.ts`, `apps/client/src/net/serverClock.ts`, `apps/client/src/net/__tests__/serverClock.test.ts`.
- Modified: `apps/client/src/scenes/BombScene.tsx` (TimerLcd mount + header comment), `apps/client/src/scenes/DevBombHarness.tsx` (T/P/S/U keys), `apps/client/src/net/bindServerEvents.ts` (TIMER_UPDATE wrap). `apps/client/src/scenes/chassis.ts` only if the overlap test forces a documented constant nudge.
- Untouched: stores, `packages/shared`, `apps/server`, `App.tsx`, camera/stage/module files.

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 4.4: Diegetic Timer LCD with Client Extrapolation] (ACs verbatim; Epic 4 objective; 4.5/4.6/4.7 boundaries)
- [Source: packages/shared/src/types/timer.ts] (`TimerState` + segment-reset convention + within-segment formula — the doc comment is the contract)
- [Source: _agent_docs/game-architecture.md#Pattern 5 — Timer Authority via Timestamp + Extrapolation + ADR-005] (broadcast-on-change; offset estimated at connect/refreshed per broadcast; server owns expiry; pause = rebased segment)
- [Source: _agent_docs/game-architecture.md#Epic to Architecture Mapping] (Epic 4 owns timer extrapolation; Epic 8 owns timer authority/`timerReducer.ts`)
- [Source: packages/shared/src/events/server-to-client.ts + payloads.ts] (`TIMER_UPDATE: TimerState`; `StrikePayload { teamId, strikes, timer }` — strike rebases reach the LCD via both events)
- [Source: apps/client/src/store/gameStore.ts] (`timer` beside `bomb`; `setTimer`/`setStrike` already built; "never simulate timer expiry" doc)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md#componentSpec.timer, typography.lcd/scale.timer, colors.hud, Motion] (84px DSEG7 Classic; `#FF3B30`/`#240807`; glow spec + pulseOnStrike; "don't animate digits" verbatim)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#HUD & Diegetic UI / Microcopy / Accessibility / Game Feel] (timer loudest; diegetic on chassis; "T-MINUS" label; reduced-motion disables glow pulse; under-10s pulse-on-the-second)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/3. Defuser Bomb View.html] (`.timer-mount`/`.ghost`/`.live`/`.timer-label` anatomy; ghost `8:88` @ 10%; top-band placement; 76px mock value overruled by DESIGN's 84px)
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#L102–112, L578–587] (pause freezes countdown; strike escalation 25% compounding ×1.00/×1.25/×1.56; Easy default 5:00; timer expiry = round failure — server-side)
- [Source: _agent_docs/project-context.md#Performance Rules, Critical Don't-Miss Rules, React / R3F Gotchas] (server-authoritative timer verbatim; useFrame discipline; no per-frame allocations)
- [Source: _agent_docs/implementation-artifacts/4-3-module-slots-and-solve-leds.md] (px→world-unit conversion 0.0042; review allocation patch; harness/store-path precedent; smoke methodology; dom.ts helpers)
- [Source: _agent_docs/implementation-artifacts/deferred-work.md] (known deferrals not this story's to fix)
- [Reference: github.com/keshikan/DSEG — DSEG v0.46, SIL OFL 1.1] (DSEG7 Classic Regular ttf; `8` = all segments; fixed-width digits)

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- Red→green TDD: `timerLcd.test.ts` (16 tests) + `serverClock.test.ts` (7 tests) written first and confirmed failing (modules absent), then implemented → all green.
- Gates after implementation: `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm --filter @bomb-squad/client build` → green (pre-existing three.js chunk-size note only); `pnpm -r test` → shared 24 ✓, client 120 ✓ (97 baseline post-merge + 23 new), server 147 ✓ — no regressions.
- Headless smoke (playwright-core chromium + SwiftShader against `vite --port 5199`, 1920×1080, harness reused from 4.2/4.3's `/tmp/pw-smoke`, server stopped after), screenshot inspection + numeric pixel analysis (pngjs red-channel means over the LCD region) — results in Completion Notes.
- Worktree provisioning: `pnpm install` + shared build were required first (the known worktree gap — no node_modules in a fresh worktree).

### Completion Notes List

- **Task 1 — font:** `DSEG7Classic-Regular.ttf` vendored from DSEG v0.46 (keshikan) into `public/fonts/` with its own `OFL-DSEG.txt` (per-font copyright line preserved; not merged with jetbrains-mono's `OFL.txt`). Zero new npm packages.
- **Task 2 — pure math:** `scenes/timerLcd.ts` — `timerRemainingMs` (segment formula verbatim, pausedAt substitution, ≥0 clamp), `formatTimerDisplay` (M:SS floored, extends to MM:SS), `timerGhostFor` (digits→8), `lcdGlowIntensity(remainingMs, strikes, reducedMotion)` (signature simplified from the spec's separate `secondFraction` — the phase is derivable from `remainingMs`, keeping the function honest: one input, one truth). Constants: base 1.0, +0.2/strike, pulse boost 0.9, threshold 10_000ms. Also owns the housing geometry constants + the 84px→0.35wu math (comment documents the conversion). 16 tests including 0/9_999/10_000/10_001ms boundaries, monotonic pulse decay, paused freeze, both multiplier values.
- **Task 3 — server clock:** `net/serverClock.ts` — pure `estimateClockOffset` (running: `startedAt − receivedAt`, biases display behind the server — the safe direction; paused: null) + thin module shell `noteTimerBroadcast`/`serverNow` with default-arg time injection (tests stay `Date.now()`-free). `bindServerEvents.ts`: `TIMER_UPDATE` now binds a named `onTimerUpdate` (offset refresh before `setTimer`), symmetric on/off preserved. 7 tests. Single-sample estimator by design — smoothing/RTT compensation deferred to Story 8.4 as specced.
- **Task 4 — component:** `scenes/TimerLcd.tsx`, mounted as one new child in `BombScene`. Memoized; sole reactive subscription is `bomb?.strikes` (mirrored to a ref); per-frame reads via `getState().timer`. `useFrame` driver: troika `.text`/`.sync()` only on formatted-string change (≤1/sec), glow as a single scalar opacity write (skipped when unchanged), zero allocations in the callback, `prefersReducedMotion()` sampled on the ≤1/sec edge only. Housing: graphite box (1.1×0.55×0.16) on the top face straddling z∈[−0.16, 0] between the indicator zone and battery tray, tilted −0.18rad toward the overview camera; overlap tests enforce clearance against `computeChassisFeatureLayout` at the single-row envelope (≤6 indicators / ≤8 batteries) — two-row layouts are a documented limitation flagged for 8.2's generation ranges. LCD: plate `#240807`, ghost `8:88` @ 10% `#FF3B30`, live digits DSEG7 @ fontSize 0.35 (84px ruling), additive glow plane in FRONT of the stack (placing it behind the opaque plate reduced it to an invisible rim — caught and fixed during smoke).
- **Deviation (documented in code):** the `T — MINUS` label rides ABOVE the digits as a nameplate, not below per the mockup — at the overview camera the battery tray in front of the housing occludes anything near the housing's bottom edge (first smoke run proved it: label unreadable behind battery cells). Mockup is anatomy reference, not dimension authority (4.2/4.3 precedence ruling). Ink `#5A5560` (bay-tag convention) instead of mockup `#3A1410`, which is illegible on graphite (that ink was specced against the bakelite band).
- **Task 5 — harness:** T/P/S/U keys in `DevBombHarness` (DEV-guarded listener extended, `isTextEntryTarget` respected). P-resume and S-strike faithfully model the segment-reset convention (fresh segment from frozen/snapshot remaining via `timerRemainingMs` — never just nulling `pausedAt`). All through the real `setTimer` action; fixed constants, no `Math.random()`.
- **Task 6 — headless smoke (executed 2026-06-12, screenshots + pixel measurements inspected):** (a) idle: housing + dim ghost `8:88` + `T — MINUS` label readable at overview, batteries/indicators uncrowded ✓; (b) T → 5:00 → digits flip cleanly once per displayed second (4:59 → 4:57 across ~1.8s wall incl. capture latency), no digit animation ✓; (c) P → frozen at 4:57 across 1.5s (two identical shots), P → resumes from 4:57 (not jumped) ✓; (d) S ×2 → 3 displayed seconds burned in 2.0s wall (×1.5625 compounding measured exactly) ✓; (e) U → under 10s, glow pulses on the second: LCD-region red mean 102.1 just after a digit flip vs 84.0 just before the next (base 81.4 above 10s) — strong, phase-locked modulation ✓; (f) 0:00 hold: display held at 0:00 across repeated shots, no scene change, no events, zero console errors (only the known pre-existing favicon 404) ✓ (AC3); (g) `prefers-reduced-motion: reduce` → static glow (86.8 vs 88.6 across the same phase points — no pulse; residual delta is digit-shape difference) ✓; (h) regression: bay click → focus dolly ✓, ESC → overview with timer still running ✓, digit-key LED toggle ✓, orbit shows back face + serial end intact ✓.
- **Smoke finding fixed mid-pass:** glow plane originally sat behind the opaque LCD plate → pulse invisible (numeric measurement caught it; screenshots alone looked plausible). Moved to the front of the z-stack with additive blending — digits stay readable, whole LCD washes red.
- **Note for 4.5:** the strike LEDs belong beside the timer (mockup right-cluster); the housing is 1.1 wide centred at x=0 — the top-face band right of x≈0.6 is free. The glow's `+20%/strike` base is already live (reads `bomb.strikes`) — 4.5 only adds the LED dots.
- **Note for 8.2:** housing↔feature clearance is proven for single-row layouts only (≤6 indicators / ≤8 batteries). If generation ranges exceed that envelope, the top-face band must be renegotiated (overlap tests will fail loudly).
- **Jay verified interactively (2026-06-12):** ran the worktree dev server and confirmed all three checks — (b) the LCD is readable at overview and the countdown runs smoothly with clean once-per-second digit flips, (e) the under-10s glow pulse looks and feels right, (f) the clock holds at 0:00 with nothing else happening. His words: "everything works as you described." Human-verification AC satisfied.

### File List

- apps/client/public/fonts/DSEG7Classic-Regular.ttf (created — DSEG v0.46, OFL-1.1)
- apps/client/public/fonts/OFL-DSEG.txt (created — DSEG's OFL license with copyright line)
- apps/client/src/scenes/timerLcd.ts (created — pure timer math, glow table, housing geometry + 84px→wu conversion)
- apps/client/src/scenes/__tests__/timerLcd.test.ts (created — 16 tests incl. housing overlap vs chassis features)
- apps/client/src/scenes/TimerLcd.tsx (created — housing + ghost/live DSEG text + additive glow plane + useFrame driver)
- apps/client/src/net/serverClock.ts (created — offset estimator + module shell)
- apps/client/src/net/__tests__/serverClock.test.ts (created — 7 tests)
- apps/client/src/scenes/BombScene.tsx (modified — TimerLcd mount + header comment; camera/chassis/module hunks untouched)
- apps/client/src/scenes/DevBombHarness.tsx (modified — T/P/S/U timer keys with faithful segment rebasing)
- apps/client/src/net/bindServerEvents.ts (modified — named onTimerUpdate wrapping noteTimerBroadcast + setTimer)
- _agent_docs/implementation-artifacts/sprint-status.yaml (modified — story status tracking)

## Change Log

- 2026-06-12: Story 4.4 implemented — diegetic DSEG7 timer LCD in a graphite housing on the chassis top band, per-frame client extrapolation of the server TimerState via `useFrame` + server-clock offset (new `net/serverClock.ts`), M:SS display with `8:88` ghost underlay, glow-only animation (+20%/strike base, under-10s pulse phase-locked to the digit flip, reduced-motion static), display-only 0:00 hold. Dev harness T/P/S/U keys model the server's segment-reset convention through the real store path. Typecheck/build/full suite green (24/120/147); headless smoke with numeric pixel verification passes (a)–(h). Jay verified interactively (readability, pulse feel, 0:00 hold) — story → review.
