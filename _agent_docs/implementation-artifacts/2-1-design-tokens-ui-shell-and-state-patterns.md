---
baseline_commit: cf924f6
---

# Story 2.1: Design Tokens, UI Shell & State Patterns

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a player,
I want a consistent token-driven app shell with shared components, loading/connecting, viewport, and platform gates,
so that I always know the system's state, the UI is visually coherent, and I only play in a supported environment.

## Acceptance Criteria

1. **Design tokens are the single source.** Given the design-token system, when components are styled, then the `DESIGN.md` tokens are implemented as the single source — two color worlds (bomb-world diegetic + operator-world non-diegetic), the five typeface families each in its assigned role, the 4px spacing unit with 32px HUD safe-area, and the radius scale — with semantic color reservations enforced (LED green = solved, red = strike, amber = caution, cool blue = self, cream = manual; never decorative).

2. **Primary button is tactile and never destructive.** Given the primary button component, when it is pressed, then it shows the tactile 2px `translateY` press; every destructive/irreversible action requires a secondary confirm step; and no primary button is ever itself a destructive action.

3. **Network waits show a loading screen, never a silent block.** Given a network call in progress, when the UI is waiting, then a full-bleed loading screen with a status line is shown ("Connecting…") — never a silent blocking call.

4. **Sub-minimum viewport is gated.** Given a viewport below 1280×720, when the app loads, then a "Resize your window — Bomb Squad needs more room" gate is shown instead of the game.

5. **Mobile is bounced.** Given a mobile browser, when the app loads, then a friendly bounce screen ("Bomb Squad is a desktop experience") is shown.

6. **Operator-world UI uses the non-diegetic palette and deadpan microcopy.** Given any operator-world UI, when it is styled, then it uses the non-diegetic token palette (dark shell, cream ink) and microcopy is dry/deadpan/period-appropriate.

## Tasks / Subtasks

- [x] **Task 1 — Install & configure Tailwind v4 with design tokens as the single source (AC: 1, 6)**
  - [x] Add Tailwind v4 to `apps/client`: `pnpm --filter @bomb-squad/client add -D tailwindcss @tailwindcss/vite`. Use the **CSS-first** v4 approach (`@theme` in CSS) — do **not** create a `tailwind.config.js` JS theme. Rationale: v4's `@theme` block emits CSS custom properties **and** generates matching utilities from one definition, which is literally the "single source" AC1 demands. (See "Tailwind v4 — exact setup" in Dev Notes.)
  - [x] Register the plugin in `apps/client/vite.config.ts`: import `tailwindcss from '@tailwindcss/vite'` and add it to `plugins` alongside the existing `react()`. No `postcss.config.js` is needed with the Vite plugin.
  - [x] Create `apps/client/src/index.css` with `@import 'tailwindcss';` followed by an `@theme { … }` block that defines every token from `DESIGN.md` frontmatter (colors, typography families + scale, radii, spacing). Copy values **verbatim** from `_agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/tokens.css` — that file was generated 1:1 from `DESIGN.md` and is the authoritative literal mapping. Do **not** invent or round any value.
  - [x] **Name tokens by semantic role** so AC1's reservations are encoded in the names, not just comments: e.g. `--color-led-green` / `--color-led-red` / `--color-led-amber` / `--color-speaker-self` / `--color-cream`. Add a header comment block in `index.css` stating the five reservations verbatim from DESIGN.md ("LED green = solved/safe/armed-clear … Cream paper = manual content; never game-state signaling") so any future dev reads the rule at the point of use.
  - [x] Load the five font families. Mirror the two `@import url(...)` lines at the **top** of `tokens.css` (Google Fonts: Space Grotesk, Inter, Source Serif 4, JetBrains Mono; jsDelivr: DSEG7). `@import` statements must precede `@import 'tailwindcss';` per CSS ordering rules — put the font `@import`s first. The LCD (DSEG7) family is only consumed by the timer in Epic 4; loading it now is harmless and keeps the token set complete.
  - [x] Import `./index.css` once, at the top of `apps/client/src/main.tsx` (before the React imports is fine; it just needs to be in the bundle entry). Remove the inline `fontFamily`/`style` objects from `App.tsx` once the shell exists (Task 2).
  - [x] Set base document styling in `index.css` (outside `@theme`): `*,*::before,*::after { box-sizing: border-box }` and `html,body { margin:0; background: var(--color-surface); color: var(--color-ink-primary); font-family: var(--font-body) }`. Use the operator-world surface (`#161318`), not the mockup's pure black — pure black is the letterbox background behind the R3F stage (Epic 4), not the operator shell.
  - [x] Add a global focus ring matching DESIGN.md / EXPERIENCE.md Accessibility Floor: `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px }` (focus = LED green `#3DFF7A`).

- [x] **Task 2 — Operator-world `AppShell` + `ui/` directory (AC: 1, 6)**
  - [x] Create `apps/client/src/ui/` (the architecture's `ui/` home for "Tailwind non-diegetic HUD, lobby, dashboard"). All components in this story live here.
  - [x] Create `apps/client/src/ui/AppShell.tsx` — a full-viewport operator-world container: dark `surface` background, `ink-primary` (cream) text, `font-body`. It wraps page content and is the non-diegetic frame for lobby/landing/dashboard (those land in Stories 2.2–2.6). Keep it a thin layout primitive — header slot + children. **Do not** use any Bakelite/brass/bomb-world tokens here — DESIGN.md "Don'ts": the operator shell is non-diegetic; bomb-world palette is reserved for the chassis/HUD.
  - [x] Create `apps/client/src/ui/index.ts` barrel re-exporting `AppShell`, `Button`, `ConfirmButton`, `LoadingScreen`, `PlatformGate` for clean imports from sibling/future code.

- [x] **Task 3 — `Button` component: variants, tactile press, destructive-confirm pattern (AC: 2)**
  - [x] Create `apps/client/src/ui/Button.tsx`. Export `Button` with a `variant` prop: `'primary' | 'secondary' | 'danger'` (default `'primary'`). Style each from tokens to match `tokens.css` `.btn-primary` / `.btn-secondary` / `.btn-danger` exactly (primary = Bakelite bg, cream ink, 2px `bakelite-deep` border, the derived shadow; secondary = transparent + `ink-muted` border; danger = `led-red` bg, white ink).
  - [x] **Tactile press (AC2):** primary's `:active` state translates down 2px and drops its own shadow (`active:translate-y-0.5 active:shadow-none`, with the resting shadow `0 2px 0 var(--color-bakelite-deep), 0 4px 12px rgba(0,0,0,.4)`). This press is **primary-only** — DESIGN.md: "the only place we use a tactile press effect." Do not apply it to secondary/danger.
  - [x] **Destructive actions require a confirm step (AC2):** create `apps/client/src/ui/ConfirmButton.tsx` — a small two-step state machine (`idle → confirming`) used for any destructive/irreversible action (e.g. "End session?"). First click reveals an inline confirm (a `danger`-variant confirm + a `secondary` cancel); only the second, explicit confirm fires `onConfirm`. Keep the tiny `idle/confirming` boolean in local `useState` — this is presentation logic, not game state, so it does **not** go in Zustand.
  - [x] **Hard rule (AC2):** the `primary` variant must never be wired to a destructive action. Encode this by routing destructive actions exclusively through `ConfirmButton` (whose action button uses the `danger` variant). Add a JSDoc note on `Button` stating "primary is for safe/forward actions only — destructive actions use ConfirmButton."
  - [x] Add `prefers-reduced-motion` respect: the press transition is motion; under reduced motion the translate still snaps instantly (the `transition` is ~40ms so it is acceptable, but do not add any additional press animation that violates the Accessibility Floor's reduced-motion contract).

- [x] **Task 4 — `LoadingScreen` for the connecting state, wired into `App.tsx` (AC: 3)**
  - [x] Create `apps/client/src/ui/LoadingScreen.tsx` — a full-bleed (`fixed inset-0`) operator-world screen centered on a status line. Props: `status: string` (the message) and optionally a `spinner` element. Default microcopy from EXPERIENCE.md State Patterns: **"Connecting…"** (game socket). EXPERIENCE.md mandates separate microcopy for the voice path ("Connecting to Bomb Room…") — accept a `status` prop so callers choose; do **not** hardcode a single string.
  - [x] **Wire into the existing bootstrap (UPDATE `App.tsx`, do not rewrite the socket effect):** `App.tsx` today (Story 1.7) renders an inline `<div>` whose color reflects `gameStore.connection` (`disconnected`/`connecting`/`connected`). Replace **only that returned markup**: when `connection !== 'connected'`, render `<LoadingScreen status="Connecting…" />`; otherwise render the `<AppShell>` with placeholder content (the real landing/lobby is Story 2.2+). **Preserve verbatim** the `useEffect([])` that creates the socket, calls `bindServerEvents`, `socket.connect()`, and cleans up on unmount — that is the load-bearing connection lifecycle and StrictMode-safe path from Story 1.7. Do not touch `createSocket`, `bindServerEvents`, or the stores.
  - [x] Keep the loading screen driven **only** by the last-received store snapshot (`useGameStore((s) => s.connection)`). The client is non-authoritative (Story 1.7 / architecture State Residence Model) — never derive connection truth locally or run a timer; just render what the store holds.
  - [x] "Never a silent blocking call" (AC3): there must be no code path where the app is awaiting the socket and shows blank/static content — the `connection !== 'connected'` branch guarantees the loading screen covers `disconnected` and `connecting` both.

- [x] **Task 5 — Viewport gate + mobile bounce gate (AC: 4, 5)**
  - [x] Create pure decision helpers in `apps/client/src/ui/platform.ts` (testable, no React): `isViewportTooSmall(w: number, h: number): boolean` → `w < 1280 || h < 720`; and `isMobileUA(ua: string): boolean` using a conservative mobile regex (e.g. `/Android|iPhone|iPad|iPod|Mobi/i`). Export a single `evaluateGate({ width, height, userAgent }): 'ok' | 'mobile' | 'too-small'` that returns `'mobile'` first (mobile beats size — a phone in landscape can exceed odd thresholds), else `'too-small'`, else `'ok'`. **Mobile takes priority over the size check.**
  - [x] Create `apps/client/src/ui/useViewportGate.ts` — a hook that reads `window.innerWidth/innerHeight` + `navigator.userAgent`, subscribes to `resize`, and returns the current `'ok' | 'mobile' | 'too-small'`. Clean up the `resize` listener on unmount. Reads of `window`/`navigator` are render-time/effect-time only (no SSR in this app).
  - [x] Create `apps/client/src/ui/PlatformGate.tsx` — wraps children; on `'too-small'` renders the resize gate, on `'mobile'` renders the bounce screen, on `'ok'` renders children. Microcopy **verbatim** from the ACs / EXPERIENCE.md: too-small → **"Resize your window — Bomb Squad needs more room"**; mobile → **"Bomb Squad is a desktop experience"**. Both gates are operator-world (dark shell, cream ink, deadpan) — AC6.
  - [x] Mount `PlatformGate` at the **outermost** UI boundary so the gate wins before any connecting/loading UI: in `App.tsx`, wrap the returned tree as `<PlatformGate>…</PlatformGate>`. Order of precedence top-to-bottom: **platform gate → loading screen → app shell**. (A mobile/too-small user should see the gate even while the socket is connecting.)

- [x] **Task 6 — Microcopy & semantic-reservation guardrails (AC: 1, 6)**
  - [x] Centralize the deadpan operator microcopy used in this story so Stories 2.2–2.6 reuse it consistently: create `apps/client/src/ui/copy.ts` exporting the strings used here (`CONNECTING`, `GATE_RESIZE`, `GATE_MOBILE`). Keep it tiny — this is not an i18n system, just a single place for the period-appropriate voice (EXPERIENCE.md "Voice and Tone"). Tone reference: dry/deadpan; no exclamation-heavy SaaS copy.
  - [x] Add a short `apps/client/src/ui/README.md` (or a top-of-file doc block in `index.css`) restating the **semantic color reservations** and the "no fourth UI surface" rule (bomb / HUD overlay / modal-or-manual) so the epic's later UI work cannot drift. This is the lightweight "enforcement" AC1 asks for — names + a single documented rule at the point of use. (A lint rule is out of scope for V1.)

- [x] **Task 7 — Client test setup (Vitest) + gate-logic unit tests, typecheck & build (AC: 1–6)**
  - [x] Introduce Vitest for the client — this story is where client-side UI logic first appears, and Epic 2 will add much more. `pnpm --filter @bomb-squad/client add -D vitest`. Replace the placeholder `"test"` script in `apps/client/package.json` with `"vitest run"` (and optionally a `"test:watch": "vitest"`). Keep it Node-environment + pure-function focused — do **not** pull in `jsdom`/React Testing Library for this story. (Project testing rule: components are visual-regression-only via Playwright; only the **pure** gate logic gets a unit test here.)
  - [x] Add `apps/client/src/ui/__tests__/platform.test.ts` covering `evaluateGate`: `'ok'` at exactly 1280×720 and above; `'too-small'` at 1279×720 and 1280×719; `'mobile'` for a sample iPhone/Android UA **even at a large viewport** (mobile priority); desktop UA at small viewport → `'too-small'`. Test `isViewportTooSmall` boundary (1280/720 inclusive ⇒ not too small).
  - [x] **Gate (the contract this story is judged on):** `pnpm -r exec tsc --noEmit` from repo root → 0 errors across all workspaces (no `// @ts-ignore`). `pnpm --filter @bomb-squad/client build` (`tsc && vite build`) → succeeds, Tailwind CSS emitted. `pnpm --filter @bomb-squad/client test` → green.
  - [x] **Manual smoke (document in Completion Notes):** run `pnpm --filter @bomb-squad/client dev`. Confirm: (a) at a normal desktop window the operator shell renders with the design fonts/colors; (b) shrinking the window below 1280×720 shows the resize gate; (c) emulating a mobile UA (devtools device toolbar) shows the bounce screen; (d) with the server **not** running, the loading screen sits on "Connecting…" rather than a blank/silent screen; with the server running it advances to the shell. If the server can't run in this environment, verify (a)–(d) except the connected state.

### Review Findings

<!-- Code review 2026-06-12 (commit 8355fda) — layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor -->

- [x] [Review][Defer] iPad desktop-UA bypasses the mobile bounce — iPadOS 13+ Safari reports a `Macintosh` UA with no `Mobi` token, so `isMobileUA` in `apps/client/src/ui/platform.ts` never matches — deferred (decision 2026-06-12): accepted gap; an iPad Pro at 1366×1024 passes the viewport gate anyway and may be usable; revisit if iPad reports surface (blind+edge+auditor)
- [x] [Review][Patch] PlatformGate unmounts the entire app subtree on a transient resize — keep children mounted and render the gate as a covering overlay instead, so dipping below 1280×720 (window snap, dock/undock) preserves mounted UI state for Stories 2.2–2.6 [apps/client/src/ui/PlatformGate.tsx] (edge; decision 2026-06-12: overlay)
- [x] [Review][Decision→Resolved] Task 7 "Manual smoke" subtask was checked `[x]` but not executed at dev time — resolved 2026-06-12: Jay ran the documented (a)–(d) visual pass on the post-review-patch build and confirmed it; Completion Notes updated. (auditor)
- [x] [Review][Patch] ConfirmButton destructive-fire hazards: the armed Confirm button renders in the exact position of the resting button, so a double-click fires the irreversible action; rapid clicks on Confirm can also invoke `onConfirm` twice — guard with a fired-once check and offset/restructure the armed layout [apps/client/src/ui/ConfirmButton.tsx] (blind+edge)
- [x] [Review][Patch] ConfirmButton armed state never disarms — no blur, Escape, or timeout handling, so a stray later click triggers the destructive action [apps/client/src/ui/ConfirmButton.tsx] (edge)
- [x] [Review][Patch] ConfirmButton keyboard focus drops to `<body>` when the resting button unmounts on arm — move focus to Confirm on arm and restore on cancel [apps/client/src/ui/ConfirmButton.tsx] (edge)
- [x] [Review][Patch] `--radius-none: 0` omitted from the `@theme` block — tokens.css/DESIGN.md define it as part of the radius scale; AC1 requires a complete 1:1 mapping [apps/client/src/index.css] (auditor)
- [x] [Review][Patch] Button transition timing deviates from the `.btn` reference it claims to match 1:1 — tokens.css specifies `transform .04s / background .15s / box-shadow .12s`; implementation uses a uniform `duration-100`, weakening the documented reduced-motion rationale (~40ms snap) [apps/client/src/ui/Button.tsx:11-12] (auditor)
- [x] [Review][Patch] Press distance and paddings are rem-derived, not the literal px values Task 3 specifies — `active:translate-y-0.5`, `px-5 py-3`, `py-2.5` equal 2px/20px/12px/10px only at a 16px root font size; tokens.css specifies fixed `translateY(2px)` and `12px 20px` / `10px 18px` [apps/client/src/ui/Button.tsx:23-28] (auditor)
- [x] [Review][Patch] Confirm-step microcopy (`'Confirm'`, `'Cancel'` defaults) hardcoded in the component instead of centralized in `copy.ts`, against Task 6 and the ui/README's own rule [apps/client/src/ui/ConfirmButton.tsx] (auditor)
- [x] [Review][Defer] Disconnected/failed connection shows "Connecting…" indefinitely with no failure or retry affordance [apps/client/src/App.tsx] — deferred: matches this story's spec (loading screen covers both `disconnected` and `connecting`; socket.io auto-reconnects); dedicated error-state UX belongs to a later story (blind+edge)
- [x] [Review][Defer] Fonts load via render-blocking third-party CDN `@import`s (Google Fonts + jsDelivr) — offline/firewalled users get fallbacks; GDPR exposure — deferred: spec-mandated mirror of tokens.css for now; self-host before production [apps/client/src/index.css:1-2] (blind+edge)
- [x] [Review][Defer] `aria-live="polite"` on a freshly mounted LoadingScreen may never announce — live regions announce changes, not initial content [apps/client/src/ui/LoadingScreen.tsx] — deferred: minor a11y polish, no unambiguous fix at this layer (blind)
- [x] [Review][Defer] No component tests for ConfirmButton's state machine or PlatformGate precedence — deferred: test scope matches Task 7 (pure logic only; components are visual-regression-only per project testing rules); revisit when component-test infra lands (blind)

## Dev Notes

### What this story is — and is not

This is the **operator-world (non-diegetic) UI foundation**: design tokens, the dark app shell, shared primitives (Button + confirm pattern, LoadingScreen), and the platform/viewport gates. It is the substrate every Epic 2 lobby/landing/dashboard screen sits on.

**Out of scope (do not build here):** any bomb-world / diegetic UI (chassis panels, timer LCD, strike LEDs, module solve LEDs) — that is Epic 4 and is R3F-rendered. The DESIGN.md tokens for those (`--timer-*`, `--led-*`, `--color-bakelite*`, `--color-brass`) are **defined** in the token set now (AC1 wants the full token system) but are **not consumed** by any component in this story. Do not build a `Timer`, `StrikeIndicator`, `SpeakerIndicator`, `Toast`, `Panel`, or manual-paper component — those land where they are first used (Epics 3/4/9). Adding them now is scope creep and risks diverging from the real consuming context.

### Current state of `apps/client` (files this story UPDATEs)

The client today is the Story 1.7 bootstrap. Read before editing:

- `apps/client/src/App.tsx` — has the **load-bearing** `useEffect([])` that creates the socket, binds server events, connects, and cleans up (StrictMode-safe). It currently returns an inline `<div>` status indicator with inline `style`. **You replace only the returned JSX** (wrap in `PlatformGate`, branch to `LoadingScreen` vs `AppShell`) and remove the inline styles — the effect body is untouched.
- `apps/client/src/main.tsx` — `createRoot` + `<StrictMode><App/></StrictMode>`, imports `./App.js` (the `.js` specifier on a `.tsx` source is the project's ESM/Bundler-resolution convention — keep it). Add the `import './index.css'` here. **Preserve StrictMode.**
- `apps/client/vite.config.ts` — `@vitejs/plugin-react` only today. Add `@tailwindcss/vite`. No path aliases — use relative imports (`./ui/...`).
- `apps/client/tsconfig.json` — `strict: true`, `moduleResolution: 'Bundler'`, `jsx: 'react-jsx'`, `noEmit: true`, libs include `DOM`/`DOM.Iterable`. No changes needed; `.css` imports are handled by Vite, not tsc (tsc ignores them).
- `apps/client/package.json` — deps: `react`, `react-dom`, `@bomb-squad/shared`, `zustand`, `socket.io-client`. Scripts include a placeholder `test`. You add `tailwindcss`, `@tailwindcss/vite`, `vitest` (all devDeps) and replace the `test` script.
- `apps/client/index.html` — `<div id="root">` + module script. No change (do not add font `<link>`s there — fonts load via `index.css` `@import`).
- `apps/client/.env.example`, `src/vite-env.d.ts`, `src/net/*`, `src/store/*` — leave untouched; not part of this story.

### Authoritative design sources (both win over any mockup)

- **`DESIGN.md`** (`_agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md`) — visual identity. Frontmatter is the token spec. `[CONFIRMED 2026-06-10]` Bakelite-orange + graphite + LED palette approved by Jay; "the design-token system (Story 2.1) builds on it" — that is **this story**.
- **`EXPERIENCE.md`** (same dir) — behavior, microcopy, state patterns, accessibility floor, responsive/platform rules. Source of the exact gate/loading strings and the precedence of state screens.
- **`tokens.css`** (same dir, `mockups/tokens.css`) — generated 1:1 from `DESIGN.md`. Use it as the **literal value source** for the `@theme` block and base styles. It also carries `.btn-*` and `.led` reference implementations — match the Button component to `.btn-*`.
- **`mockups/*.html` + `stage.js`** — reference only. **Do not** copy `stage.js`'s fixed-1920×1080-`.stage`-transform approach into the React app: that is a static-mockup convenience. EXPERIENCE.md "Responsive & Platform" says the real UI uses **standard responsive units** (R3F handles DPR for the 3D scene in Epic 4); this story's job is the **gates** (resize/mobile), not a global transform-scale stage. Letterboxing of the bomb scene is an Epic 4 concern.

### Tailwind v4 — exact setup (avoid the v3 trap)

The project uses Tailwind **v4** (CSS-first). Do not scaffold the v3 way (`npx tailwindcss init`, `content` array, `tailwind.config.js` theme, `@tailwind base/components/utilities`). The v4 path:

1. `vite.config.ts`:
   ```ts
   import { defineConfig } from 'vite';
   import react from '@vitejs/plugin-react';
   import tailwindcss from '@tailwindcss/vite';

   export default defineConfig({ plugins: [react(), tailwindcss()] });
   ```
2. `src/index.css` (order matters — font `@import`s, then Tailwind, then `@theme`):
   ```css
   @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=JetBrains+Mono:wght@500;700&display=swap');
   @import url('https://cdn.jsdelivr.net/npm/dseg@0.46.0/css/dseg.css');
   @import 'tailwindcss';

   /* Semantic color reservations (DESIGN.md) — NEVER decorative:
      led-green = solved/safe · led-red = strike/error · led-amber = caution
      speaker-self (cool blue) = "this is you" (voice only) · cream = manual paper */
   @theme {
     --color-bakelite: #C2491F;
     --color-bakelite-deep: #7A2A10;
     --color-cream: #E8DCC2;
     --color-graphite: #1A1A1F;
     --color-brass: #B8924A;
     --color-led-green: #3DFF7A;
     /* … all remaining colors from tokens.css … */
     --color-surface: #161318;
     --color-surface-raised: #221E26;
     --color-ink-primary: #F4ECDA;
     --color-ink-muted: #9A8E78;
     --color-focus: #3DFF7A;
     --color-speaker-self: #4FB8FF;

     --font-display: 'Space Grotesk', 'Inter', system-ui, sans-serif;
     --font-body: 'Inter', system-ui, sans-serif;
     --font-manual: 'Source Serif 4', 'Georgia', serif;
     --font-mono: 'JetBrains Mono', 'IBM Plex Mono', monospace;
     --font-lcd: 'DSEG7 Classic', 'Share Tech Mono', monospace;

     --text-xs: 11px; --text-sm: 13px; --text-base: 15px; --text-md: 17px;
     --text-lg: 22px; --text-xl: 32px; --text-2xl: 48px; --text-timer: 84px;

     --radius-sm: 2px; --radius-md: 4px; --radius-lg: 8px; --radius-chassis: 6px;

     --spacing-safe: 32px; --spacing-hud: 24px; --spacing-inset: 16px;
   }
   ```
   v4 turns each `--color-*` into a utility (`bg-bakelite`, `text-cream`, `border-bakelite-deep`), each `--font-*` into `font-display`/`font-body`/etc., each `--text-*` into `text-base`/`text-timer`, etc. That is the "single source": one `@theme` definition → CSS vars **and** utilities.
3. `main.tsx`: add `import './index.css';` as the first import.
- The 4px spacing **unit** (AC1) maps to Tailwind's default spacing scale (already 4px-based: `p-4` = 16px). Add the named insets (`--spacing-safe` etc.) for the 32px HUD safe-area token so it is in the system even though no HUD consumes it yet.

### State patterns established here (reused all epic)

- **Loading/connecting** (EXPERIENCE.md "State Patterns"): full-bleed screen + status line; never a silent block. Driven by store snapshot only.
- **Destructive confirm**: every irreversible action = two steps; no primary button is destructive (DESIGN.md/EXPERIENCE.md component patterns). `ConfirmButton` is the canonical implementation 2.2–2.6 reuse (e.g. "End session?").
- **Presentation state stays out of Zustand**: the confirm toggle and gate result are local component state. Zustand holds **server snapshots** only (architecture State Residence Model: "Render only; non-authoritative"). Do not add UI-ephemeral booleans to `gameStore`. (The existing `uiStore` from 1.7 holds cross-component UI state like `manualOpen` — a per-button confirm flag is local, not cross-component, so keep it in `useState`.)

### Accessibility floor (EXPERIENCE.md — apply now, it is a release gate not polish)

- Focus ring: `2px solid var(--color-focus)` (LED green) + `2px` offset on all keyboard-focusable UI. Set globally via `:focus-visible` in `index.css`.
- `prefers-reduced-motion`: respect it. This story's only motion is the Button press (~40ms) — acceptable; do not add gratuitous transitions. No timer-glow/pulse exists yet.
- Color is never the sole signal: not directly exercised by this story's components, but bake the habit — gates and loading screens carry **text**, never color-only meaning.

### Project Context Rules (from `_agent_docs/project-context.md`)

- **Stack:** React 18+, Tailwind CSS, Zustand, TypeScript throughout, Vite. This is the story that introduces Tailwind (deferred in 1.7). No R3F/Three.js, no LiveKit here.
- **State boundaries:** client store is render-only / non-authoritative; server owns truth. Never run a timer or derive game state on the client.
- **Build:** `tsc --noEmit` zero errors before commit; **no `// @ts-ignore`**; per-workspace tsconfig (don't touch root); never hardcode the server URL (already handled in 1.7 via `VITE_SERVER_URL` — don't regress it).
- **TypeScript only** — no `.js`/`.jsx` source files. (The `./App.js` / `./index.css` import specifiers are module resolution, not JS source.)
- **Naming:** React components `PascalCase` (`AppShell`, `LoadingScreen`, `PlatformGate`, `Button`, `ConfirmButton`); hooks `camelCase` `use`-prefixed (`useViewportGate`); pure helpers `camelCase` (`evaluateGate`, `isMobileUA`).
- **Security (forward-looking):** nothing here should imply client-trusted state; gates are UX, not authorization.

### Project Structure Notes

- New dir: `apps/client/src/ui/` — exactly the architecture's `ui/` ("Tailwind non-diegetic HUD, lobby, dashboard"). New files: `ui/AppShell.tsx`, `ui/Button.tsx`, `ui/ConfirmButton.tsx`, `ui/LoadingScreen.tsx`, `ui/PlatformGate.tsx`, `ui/useViewportGate.ts`, `ui/platform.ts`, `ui/copy.ts`, `ui/index.ts`, `ui/__tests__/platform.test.ts`, plus `src/index.css`. Updated: `main.tsx`, `App.tsx`, `vite.config.ts`, `package.json`.
- No new `tsconfig`. Existing client `tsconfig.json` covers `src/**/*.ts(x)`.
- `voice/`, `scenes/`, `manual/`, `modules/` directories are **not** created here (later epics).

### References

- [Source: _agent_docs/planning-artifacts/epics.md#Story 2.1: Design Tokens, UI Shell & State Patterns] (ACs verbatim)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/DESIGN.md] (token spec in frontmatter; semantic reservations; button press; two color worlds; no-fourth-surface rule)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#State Patterns] (loading/connecting screen, never silent block)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Responsive & Platform] (1280×720 gate; mobile bounce; "standard responsive units")
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Voice and Tone] (dry/deadpan microcopy)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/EXPERIENCE.md#Accessibility Floor] (focus ring = LED green; reduced motion)
- [Source: _agent_docs/planning-artifacts/ux-designs/ux-Ktane-2026-06-10/mockups/tokens.css] (literal token values; `.btn-*` reference impl; do NOT adopt `stage.js`)
- [Source: _agent_docs/game-architecture.md#Project Structure] (`apps/client/src/ui/` is the non-diegetic UI home)
- [Source: _agent_docs/game-architecture.md#Technology Stack Details] (Tailwind CSS in the client stack)
- [Source: _agent_docs/game-architecture.md#State Residence Model] (Zustand = render-only, non-authoritative)
- [Source: _agent_docs/project-context.md#Web Stack & Architecture Rules / Code Organization Rules] (Tailwind; `ui/`; naming; no `@ts-ignore`)
- [Source: apps/client/src/App.tsx] (Story 1.7 socket bootstrap — preserve the effect; replace only the returned JSX)
- [Source: apps/client/src/main.tsx] (StrictMode entry — add `index.css` import; preserve StrictMode)
- [Source: _agent_docs/implementation-artifacts/1-7-client-bootstrap-react-vite-zustand-typed-socket-client.md] (store API, connection state, non-authoritative boundary)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8

### Debug Log References

- `pnpm -r exec tsc --noEmit` → 0 errors across all three workspaces (pre-commit gate).
- `pnpm --filter @bomb-squad/client build` → success; 72 modules, `index.css` 11.67 kB (gzip 3.35 kB), `index.js` 190.45 kB (gzip 60.83 kB).
- Verified generated token utilities present in built CSS: `bg-surface`, `bg-bakelite`, `text-cream`, `border-bakelite-deep`, `font-display`, `text-md`, `led-red`, `translate-y`, plus the Space Grotesk + DSEG7 `@import`s — confirms the `@theme` block is the single source for both CSS vars and utilities.
- `pnpm -r test` → shared 24 ✓, client 6 ✓, server 64 ✓. No regressions.

### Completion Notes List

- **Task 1 — Tailwind v4 + tokens (single source):** Installed `tailwindcss`/`@tailwindcss/vite` v4.3. Added the Vite plugin (no PostCSS config). Created `src/index.css` with font `@import`s → `@import 'tailwindcss'` → `@theme` block carrying every DESIGN.md token (colors/fonts/scale/radii/spacing), values mapped 1:1 from `mockups/tokens.css`. Tokens named by semantic role; the five color reservations + the no-fourth-surface rule are documented in a header comment at the point of use. Base document styling uses operator-world `--color-surface` (not pure black); global LED-green `:focus-visible` ring added. Imported `index.css` at the top of `main.tsx`.
- **Task 2 — AppShell + `ui/`:** Created `src/ui/` with `AppShell` (operator-world only — surface bg, cream ink, body font, optional header slot) and a barrel `index.ts`.
- **Task 3 — Button + ConfirmButton:** `Button` has `primary`/`secondary`/`danger` variants matched to `tokens.css .btn-*`; the tactile 2px press (`active:translate-y-0.5 active:shadow-none`) is primary-only. `ConfirmButton` is the canonical destructive two-step (`secondary` rest → inline `danger` confirm + `secondary` cancel); the confirm toggle lives in local `useState`, never Zustand. JSDoc on `Button` states primary is for safe/forward actions only.
- **Task 4 — LoadingScreen wired into App:** `LoadingScreen` is full-bleed with a `status` prop (default copy "Connecting…"); `role="status"`/`aria-live`. `App.tsx` updated to render `PlatformGate → (connection !== 'connected' ? LoadingScreen : AppShell)`; the Story 1.7 socket `useEffect` is preserved verbatim. Driven only by `gameStore.connection` (non-authoritative). Inline styles removed.
- **Task 5 — Platform/viewport gates:** Pure `platform.ts` (`isViewportTooSmall`, `isMobileUA`, `evaluateGate`) with mobile-beats-size precedence and 1280×720-inclusive minimum. `useViewportGate` bridges to `window`/`resize` with listener cleanup. `PlatformGate` renders the resize/mobile gates (verbatim ACs copy) or children, mounted as the outermost boundary in `App.tsx`.
- **Task 6 — Microcopy & guardrails:** `copy.ts` centralizes the deadpan strings (`CONNECTING`, `GATE_RESIZE`, `GATE_MOBILE`). `ui/README.md` restates the semantic color reservations, the no-fourth-surface rule, and the presentation-state-stays-out-of-Zustand rule.
- **Task 7 — Tests + gates:** Introduced Vitest (`test` → `vitest run`, added `test:watch`). `__tests__/platform.test.ts` covers the gate decision matrix (boundary inclusivity, mobile priority at large viewport, too-small desktop). Typecheck + build + full regression all green.
- **Scope held:** No bomb-world/diegetic components built (timer/LED/panel/toast deferred to their consuming epics); their tokens are defined but unconsumed, as specified.
- **Manual smoke:** Not executed at dev time (no browser/live server in that environment). Executed by Jay on 2026-06-12 against the post-code-review build: (a) operator shell renders with design fonts/colors, (b) resize below 1280×720 shows the resize gate, (c) mobile UA emulation shows the bounce screen, (d) with the server down the loading screen sits on "Connecting…". All four confirmed.
- **Code review (2026-06-12, commit 8355fda):** 3-layer adversarial review; 8 patches applied (see Review Findings) — ConfirmButton hardening (single-fire, Escape/blur disarm, focus management, Cancel in the resting position), PlatformGate overlay (children stay mounted while gated), Button literal-px paddings/press + tokens.css transition timings, `--radius-none`, `CONFIRM`/`CANCEL` centralized in `copy.ts`. Post-patch gate: typecheck 0 errors, build green, client tests 6/6.

### File List

- apps/client/package.json (modified — Tailwind v4 + Vitest deps; `test`/`test:watch` scripts)
- pnpm-lock.yaml (modified)
- apps/client/vite.config.ts (modified — `@tailwindcss/vite` plugin)
- apps/client/src/main.tsx (modified — import `./index.css`)
- apps/client/src/App.tsx (modified — PlatformGate → LoadingScreen → AppShell; socket effect preserved)
- apps/client/src/index.css (created — token `@theme` + base styles + focus ring)
- apps/client/src/ui/AppShell.tsx (created)
- apps/client/src/ui/Button.tsx (created)
- apps/client/src/ui/ConfirmButton.tsx (created)
- apps/client/src/ui/LoadingScreen.tsx (created)
- apps/client/src/ui/PlatformGate.tsx (created)
- apps/client/src/ui/useViewportGate.ts (created)
- apps/client/src/ui/platform.ts (created)
- apps/client/src/ui/copy.ts (created)
- apps/client/src/ui/index.ts (created — barrel)
- apps/client/src/ui/README.md (created — guardrails)
- apps/client/src/ui/__tests__/platform.test.ts (created)

## Change Log

- 2026-06-12: Story 2.1 implemented — Tailwind v4 design-token system (single-source `@theme`), operator-world UI shell (`AppShell`, `Button`/`ConfirmButton`, `LoadingScreen`), platform/viewport gates (`PlatformGate` + pure `platform.ts`), centralized deadpan microcopy, and Vitest with gate-logic unit tests. App bootstrap now renders platform-gate → loading → shell while preserving the Story 1.7 socket lifecycle. All typecheck/build/test gates pass; no regressions.
