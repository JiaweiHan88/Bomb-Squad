# `ui/` — operator-world (non-diegetic) UI

Shared primitives + design-token system for every non-diegetic surface (landing,
lobby, dashboard, gates, loading). The bomb chassis / HUD (diegetic, R3F) lives in
`scenes/` and `modules/` from Epic 4 — **do not** mix bomb-world tokens in here.

## Design tokens

Tokens are defined once in `src/index.css` as a Tailwind v4 `@theme` block (mapped
1:1 from `DESIGN.md`). Each token emits a CSS variable **and** a matching utility
(`--color-bakelite` → `bg-bakelite`/`text-bakelite`; `--font-body` → `font-body`).
That is the single source of truth — never hardcode hex/px that a token already
covers, and never add a JS Tailwind theme.

## Two rules that do not bend

**Semantic color reservations** (never decorative):

| Token            | Reserved meaning                          |
| ---------------- | ----------------------------------------- |
| `led-green`      | solved / safe / armed-clear               |
| `led-red`        | strike / error / explode                  |
| `led-amber`      | caution / strike-1 escalation             |
| `speaker-self`   | "this is you" — voice presence **only**   |
| `cream`          | manual / printed-paper content            |

**No fourth UI surface.** There are exactly three: the bomb (diegetic 3D), HUD
overlays (flat 2D on the scene), and modal-or-manual. Don't invent a fourth.

## Component rules

- `Button` `primary` = safe/forward actions only. Tactile 2px press is primary-only.
- Destructive/irreversible actions go through `ConfirmButton` (two-step, `danger`).
- Presentation state (confirm toggle, gate result) stays in `useState` — never in
  Zustand. Stores hold server snapshots only.
- Operator microcopy is dry/deadpan/period-appropriate — add new strings to `copy.ts`.
