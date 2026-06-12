/**
 * dev-demo — the reference module proving the Story 5.1 plugin scaffold.
 *
 * It is intentionally trivial as a puzzle but exhaustive as a contract demo:
 * its three solutions exercise every Defuser click gesture (click, press =
 * mousedown+mouseup, hold = mousedown → sustain → mouseup), its reducer
 * satisfies every project reducer obligation (purity, immutability, guards,
 * idempotency, transient 'struck', MODULE_RESET), and its files are the
 * template every real module (5.3 Wires onward) copies.
 *
 * Pure logic lives HERE in packages/shared so both the server registry
 * (MODULE_REDUCERS, runtime via tsx) and the client sandbox can run it; the
 * client dir apps/client/src/modules/dev-demo/ re-exports it (sanctioned by
 * game-architecture.md Pattern 3: "or re-export from shared").
 */

/** Module identifier — kebab-case (project naming convention). */
export const DEV_DEMO_MODULE_ID = 'dev-demo';

/**
 * Which procedure disarms this instance (derived from the seeded label).
 * 'cut-press' is a two-step sequence (cut the wire, THEN press the button) —
 * deliberately NOT a "hold X while doing Y" rule: with one mouse the left
 * button cannot be held on one target while clicking another, and pointer
 * capture during a hold would swallow the second click anyway. Simultaneous
 * gestures are physically impossible in the click-primitive model; rules
 * must be sequences. (Timed holds are The Button's territory, 5.4, judged
 * against server timer state.)
 */
export type DevDemoSolution = 'cut' | 'press' | 'cut-press';

export interface DevDemoState {
  /** Seeded: the gesture that solves this instance. */
  solution: DevDemoSolution;
  /** Seeded cosmetic tag (2 letters + serial last digit) — makes determinism visible. */
  label: string;
  /** A severed wire stays severed until MODULE_RESET (cuts are physical). */
  wireCut: boolean;
  /** Button currently pressed down (the "sustain" of a hold). */
  held: boolean;
}

/**
 * Defuser actions — discrete gesture events only. Hold duration is never a
 * wall-clock measurement: "sustained" means BUTTON_DOWN state is still active
 * when the next action arrives (no Date.now() anywhere near a reducer).
 */
export type DevDemoAction =
  | { type: 'CUT' }
  | { type: 'BUTTON_DOWN' }
  | { type: 'BUTTON_UP' };

/** Lifecycle action forwarded whole by the bomb reducer (see types/actions.ts). */
export type DevDemoReset = { type: 'MODULE_RESET' };

const ACTION_TYPES = new Set(['CUT', 'BUTTON_DOWN', 'BUTTON_UP', 'MODULE_RESET']);

/** Runtime guard: actions reach reducers as `unknown` (untrusted input). */
export function isDevDemoAction(action: unknown): action is DevDemoAction | DevDemoReset {
  return (
    typeof action === 'object' &&
    action !== null &&
    'type' in action &&
    typeof (action as { type: unknown }).type === 'string' &&
    ACTION_TYPES.has((action as { type: string }).type)
  );
}
