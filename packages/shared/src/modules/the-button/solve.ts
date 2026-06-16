import type { BombContext } from '../../types/index.js';
import type { ButtonColor, ButtonLabel, StripColor } from './types.js';

/**
 * The GDD Button rules (gdd.md #Module 2: The Button — the authoritative
 * source), encoded ONCE as data. decideButton() evaluates the predicates;
 * getButtonManualPages() renders conditionText/actionText from the very same
 * array — solver and manual are structurally incapable of diverging (the wires
 * lesson: shared rule source = both sides provably agree).
 *
 * Rules are evaluated FIRST MATCH WINS, top to bottom. The last rule always
 * matches ("None of the above"), so decideButton is total.
 */
export type ButtonDecision = 'tap' | 'hold';

export interface ButtonRule {
  /** Condition exactly as the Expert reads it in the manual. */
  readonly conditionText: string;
  /** Action exactly as the Expert reads it. */
  readonly actionText: string;
  readonly when: (color: ButtonColor, label: ButtonLabel, ctx: BombContext) => boolean;
  readonly decision: ButtonDecision;
}

/** True if an indicator with this label is present AND lit. */
const lit = (ctx: BombContext, label: string): boolean =>
  ctx.indicators.some((ind) => ind.label === label && ind.lit);

export const BUTTON_RULES: readonly ButtonRule[] = [
  {
    conditionText: 'Button is blue and the label is "Abort"',
    actionText: 'Hold the button',
    when: (color, label) => color === 'blue' && label === 'Abort',
    decision: 'hold',
  },
  {
    conditionText: 'More than 1 battery and the label is "Detonate"',
    actionText: 'Press and immediately release',
    when: (_color, label, ctx) => ctx.batteryCount > 1 && label === 'Detonate',
    decision: 'tap',
  },
  {
    conditionText: 'Button is white and a CAR indicator is lit',
    actionText: 'Hold the button',
    when: (color, _label, ctx) => color === 'white' && lit(ctx, 'CAR'),
    decision: 'hold',
  },
  {
    conditionText: 'More than 2 batteries and an FRK indicator is lit',
    actionText: 'Press and immediately release',
    when: (_color, _label, ctx) => ctx.batteryCount > 2 && lit(ctx, 'FRK'),
    decision: 'tap',
  },
  {
    conditionText: 'Button is yellow',
    actionText: 'Hold the button',
    when: (color) => color === 'yellow',
    decision: 'hold',
  },
  {
    conditionText: 'Button is red and the label is "Hold"',
    actionText: 'Press and immediately release',
    when: (color, label) => color === 'red' && label === 'Hold',
    decision: 'tap',
  },
  {
    conditionText: 'None of the above',
    actionText: 'Hold the button',
    when: () => true,
    decision: 'hold',
  },
];

/**
 * Pure decision lookup: TAP (press and immediately release) or HOLD. First
 * matching rule wins, top to bottom; the final rule always matches.
 */
export function decideButton(color: ButtonColor, label: ButtonLabel, ctx: BombContext): ButtonDecision {
  for (const rule of BUTTON_RULES) {
    if (rule.when(color, label, ctx)) return rule.decision;
  }
  /* istanbul ignore next -- the final rule's predicate is always true */
  throw new Error('the-button: no rule matched (table must end in a catch-all)');
}

/**
 * The release-strip table (GDD): a held button solves when released while the
 * displayed time shows this digit in ANY position.
 */
export const STRIP_RELEASE_DIGIT: Readonly<Record<StripColor, number>> = {
  blue: 4,
  white: 1,
  yellow: 5,
  red: 1, // "any other colour" → 1
};

/** The timer digit a held button must be released on, given its strip colour. */
export function releaseDigitFor(stripColor: StripColor): number {
  return STRIP_RELEASE_DIGIT[stripColor];
}
