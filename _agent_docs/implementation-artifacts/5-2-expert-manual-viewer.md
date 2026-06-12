---
baseline_commit: eed0eb8161590054d4ca2b0d3393f2c5377a84a0
---

# Story 5.2: Expert Manual Viewer

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Expert,
I want a calm, navigable digital manual on paper-styled pages,
So that I can read the rules aloud while the bomb is screaming.

## Acceptance Criteria

1. **Navigation:** In the manual viewer I can click chapters, use arrow keys / Page Up-Down, and press `/` to search chapters by name, with the current chapter highlighted; reaching a chapter from `/` takes under ~300ms.
2. **Scroll memory:** When I flip between chapters and return to one, my scroll position is preserved per chapter (I never lose my place).
3. **Paper styling:** Every manual page uses the serif typeface on cream paper with grain and a paper shadow (≤1° rotation), two-column max (chapter list / content) with no nested scrolling regions — never a generic web modal.
4. **Structured content:** Module manual content comes from `getManualPages()` as structured data (`ManualPage[]`), not raw HTML or untyped JSX.
5. **Observable position:** The Expert's current chapter/page position is exposed as observable state and emitted via a typed event, so the Spectator Lounge (Story 9.4) can mirror it (GDD A3 resolved: spectator manual is LOCKED to the active Expert's current page; most-recently-navigated Expert wins when multiple).
6. **Human verification:** Jay verifies the viewer interactively (see Task 8) and his observed results are recorded in Completion Notes before the story is marked done.

## Tasks / Subtasks

- [x] Task 1 — Shared contract: manual position event (AC: 5)
  - [x] Add `ManualPositionPayload` to `packages/shared/src/events/payloads.ts`: `{ chapterId: string }` (page-within-chapter can be added later if pagination is introduced; chapterId is the unit Story 9.4 mirrors). JSDoc: untrusted client input — server must validate.
  - [x] Add `MANUAL_NAVIGATE: (payload: ManualPositionPayload) => void` to `ClientToServerEvents` (SCREAMING_SNAKE_CASE, mirrors existing entries).
  - [x] Add `EXPERT_MANUAL_POSITION: (payload: ExpertManualPositionPayload) => void` to `ServerToClientEvents` where the payload is `{ chapterId: string, playerId: string }` (playerId lets 9.4 resolve "most-recently-navigated Expert").
  - [x] Re-export new payload types from `packages/shared/src/events/index.ts` (follow the existing re-export block).
- [x] Task 2 — Server: MANUAL_NAVIGATE handler (AC: 5)
  - [x] In `apps/server/src/handlers/` (follow `sessionHandlers.ts` patterns exactly): validate payload (`chapterId` is a non-empty string, length-capped ~64 — untrusted input), require the sender to be a joined player, store the position in Redis (O(1) key write — add a key to `state/keys.ts` keyspace, e.g. `session:{sessionId}:manualPosition`), then broadcast `EXPERT_MANUAL_POSITION` to the `session:{sessionId}` room. No reducer needed — this is presence-style metadata, not game state; it must NOT touch `bombReducer`/`sessionReducer`.
  - [x] Integration test in `apps/server/src/handlers/__tests__/` via the existing `TestSocketServer` wrapper: valid navigate → broadcast received with `{chapterId, playerId}`; invalid payload (empty/non-string/oversized) → no broadcast, no throw.
- [x] Task 3 — Manual chapter model + pure navigation logic (AC: 1, 4)
  - [x] Create `apps/client/src/manual/` (architecture-designated home for the viewer — NOT inside `ui/` or `modules/`).
  - [x] `manual/chapters.ts`: define `ManualChapter = { chapterId, chapterTitle, pages: ManualPage[] }` derived purely from `ManualPage[]` input (group by `chapterId`, preserve order). The viewer consumes `ManualChapter[]` built from module `getManualPages()` output — it must have zero knowledge of any specific module.
  - [x] `manual/search.ts`: pure synchronous chapter-name filter `searchChapters(chapters, query)` — case-insensitive substring/prefix match, in-memory only (this is what makes the <300ms AC trivial; no async, no lazy chapter loading).
  - [x] Unit tests in `manual/__tests__/` (Vitest, follows `ui/__tests__/platform.test.ts` style): grouping, ordering, empty input, search matching/no-match/case.
- [x] Task 4 — Observable position state (AC: 1, 5)
  - [x] Extend `apps/client/src/store/uiStore.ts` with `manualChapterId: string | null` + `setManualChapterId` (uiStore already owns `manualOpen` — this is cross-component UI state, the documented exception to the "presentation state stays in useState" rule; scroll offsets do NOT go here).
  - [x] On chapter change, emit `MANUAL_NAVIGATE` through the typed socket **only when connected and in a session**; the viewer must work fully offline/standalone (dev harness has no session). Debounce is unnecessary at chapter granularity — emit per chapter change.
- [x] Task 5 — Paper viewer UI (AC: 1, 2, 3, 4)
  - [x] `manual/ManualViewer.tsx`: two-column grid — `300px` chapter sidebar + paper desk — matching mockup `4. Expert Manual.html` (the authoritative visual spec; lift its structure: side-kicker "Defusal Handbook", chapter rows with mono chapter numbers, `/`-hint footer with `.kbd` chip, sheet header "Bomb Defusal Manual", chapter big-number heading, sheet footer page label + prev/next).
  - [x] Tokens only — never hardcode values the `@theme` block already covers: `font-manual` (Source Serif 4, already imported), `bg` `--color-surface-manual`, ink `--color-ink-manual`, shadow `var(--panel-manual-shadow)` (+ the mockup's deeper desk shadow is fine as a literal since no token exists), radius `--radius-sm` (paper is near-zero radius — "sheets of paper"), sidebar on operator `--color-surface`. Sheet rotation `-0.8deg` (≤1° per DESIGN.md). Paper grain via a CSS `::before` repeating-gradient like the mockup. Cream is reserved for manual/paper content — never reuse it for game-state signaling.
  - [x] `manual/PageRenderer.tsx`: generic structured-data renderer for `ManualPage` → sections (`heading`, `content`, optional `table` with `headers`/`rows`). Table styling per mockup (`table.rt`: collapsed borders, `#D8CBAC`-style row rules are derivable from mockup CSS). Color-word emphasis (mockup `.w.red` etc.) may tint recognised color words in cells, but the **word itself stays the signal** (colorblind floor) — color is decoration on top of text, never a replacement.
  - [x] Single scrolling region: the sheet's content area scrolls; the sidebar must fit without scrolling (11 chapters max in V1). No nested scroll containers, no `overflow` on both sheet and a child. Not a modal — it is a full view surface ("paper laid on the table").
  - [x] Scroll memory: keep a `Map<chapterId, scrollTop>` in a `useRef` (presentation state — NOT Zustand); save on chapter leave, restore on enter (restore after render, e.g. layout effect).
- [x] Task 6 — Keyboard interaction (AC: 1)
  - [x] `←`/`→` and `PageUp`/`PageDown` move prev/next chapter; current chapter highlighted in sidebar (mockup `.chapter.active`: cream bg, ink-manual text).
  - [x] `/` opens chapter search (inline in the sidebar, not a modal): type-to-filter via `searchChapters`, `Enter` jumps to top match, `Esc` closes. Selection from search renders synchronously (<300ms AC).
  - [x] Reuse `isTextEntryTarget` from `apps/client/src/scenes/dom.ts` so shortcuts never fire while typing in the search input — do NOT reimplement it.
  - [x] Keyboard listener lifecycle: add on mount, clean up on unmount (follow `DevBombHarness.tsx` pattern, including `event.code` usage where modifier-independence matters).
- [x] Task 7 — Dev harness route + fixtures (AC: 1–4 verifiable without Epic 8)
  - [x] `manual/devManualFixtures.ts`: fixture `ManualPage[]` — the 11 chapter titles from the mockup (Wires … Mazes) with stub sections, plus one chapter carrying the full Wires 3/4/5/6 rule tables from the mockup to exercise table rendering. Mark clearly as DEV fixtures: canonical Wires manual content ships via `getManualPages()` in Story 5.3.
  - [x] Add a `/dev/manual` branch in `App.tsx` following the existing `/dev/bomb` pattern exactly (DEV-guarded, same `isBombDevRoute` shape); keep the `App.tsx` diff confined to that branch — Story 5.1 is being developed in a parallel worktree and also touches `App.tsx` (see Dev Notes: parallel-work coordination).
- [ ] Task 8 — Gates + human verification (AC: all, esp. 6)
  - [x] `pnpm -r exec tsc --noEmit` → 0 errors (no `@ts-ignore`); `pnpm --filter @bomb-squad/client build` green; `pnpm -r test` full suite green, no regressions (baseline: shared 24, client 76, server 64).
  - [x] Headless smoke (reuse the playwright-core + SwiftShader harness pattern from 4.2/4.3, vite dev server, 1920×1080, screenshots inspected): paper sheet renders serif-on-cream with rotation + shadow; chapter click highlights and switches; arrows + PageUp/Down navigate; `/` search filters and Enter jumps; scroll position survives a chapter round-trip; zero console errors.
  - [x] **Jay verifies interactively** at `/dev/manual`: paper feel (grain/rotation/shadow reads as "paper on a desk", not a web card), keyboard nav comfort, search speed feels instant, scroll memory works. Record his observed results in Completion Notes — story is not done without this.

## Dev Notes

### Scope and what already exists (do NOT reinvent)

- `ManualPage` / `ManualSection` / `ManualTable` types **already exist** in `packages/shared/src/types/module.ts` — consume them, do not redefine. `IModule.getManualPages(): ManualPage[]` is already part of the contract.
- Design tokens **already exist** in `apps/client/src/index.css` (Tailwind v4 `@theme`, single source): `--font-manual` (Source Serif 4, font already `@import`ed), `--color-surface-manual` `#F2E8D0`, `--color-ink-manual` `#1A1410`, `--color-cream`, `--radius-sm`, `--panel-manual-shadow`. Never hardcode a value a token covers; never add a JS Tailwind theme.
- `uiStore` already has `manualOpen` — extend it, don't create a competing store.
- `isTextEntryTarget` + `prefersReducedMotion` live in `apps/client/src/scenes/dom.ts` — reuse.
- Typed socket plumbing (`net/socket.ts`, `net/bindServerEvents.ts`) and the `Socket<ServerToClientEvents, ClientToServerEvents>` pattern are established — extend the shared interfaces; `socket.emit(string, any)` is forbidden.
- Dev-route pattern: `App.tsx` `/dev/bomb` branch + `DevBombHarness.tsx` (store seeding, DEV-guarded keyboard). Mirror for `/dev/manual`.

### Parallel-work coordination (IMPORTANT)

Story 5.1 (module plugin scaffold, `/dev/sandbox`, click primitive) is being built **in a parallel worktree** (`worktree-story-5-1`) and has no story file yet — there is no 5.1 implementation to build on, and you must not implement 5.1's scope here. Specifically:

- Do NOT modify `apps/client/src/modules/registry.ts` (5.1 extends it). The viewer takes `ManualChapter[]`/`ManualPage[]` as props/input — wiring "all registered modules → manual chapters" happens when real modules land (5.3+).
- Do NOT create `/dev/sandbox` or any per-module scaffolding.
- Expected merge-overlap files: `App.tsx` (both add a dev-route branch) and possibly `uiStore`. Keep both diffs minimal and additive so the merge is trivial.

### Architecture constraints that bind this story

- **Manual lives in `apps/client/src/manual/`** (game-architecture.md Project Structure) — not `ui/`, not `modules/`.
- **Structured data only** (AC4): the renderer maps `ManualPage` data → React. No raw HTML, no `dangerouslySetInnerHTML`, no untyped JSX content blobs.
- **Server-side validation boundary**: `MANUAL_NAVIGATE` payload is untrusted — validate type/length before storing/broadcasting. Handler owns all I/O (parse → validate → Redis write → broadcast); no reducer involvement, no socket emit from any reducer.
- **Redis O(1)**: position is a single keyed write; add the key builder to `apps/server/src/state/keys.ts` alongside existing keys. Postgres is untouched (nothing here is session-end archive material).
- **Room scoping** (Pattern 1): broadcast `EXPERT_MANUAL_POSITION` to `session:{sessionId}`. Story 9.4 narrows consumption to the Spectator Lounge; GDD A3 is RESOLVED as locked-mirror (most-recently-navigated Expert wins — last-write-wins on the Redis key gives this for free).
- **No game logic in components**: navigation/search/grouping logic goes in pure modules (`chapters.ts`, `search.ts`) with unit tests; components render and dispatch only.
- **Voice/game independence is untouched** — this story has no LiveKit surface.

### UX specification (authoritative sources)

- **Mockup `_agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/4. Expert Manual.html`** is the pixel-level reference: 300px sidebar grid, sheet `-0.8deg` rotation, sheet-top rule line, big chapter number in `--color-bakelite`, mono `manual-id` labels, `.kbd` search hint, rule-table styling, footer page label + prev/next. Its `tokens.css` values are already mirrored 1:1 in `index.css`.
- DESIGN.md: manual page is "paper laid on the table" — paper shadow, ≤1° rotation, **never floats like a generic web modal**; manual/dashboard layouts are two-column max with **no nested scrolling regions, ever** ("lost scroll position under time pressure is a usability failure"); manual pages near-zero radius; serif is the primary "you're reading rules, not playing" signal; don't introduce a fourth UI surface.
- EXPERIENCE.md: arrows + Page Up/Down navigate; current chapter highlighted; per-chapter persistent scroll; `/` opens search-by-name, keyboard-first, "<300ms to 'Chapter 10 visible' from `/` keypress"; ESC stays reserved for camera reset on the bomb view (manual ESC only closes the search overlay state, nothing global).
- Colorblind floor: any color used in manual content (e.g. wire-color words) is paired with the word/pattern itself — color never carries meaning alone.
- Microcopy is dry/deadpan period-appropriate; any new operator-world strings go to `ui/copy.ts` conventions (manual-sheet copy like "Bomb Defusal Manual" can live in `manual/` constants).

### Testing requirements

- Pure logic (`chapters.ts`, `search.ts`) → Vitest unit tests in `apps/client/src/manual/__tests__/` (client uses Vitest, NOT Jest).
- Handler → integration test via existing `TestSocketServer` in `apps/server/src/handlers/__tests__/` (server uses its established runner; copy setup from existing tests). Never mock validation logic — call it directly.
- Components are rendering-only; if a component needs a logic test, the logic has leaked — move it to a pure module.
- No `setTimeout`/`Date.now()` in any logic test; the <300ms search AC is satisfied architecturally (synchronous in-memory filter) and confirmed by feel in Task 8, not by a timing assertion.
- Worktree caveat (sprint-1 retro): this worktree lacks gitignored `.env` files and main-built docker images run stale code — for anything docker-based use a worktree-scoped compose project name and `--build`. Unit/integration tests here need no docker; the server handler tests run in-process.

### Previous story intelligence (4.3, 2.1)

- 4.3 ran red→green TDD (tests written first, confirmed failing) and passed gates: tsc 0 errors, client build green, suite 24/76/64 — that is your regression baseline.
- 4.3's headless-smoke recipe (playwright-core chromium + SwiftShader against `vite dev`, screenshots inspected, `/tmp/pw-smoke` harness) is reusable for Task 8; the only known benign console noise is the `/favicon.ico` 404.
- 2.1 established: tokens single-sourced in `@theme` (CSS var + utility per token); presentation state in `useState`/refs, server snapshots in Zustand; deadpan microcopy centralized; `ui/README.md` rules (semantic color reservations; no fourth surface) are binding.
- 2.1 code review repeatedly flagged hardcoded values that tokens covered — don't repeat that.
- Recent commits show the team merges each story worktree to master as a unit (`Merge story 4.1–4.3 …`); keep the worktree clean and self-contained for that merge.

### Project Structure Notes

- New files: `apps/client/src/manual/{ManualViewer.tsx, PageRenderer.tsx, chapters.ts, search.ts, devManualFixtures.ts, __tests__/}`; server handler file in `apps/server/src/handlers/` + test; key builder addition in `state/keys.ts`.
- Modified files (keep diffs minimal): `packages/shared/src/events/{payloads.ts, client-to-server.ts, server-to-client.ts, index.ts}`, `apps/client/src/store/uiStore.ts`, `apps/client/src/App.tsx` (dev-route branch only).
- Do not touch: `modules/registry.ts`, `scenes/` (except importing from `scenes/dom.ts`), reducers, `gameStore`, voice, Postgres.

### Project Context Rules (from project-context.md — binding)

- TypeScript throughout; `tsc --noEmit` zero errors before commit; no `// @ts-ignore`.
- All Socket.IO event types defined in `packages/shared/src/events/` and imported on both sides — never duplicated; event names SCREAMING_SNAKE_CASE.
- `packages/shared` stays pure TypeScript — zero react/socket.io/server deps (the new payload types are plain interfaces).
- `getManualPages()` returns structured data, not raw HTML or untyped JSX.
- All client input validated server-side (bounds/type-check `chapterId`).
- No `Math.random()` anywhere in this story (no generation involved); no client-authoritative timing.
- React components: `PascalCase`; hooks `useCamelCase`; module IDs kebab-case.
- Env/secrets never hardcoded (no new env vars expected here).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 5.2 — story statement + 5 ACs]
- [Source: _agent_docs/game-architecture.md#Project Structure — `apps/client/src/manual/`; #Pattern 1 — room scoping; #Pattern 3 — IModule/getManualPages; #API Contracts — typed event surface; #Server-Side Validation Boundaries]
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/4. Expert Manual.html — authoritative visual spec]
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md — manualPage component, no-nested-scroll rule, ≤1° rotation, serif rationale]
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Component Patterns + Flow 2 — keyboard nav, per-chapter scroll, <300ms search]
- [Source: _agent_docs/planning-artifacts/gdds/gdd-Ktane-2026-06-09/gdd.md#A3 — RESOLVED: spectator manual locked to active Expert]
- [Source: _agent_docs/project-context.md — full rule set]
- [Source: packages/shared/src/types/module.ts — existing ManualPage/ManualSection/ManualTable]
- [Source: _agent_docs/implementation-artifacts/4-3-module-slots-and-solve-leds.md + 2-1-design-tokens-ui-shell-and-state-patterns.md — Dev Agent Records]

## Dev Agent Record

### Agent Model Used

claude-fable-5

### Debug Log References

- Red→green TDD: `chapters.test.ts` + `search.test.ts` + `publishPosition.test.ts` (client, Vitest) and `manualHandlers.test.ts` (server, Jest + TestSocketServer) written first and confirmed failing (modules absent), then implemented → all green. `colorWords.test.ts` added with its helper in the same cycle.
- Worktree had no `node_modules` (known worktree provisioning gap, sprint-1 retro) — `pnpm install` provisioned it; no docker needed for this story's test surface.
- Gates after implementation: `pnpm -r exec tsc --noEmit` → 0 errors across all 3 workspaces; `pnpm --filter @bomb-squad/client build` → green (pre-existing three.js chunk-size note); `pnpm -r test` → shared 24 ✓, client 116 ✓ (94 baseline + 22 new), server 161 ✓ (147 baseline + 14 new) — no regressions.
- Headless smoke (playwright-core chromium, reused `/tmp/pw-smoke` harness from 4.2/4.3, `vite dev`, 1920×1080, screenshots inspected): 25/25 checks pass — results in Completion Notes. Note: port 5199 was held by a parallel session's vite; ours ran on 5200.

### Completion Notes List

- **Task 1 — shared contract:** `ManualPositionPayload { chapterId }` (C2S) and `ExpertManualPositionPayload { chapterId, playerId }` (S2C) in `payloads.ts`; `MANUAL_NAVIGATE` added to `ClientToServerEvents`, `EXPERT_MANUAL_POSITION` to `ServerToClientEvents`; both re-exported from `events/index.ts`. Types only — `packages/shared` stays dependency-free.
- **Task 2 — server handler:** `handlers/manualHandlers.ts` — `parseManualNavigatePayload` (kebab-case id, `/^[a-z0-9][a-z0-9-]{0,63}$/`, rebuilds fresh object) + `registerManualHandlers` following the sessionHandlers pipeline (parse → load session from Redis → authority check → persist → broadcast). Presence-style metadata: no reducer involvement. Design decision: **non-expert MANUAL_NAVIGATE is a silent no-op** (no error, no persist, no broadcast) — every role may read the manual, but only Expert positions are published (the S2C event is the spectator mirror feed, GDD A3). Position persisted at `session:{id}:manualPosition` (new `manualPositionKey` in `state/keys.ts`); last write wins = locked-mirror semantic for free. Registered in `apps/server/src/index.ts` next to `registerSessionHandlers`. 14 tests: parse matrix (7), broadcast+persist, last-write-wins, invalid payload (no broadcast), NOT_IN_SESSION, non-expert no-op, persist-failure → `MANUAL_NAVIGATE_FAILED` recoverable error.
- **Task 3 — pure model:** `manual/chapters.ts` (`ManualChapter`, `buildChapters` groups `ManualPage[]` by chapterId preserving first-seen order; `adjacentChapterId` with no wrap-around) and `manual/search.ts` (`searchChapters`: synchronous in-memory, prefix-ranked-then-substring, case-insensitive — the <300ms AC is architectural). Viewer has zero module knowledge; wiring registered modules → chapters lands with 5.3+.
- **Task 4 — observable position:** `uiStore.manualChapterId` + setter (scroll offsets deliberately NOT in the store). `manual/publishPosition.ts` is the single entry point: always updates the store, emits typed `MANUAL_NAVIGATE` only when `connection === 'connected' && session !== null` — the dev harness exercises the full viewer with zero emissions. Emit is role-agnostic on the client; the server filters to experts.
- **Tasks 5/6 — paper viewer:** `ManualViewer.tsx` (300px sidebar / paper desk, mockup-faithful: kicker, mono chapter numbers, `/` kbd hint, sheet header rule, bakelite big number, footer page label + prev/next) + `PageRenderer.tsx` (generic `ManualPage` → sections/tables; `colorWords.ts` tints recognised color words in content while the word stays the signal — colorblind floor). Tokens used wherever they exist (`font-manual`, `bg-surface-manual`, `text-ink-manual`, `--panel-manual-shadow`, `rounded-sm`, bakelite); remaining literals are mockup-derived on-cream inks with no token equivalent. Sheet rotated −0.8°, SVG fractal-noise grain from mockup tokens.css, exactly ONE scrolling region (sheet content), not a modal. Scroll memory: `Map<chapterId, scrollTop>` in a ref, saved on leave in `selectChapter`, restored in `useLayoutEffect`. Keyboard: ←/→ + PageUp/PageDown chapter flip (clamped, no wrap), `/` opens sidebar-inline search (auto-focused; Enter = top match, Esc = close), all global keys guarded by the reused `isTextEntryTarget`.
- **Task 7 — harness:** `devManualFixtures.ts` (clearly marked DEV-only: 11 mockup chapter titles; Wires carries the full 3/4/5/6 rule tables; The Button is 2 pages exercising grouping; Memory is 14 sections exercising scroll memory) + `DevManualHarness.tsx` + `/dev/manual` branch in `App.tsx` (diff confined to the dev-route branch, same shape as `/dev/bomb`, per the 5.1 parallel-worktree coordination note).
- **Two rendering bugs caught by the smoke, fixed:** (1) the flex scroller needed `min-h-0` (flex `min-height:auto` floor stopped content overflow — scroll was dead); (2) the desk needed `flex items-center justify-center` instead of `grid place-items-center` (implicit auto grid row made the sheet's `h-full` indeterminate, so the paper silently grew past the viewport).
- **Task 8 — smoke (executed headlessly 2026-06-12, screenshots inspected):** 25/25 PASS — 11 chapters listed; Wires active by default; sheet rotated (matrix ≈ −0.8°); serif Source Serif 4 heading; cream `rgb(242,232,208)` sheet; 4 Wires rule tables; exactly one scrolling region; click select + content swap; ArrowRight/PageDown/ArrowLeft/PageUp navigation; clamp at first chapter (no wrap); `/` focuses search; filter to 1 row on "mem"; Enter jumps to Memory in 36ms (budget <300ms); search closes + list restores; arrows while typing don't navigate (isTextEntryTarget); Escape closes search; scroll 800px → away → back restores exactly 800; footer prev/next; zero console/page errors (favicon 404 is the known pre-existing noise). Screenshots in `/tmp/pw-smoke/shots-5-2/`.
- **AC6 — human verification (Jay, 2026-06-12):** interactive pass at `/dev/manual` completed — "everything works as described": paper feel, keyboard navigation (chapter flipping, `/` search flow), search speed, and scroll memory all confirmed working as documented.

### File List

- packages/shared/src/events/payloads.ts (modified — ManualPositionPayload + ExpertManualPositionPayload)
- packages/shared/src/events/client-to-server.ts (modified — MANUAL_NAVIGATE)
- packages/shared/src/events/server-to-client.ts (modified — EXPERT_MANUAL_POSITION)
- packages/shared/src/events/index.ts (modified — re-exports)
- apps/server/src/state/keys.ts (modified — manualPositionKey)
- apps/server/src/handlers/manualHandlers.ts (created — parse + register MANUAL_NAVIGATE)
- apps/server/src/handlers/__tests__/manualHandlers.test.ts (created — 14 tests)
- apps/server/src/index.ts (modified — registerManualHandlers wired in)
- apps/client/src/manual/chapters.ts (created — ManualChapter, buildChapters, adjacentChapterId)
- apps/client/src/manual/search.ts (created — searchChapters)
- apps/client/src/manual/colorWords.ts (created — splitColorWords + MANUAL_COLOR_INKS)
- apps/client/src/manual/publishPosition.ts (created — observable position + conditional typed emit)
- apps/client/src/manual/PageRenderer.tsx (created — structured ManualPage → paper React)
- apps/client/src/manual/ManualViewer.tsx (created — sidebar + paper sheet, keyboard, search, scroll memory)
- apps/client/src/manual/devManualFixtures.ts (created — DEV-only fixture pages)
- apps/client/src/manual/DevManualHarness.tsx (created — /dev/manual mount)
- apps/client/src/manual/__tests__/chapters.test.ts (created — 7 tests)
- apps/client/src/manual/__tests__/search.test.ts (created — 5 tests)
- apps/client/src/manual/__tests__/publishPosition.test.ts (created — 4 tests)
- apps/client/src/manual/__tests__/colorWords.test.ts (created — 6 tests)
- apps/client/src/store/uiStore.ts (modified — manualChapterId + setter)
- apps/client/src/App.tsx (modified — /dev/manual dev-route branch only)
- _agent_docs/implementation-artifacts/sprint-status.yaml (modified — story status tracking)

## Change Log

- 2026-06-12: Story 5.2 implemented — Expert manual viewer: paper-styled two-column viewer (`apps/client/src/manual/`) rendering structured `ManualPage` data with serif-on-cream sheet (grain, −0.8° rotation, paper shadow), single scrolling region with per-chapter scroll memory, keyboard navigation (arrows/PageUp-Down) and `/` chapter search; observable position in `uiStore` emitted as new typed `MANUAL_NAVIGATE` event, validated/persisted server-side and rebroadcast as `EXPERT_MANUAL_POSITION` to the session room (locked-mirror feed for Story 9.4). Dev fixtures + `/dev/manual` harness. All gates green (tsc 0, build, shared 24 / client 116 / server 161); headless smoke 25/25 with screenshot inspection. Awaiting Jay's interactive verification (AC6).

## Review Findings

Code review 2026-06-12 (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 5 ACs PASS; every binding constraint (manual location, structured-data-only, server-side validation, Redis O(1), no reducer, room scoping, tokens, ≤1° rotation, single scroll region, colorblind floor, `isTextEntryTarget` reuse, App.tsx confined to dev-route, no `registry.ts` touch, SCREAMING_SNAKE_CASE, shared purity, no `@ts-ignore`/`Math.random`) verified satisfied. AC6 human verification recorded.

- [x] [Review][Patch] Global keydown effect has no dependency array — re-subscribes the `window` `keydown` listener on every render (incl. every search keystroke); add `[chapters, current]` deps so it re-binds only on chapter/manual change [apps/client/src/manual/ManualViewer.tsx:72-101] — FIXED 2026-06-12 (tsc clean, 22/22 manual tests pass)
- [x] [Review][Defer] MANUAL_NAVIGATE expert authority check keys on transient `socket.id` — an Expert who reconnects with a new socket id is silently treated as non-expert; matches the existing `sessionHandlers.ts:417` facilitator convention, so this is a codebase-wide reconnection concern, not introduced here [apps/server/src/handlers/manualHandlers.ts:90] — deferred, pre-existing
