import { useMemo } from 'react';
import ManualViewer from './ManualViewer.js';
import { buildChapters } from './chapters.js';
import { DEV_MANUAL_PAGES } from './devManualFixtures.js';

/**
 * Dev harness for the manual viewer (Story 5.2) — mounted at `/dev/manual` by
 * App.tsx, mirroring the `/dev/bomb` + DevBombHarness pattern. Feeds fixture
 * pages through the same buildChapters path real module content will use.
 * No session exists here, so navigation updates the observable uiStore
 * position but emits nothing (see publishPosition.ts).
 */
export default function DevManualHarness() {
  const chapters = useMemo(() => buildChapters(DEV_MANUAL_PAGES), []);
  return <ManualViewer chapters={chapters} />;
}
