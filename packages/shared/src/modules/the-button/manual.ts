import type { ManualPage } from '../../types/index.js';
import { BUTTON_MODULE_ID, STRIP_COLORS, BUTTON_COLOR_LABELS } from './types.js';
import { BUTTON_RULES, STRIP_RELEASE_DIGIT } from './solve.js';

const capitalize = (word: string): string => word[0].toUpperCase() + word.slice(1);

/**
 * Structured manual content — NEVER raw HTML or untyped JSX (project rule).
 * Both tables render from the exact data the solver evaluates (BUTTON_RULES,
 * STRIP_RELEASE_DIGIT): the manual the Expert reads and the logic that judges
 * the interaction cannot diverge.
 */
export function getButtonManualPages(): ManualPage[] {
  return [
    {
      chapterId: BUTTON_MODULE_ID,
      chapterTitle: 'The Button',
      sections: [
        {
          content:
            'The module is a single coloured button with a printed label. ' +
            'Decide whether to PRESS-and-immediately-release or to HOLD by ' +
            'reading the rules below top to bottom and applying the first one ' +
            'that matches.',
          table: {
            headers: ['#', 'Condition', 'Action'],
            rows: BUTTON_RULES.map((rule, i) => [String(i + 1), rule.conditionText, rule.actionText]),
          },
        },
        {
          heading: 'Releasing a held button',
          content:
            'When you hold the button, a coloured strip lights up on its right ' +
            'side. Keep holding and release the button when the countdown shows ' +
            'the matching digit in ANY position.',
          table: {
            headers: ['Strip', 'Release when the timer shows'],
            rows: STRIP_COLORS.map((color) => [
              `${BUTTON_COLOR_LABELS[color]} — ${capitalize(color)}`,
              `a ${STRIP_RELEASE_DIGIT[color]} in any position`,
            ]),
          },
        },
        {
          heading: 'Confirming colours',
          content:
            'The button and its release strip each carry a printed letter (R, ' +
            'W, B, Y) so colour is never the only signal. If a colour is in ' +
            'doubt, have the Defuser read the letter aloud.',
        },
      ],
    },
  ];
}
