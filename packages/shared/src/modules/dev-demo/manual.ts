import type { ManualPage } from '../../types/index.js';
import { DEV_DEMO_MODULE_ID } from './types.js';

/**
 * Structured manual content — NEVER raw HTML or untyped JSX (project rule).
 * The Expert manual viewer (Story 5.2) and the Spectator mirror (9.4) render
 * this data; modules only describe it.
 */
export function getDevDemoManualPages(): ManualPage[] {
  return [
    {
      chapterId: DEV_DEMO_MODULE_ID,
      chapterTitle: 'On the Subject of the Test Rig',
      sections: [
        {
          content:
            'A diagnostics rig: one wire, one button, and a stencilled tag. ' +
            'The tag’s trailing digit always matches the last character of ' +
            'the bomb’s serial number. The FIRST letter of the tag selects ' +
            'the disarm procedure below. Perform exactly that procedure.',
        },
        {
          heading: 'Disarm procedure',
          content:
            'Have the Defuser read the tag aloud, find the row for its first ' +
            'letter, and perform that action. Any other completed interaction ' +
            'records a strike.',
          table: {
            headers: ['First letter of tag', 'Defuser action'],
            rows: [
              ['A – I', 'Cut the wire (single click).'],
              ['J – R', 'Press and immediately release the button.'],
              ['S – Z', 'Cut the wire first, THEN press and release the button.'],
            ],
          },
        },
        {
          heading: 'Caution',
          content:
            'A severed wire cannot be un-cut. If the wire is cut in error, the ' +
            'rig can only be restored by a bench reset.',
        },
      ],
    },
  ];
}
