/**
 * the-button — The Button module (Story 5.4, FR22).
 *
 * A single coloured button with a printed label. The correct interaction —
 * a quick TAP, or a HOLD released at a specific timer digit — is decided by
 * the GDD rule table (solve.ts) evaluated against the button's colour/label
 * and the bomb context (battery count + lit indicators).
 *
 * The information asymmetry, pure-logic-in-shared, and recompute-at-interaction
 * (never store the answer) conventions all follow the wires walking skeleton
 * (Story 5.3). The one new wrinkle is the LIVE TIMER: a held button solves only
 * when released at a matching displayed digit. The clock never enters the
 * reducer as a wall-clock read — the displayed digits ride in on the RELEASE
 * action (see ButtonAction), so the reducer stays pure (project-context:
 * "pass time as state input").
 */

import type { BombContext } from '../../types/index.js';

/** Module identifier — kebab-case (project naming convention). */
export const BUTTON_MODULE_ID = 'the-button';

/** The four button colours the GDD decision table references. */
export const BUTTON_COLORS = ['red', 'blue', 'white', 'yellow'] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

/** The four printed labels (GDD). The decision rules reference Abort/Detonate/Hold. */
export const BUTTON_LABELS = ['Abort', 'Detonate', 'Hold', 'Press'] as const;
export type ButtonLabel = (typeof BUTTON_LABELS)[number];

/** Release-strip colours (GDD release table). */
export const STRIP_COLORS = ['blue', 'white', 'yellow', 'red'] as const;
export type StripColor = (typeof STRIP_COLORS)[number];

/**
 * Mono letter labels so colour is never the only signal (colorblind floor,
 * DESIGN.md). Shared by the button face, the release strip, and the manual so
 * both sides of the asymmetry name colours the same way. K is unused here (no
 * black) but the convention matches wires' R/W/B/Y.
 */
export const BUTTON_COLOR_LABELS: Readonly<Record<ButtonColor | StripColor, string>> = {
  red: 'R',
  white: 'W',
  blue: 'B',
  yellow: 'Y',
};

export interface ButtonState {
  readonly color: ButtonColor;
  readonly label: ButtonLabel;
  /** The strip that lights up while the button is held (revealed on PRESS). */
  readonly stripColor: StripColor;
  /** True between a PRESS and its RELEASE — the strip is visible while held. */
  readonly held: boolean;
  /**
   * Public bomb context (serial / batteries / ports / indicators) — all
   * visible on the bomb face, NOT secret. The reducer recomputes the correct
   * action via decideButton(color, label, ctx) at interaction time, so the
   * answer is never stored in module data and never crosses to the client
   * (Sprint 2 retro AI1 — recompute at interaction time, nothing to strip).
   */
  readonly ctx: BombContext;
}

/**
 * Defuser actions. The input layer (modulePressHoldHandlers) NEVER measures
 * hold duration — it emits PRESS on pointer-down and RELEASE on pointer-up, and
 * the reducer judges what the pair meant (interaction.ts contract). RELEASE
 * carries the digits currently shown on the timer LCD; the reducer checks "a 4
 * in any position" as a pure `digits.includes(n)`.
 */
export type ButtonAction =
  | { type: 'PRESS' }
  | { type: 'RELEASE'; timerDigits: number[] };

/** Lifecycle action forwarded whole by the bomb reducer (see types/actions.ts). */
export type ButtonReset = { type: 'MODULE_RESET' };

/** Runtime guard: actions reach reducers as `unknown` (untrusted input). */
export function isButtonAction(action: unknown): action is ButtonAction | ButtonReset {
  if (typeof action !== 'object' || action === null || !('type' in action)) return false;
  const type = (action as { type: unknown }).type;
  if (type === 'MODULE_RESET' || type === 'PRESS') return true;
  if (type !== 'RELEASE') return false;
  const digits = (action as { timerDigits?: unknown }).timerDigits;
  return Array.isArray(digits) && digits.every((d) => typeof d === 'number');
}
