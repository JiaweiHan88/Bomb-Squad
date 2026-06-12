import type { ManualPage, ManualSection } from '../../types/index.js';
import { WIRES_MODULE_ID, WIRE_COLORS, WIRE_COLOR_LABELS } from './types.js';
import { WIRES_RULES } from './solve.js';

const COUNT_HEADINGS: Readonly<Record<3 | 4 | 5 | 6, string>> = {
  3: 'Three wires',
  4: 'Four wires',
  5: 'Five wires',
  6: 'Six wires',
};

const capitalize = (word: string): string => word[0].toUpperCase() + word.slice(1);

/**
 * Structured manual content — NEVER raw HTML or untyped JSX (project rule).
 * The rule tables are rendered from WIRES_RULES, the exact data solveWires()
 * evaluates: the manual the Expert reads and the solver that judges the cut
 * cannot diverge.
 */
export function getWiresManualPages(): ManualPage[] {
  const ruleSections: ManualSection[] = ([3, 4, 5, 6] as const).map((count) => ({
    heading: COUNT_HEADINGS[count],
    content: '',
    table: {
      headers: ['#', 'Condition', 'Action'],
      rows: WIRES_RULES[count].map((rule, i) => [String(i + 1), rule.conditionText, rule.actionText]),
    },
  }));

  return [
    {
      chapterId: WIRES_MODULE_ID,
      chapterTitle: 'Wires',
      sections: [
        {
          content:
            'The module shows three to six coloured wires. Cut exactly one wire to ' +
            'disarm it. Count the wires first, then apply the matching table below — ' +
            'the rules differ for every wire count. Apply the first rule that ' +
            'matches, reading top to bottom. Wire positions are counted from the ' +
            'top, starting at 1. A severed wire cannot be un-cut.',
        },
        ...ruleSections,
        {
          heading: 'Confirming colours',
          content:
            'Every wire carries a printed letter label beside it, so colour is ' +
            'never the only signal. If a colour is in doubt, have the Defuser ' +
            'read the letter aloud.',
          table: {
            headers: ['Label', 'Colour'],
            rows: WIRE_COLORS.map((color) => [WIRE_COLOR_LABELS[color], capitalize(color)]),
          },
        },
      ],
    },
  ];
}
