import type { ManualPage } from '../../types/index.js';
import { PASSWORDS_MODULE_ID, PASSWORD_WORDS } from './types.js';

/** Words per row when laying the 35-word list into a table. */
const WORDS_PER_ROW = 5;

/**
 * Structured manual content — NEVER raw HTML or untyped JSX (project rule). The
 * word table renders from the exact PASSWORD_WORDS constant the solver checks
 * against, so the manual the Expert reads and the logic that judges SUBMIT
 * cannot diverge.
 */
export function getPasswordsManualPages(): ManualPage[] {
  // 35 words / 5 per row → 7 full rows, each a word per cell. Flattening the
  // rows reproduces PASSWORD_WORDS exactly (asserted in the suite).
  const rows: string[][] = [];
  for (let i = 0; i < PASSWORD_WORDS.length; i += WORDS_PER_ROW) {
    rows.push([...PASSWORD_WORDS.slice(i, i + WORDS_PER_ROW)]);
  }

  return [
    {
      chapterId: PASSWORDS_MODULE_ID,
      chapterTitle: 'Passwords',
      sections: [
        {
          content:
            'The module is five letter columns. Cycle each column up or down ' +
            'until the five visible letters spell one of the valid words below, ' +
            'then press SUBMIT. A wrong word records a strike; the columns keep ' +
            'their letters so you can keep trying.',
          table: {
            headers: ['Valid words', '', '', '', ''],
            rows,
          },
        },
      ],
    },
  ];
}
