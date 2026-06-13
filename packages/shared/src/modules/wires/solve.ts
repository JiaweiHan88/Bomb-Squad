import type { BombContext } from '../../types/index.js';
import type { WireColor } from './types.js';

/**
 * The GDD Wires rule tables (gdd.md #Module 1: Wires — the authoritative
 * source), encoded ONCE as data. solveWires() evaluates the predicates;
 * getWiresManualPages() renders conditionText/actionText from the very same
 * arrays — solver and manual are structurally incapable of diverging (the
 * dev-demo lesson: shared rule source = both sides provably agree).
 *
 * Rules are evaluated FIRST MATCH WINS, top to bottom. Every table ends in an
 * "Otherwise" row, so every configuration has exactly one solution.
 */
export interface WiresRule {
  /** Condition exactly as the Expert reads it in the manual. */
  readonly conditionText: string;
  /** Action exactly as the Expert reads it ("cut the 2nd" — 1-based prose). */
  readonly actionText: string;
  readonly when: (colors: readonly WireColor[], ctx: BombContext) => boolean;
  /** 0-based index of the wire to cut. Only called when `when` matched. */
  readonly cut: (colors: readonly WireColor[]) => number;
}

const count = (colors: readonly WireColor[], color: WireColor): number =>
  colors.filter((c) => c === color).length;

const last = (colors: readonly WireColor[]): WireColor => colors[colors.length - 1];

const lastIndexOf = (colors: readonly WireColor[], color: WireColor): number =>
  colors.lastIndexOf(color);

/** BombContext guarantees the serial's last character is a digit (0–9). */
const serialLastDigitOdd = (ctx: BombContext): boolean => {
  const digit = ctx.serialNumber.charCodeAt(ctx.serialNumber.length - 1) - 48;
  return digit % 2 === 1;
};

const always = () => true;

export const WIRES_RULES: Readonly<Record<3 | 4 | 5 | 6, readonly WiresRule[]>> = {
  3: [
    {
      conditionText: 'No red wires',
      actionText: 'cut the 2nd',
      when: (c) => count(c, 'red') === 0,
      cut: () => 1,
    },
    {
      conditionText: 'Last wire is white',
      actionText: 'cut the last',
      when: (c) => last(c) === 'white',
      cut: (c) => c.length - 1,
    },
    {
      conditionText: 'More than one blue wire',
      actionText: 'cut the last blue',
      when: (c) => count(c, 'blue') > 1,
      cut: (c) => lastIndexOf(c, 'blue'),
    },
    {
      conditionText: 'Otherwise',
      actionText: 'cut the last',
      when: always,
      cut: (c) => c.length - 1,
    },
  ],
  4: [
    {
      conditionText: 'More than one red wire & last serial digit odd',
      actionText: 'cut the last red',
      when: (c, ctx) => count(c, 'red') > 1 && serialLastDigitOdd(ctx),
      cut: (c) => lastIndexOf(c, 'red'),
    },
    {
      conditionText: 'Last wire is yellow & no red wires',
      actionText: 'cut the 1st',
      when: (c) => last(c) === 'yellow' && count(c, 'red') === 0,
      cut: () => 0,
    },
    {
      conditionText: 'Exactly one blue wire',
      actionText: 'cut the 1st',
      when: (c) => count(c, 'blue') === 1,
      cut: () => 0,
    },
    {
      conditionText: 'More than one yellow wire',
      actionText: 'cut the last',
      when: (c) => count(c, 'yellow') > 1,
      cut: (c) => c.length - 1,
    },
    {
      conditionText: 'Otherwise',
      actionText: 'cut the 2nd',
      when: always,
      cut: () => 1,
    },
  ],
  5: [
    {
      conditionText: 'Last wire is black & last serial digit odd',
      actionText: 'cut the 4th',
      when: (c, ctx) => last(c) === 'black' && serialLastDigitOdd(ctx),
      cut: () => 3,
    },
    {
      conditionText: 'Exactly one red wire & more than one yellow wire',
      actionText: 'cut the 1st',
      when: (c) => count(c, 'red') === 1 && count(c, 'yellow') > 1,
      cut: () => 0,
    },
    {
      conditionText: 'No black wires',
      actionText: 'cut the 2nd',
      when: (c) => count(c, 'black') === 0,
      cut: () => 1,
    },
    {
      conditionText: 'Otherwise',
      actionText: 'cut the 1st',
      when: always,
      cut: () => 0,
    },
  ],
  6: [
    {
      conditionText: 'No yellow wires & last serial digit odd',
      actionText: 'cut the 3rd',
      when: (c, ctx) => count(c, 'yellow') === 0 && serialLastDigitOdd(ctx),
      cut: () => 2,
    },
    {
      conditionText: 'Exactly one yellow wire & more than one white wire',
      actionText: 'cut the 4th',
      when: (c) => count(c, 'yellow') === 1 && count(c, 'white') > 1,
      cut: () => 3,
    },
    {
      conditionText: 'No red wires',
      actionText: 'cut the last',
      when: (c) => count(c, 'red') === 0,
      cut: (c) => c.length - 1,
    },
    {
      conditionText: 'Otherwise',
      actionText: 'cut the 4th',
      when: always,
      cut: () => 3,
    },
  ],
};

/**
 * Pure solution lookup: the 0-based index of the one correct wire for this
 * colour layout and bomb context. First matching rule wins, top to bottom.
 * Throws only on a wire count generate() can never produce.
 */
export function solveWires(colors: readonly WireColor[], ctx: BombContext): number {
  const rules = WIRES_RULES[colors.length as 3 | 4 | 5 | 6];
  if (!rules) {
    throw new Error(`wires: unsupported wire count ${colors.length} (legal range 3–6)`);
  }
  for (const rule of rules) {
    if (rule.when(colors, ctx)) return rule.cut(colors);
  }
  /* istanbul ignore next -- every table ends in an always-true Otherwise row */
  throw new Error('wires: no rule matched (tables must end in Otherwise)');
}
