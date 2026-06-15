import type { ManualPage } from '@bomb-squad/shared';
import { getWiresManualPages, getButtonManualPages } from '@bomb-squad/shared';

/**
 * DEV FIXTURES for `/dev/manual` ONLY — not game content.
 *
 * Canonical manual content ships per-module via `IModule.getManualPages()`
 * starting with Wires in Story 5.3. These fixtures exist so the viewer can be
 * built/verified before any real module lands: the 11 chapter titles from the
 * mockup, a multi-page chapter (grouping), and a long chapter (scroll memory).
 * Wires (5.3) and The Button (5.4) are the exceptions: their chapters are the
 * CANONICAL module content from getWiresManualPages() / getButtonManualPages(),
 * not fixtures. Remaining stubs are replaced as each module story lands.
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
  // The Button: CANONICAL content from the module's getManualPages() (Story 5.4)
  // — the decision + release tables render from the same data the solver uses.
  ...getButtonManualPages(),
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
