import type { ManualPage } from '@bomb-squad/shared';
import { getWiresManualPages } from '@bomb-squad/shared';

/**
 * DEV FIXTURES for `/dev/manual` ONLY — not game content.
 *
 * Canonical manual content ships per-module via `IModule.getManualPages()`
 * starting with Wires in Story 5.3. These fixtures exist so the viewer can be
 * built/verified before any real module lands: the 11 chapter titles from the
 * mockup, a multi-page chapter (grouping), and a long chapter (scroll memory).
 * Wires is the exception: its chapter is the CANONICAL module content from
 * getWiresManualPages() (Story 5.3), not a fixture.
 */

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
  // Wires: CANONICAL content from the module's getManualPages() (Story 5.3) —
  // the rule tables render from the same data solveWires() evaluates.
  ...getWiresManualPages(),
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
