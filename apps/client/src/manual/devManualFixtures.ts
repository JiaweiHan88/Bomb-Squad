import type { ManualPage } from '@bomb-squad/shared';

/**
 * DEV FIXTURES for `/dev/manual` ONLY — not game content.
 *
 * Canonical manual content ships per-module via `IModule.getManualPages()`
 * starting with Wires in Story 5.3. These fixtures exist so the viewer can be
 * built/verified before any real module lands: the 11 chapter titles from the
 * mockup, the Wires 3/4/5/6 rule tables (verbatim from the mockup, to exercise
 * table rendering + color-word emphasis), a multi-page chapter (grouping), and
 * a long chapter (scroll memory).
 */

const RULE_HEADERS = ['#', 'Condition', 'Action'];

const stub = (chapterId: string, chapterTitle: string): ManualPage => ({
  chapterId,
  chapterTitle,
  sections: [
    {
      content: `Placeholder for the ${chapterTitle} chapter. Authored module manual content arrives with the ${chapterTitle} module story via getManualPages().`,
    },
  ],
});

export const DEV_MANUAL_PAGES: ManualPage[] = [
  {
    chapterId: 'wires',
    chapterTitle: 'Wires',
    sections: [
      {
        content:
          'The module shows three to six coloured wires. Cut exactly one wire to disarm it. Count the wires first, then apply the matching table below — the rules differ for every wire count. Apply the first rule that matches, reading top to bottom.',
      },
      {
        heading: 'Three wires',
        content: '',
        table: {
          headers: RULE_HEADERS,
          rows: [
            ['1', 'No red wires', 'cut the 2nd'],
            ['2', 'Last wire is white', 'cut the last'],
            ['3', 'More than one blue wire', 'cut last blue'],
            ['4', 'Otherwise', 'cut the last'],
          ],
        },
      },
      {
        heading: 'Four wires',
        content: '',
        table: {
          headers: RULE_HEADERS,
          rows: [
            ['1', 'More than one red & last serial digit odd', 'cut last red'],
            ['2', 'Last wire yellow & no red', 'cut the 1st'],
            ['3', 'Exactly one blue wire', 'cut the 1st'],
            ['4', 'More than one yellow wire', 'cut the last'],
            ['5', 'Otherwise', 'cut the 2nd'],
          ],
        },
      },
      {
        heading: 'Five wires',
        content: '',
        table: {
          headers: RULE_HEADERS,
          rows: [
            ['1', 'Last wire black & last serial digit odd', 'cut the 4th'],
            ['2', 'One red & more than one yellow', 'cut the 1st'],
            ['3', 'No black wires', 'cut the 2nd'],
            ['4', 'Otherwise', 'cut the 1st'],
          ],
        },
      },
      {
        heading: 'Six wires',
        content: '',
        table: {
          headers: RULE_HEADERS,
          rows: [
            ['1', 'No yellow & last serial digit odd', 'cut the 3rd'],
            ['2', 'One yellow & more than one white', 'cut the 4th'],
            ['3', 'No red wires', 'cut the last'],
            ['4', 'Otherwise', 'cut the 4th'],
          ],
        },
      },
    ],
  },
  // Two pages → exercises chapter grouping (buildChapters).
  {
    chapterId: 'the-button',
    chapterTitle: 'The Button',
    sections: [
      {
        heading: 'Pressing or holding',
        content:
          'Placeholder page 1 for The Button. Evaluate the press/hold decision rules in order; the first matching rule wins.',
      },
    ],
  },
  {
    chapterId: 'the-button',
    chapterTitle: 'The Button',
    sections: [
      {
        heading: 'Releasing a held button',
        content:
          'Placeholder page 2 for The Button. A held button shows a coloured release strip; release when the timer shows the matching digit.',
      },
    ],
  },
  stub('keypads', 'Keypads'),
  stub('simon-says', 'Simon Says'),
  // Long chapter → exercises per-chapter scroll memory (AC2).
  {
    chapterId: 'memory',
    chapterTitle: 'Memory',
    sections: Array.from({ length: 14 }, (_, i) => ({
      heading: `Stage note ${i + 1}`,
      content:
        'Long placeholder section so this chapter scrolls well past one sheet. Flip away and back: the manual must return to exactly this spot. A defuser under time pressure cannot afford a lost place.',
    })),
  },
  stub('morse-code', 'Morse Code'),
  stub('complicated-wires', 'Complicated Wires'),
  stub('wire-sequences', 'Wire Sequences'),
  stub('whos-on-first', "Who's on First"),
  stub('passwords', 'Passwords'),
  stub('mazes', 'Mazes'),
];
