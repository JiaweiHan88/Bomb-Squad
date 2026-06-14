// Vitest setup for component tests (jsdom environment — see vite.config.ts).
// Imported once before the suite via `test.setupFiles`.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount any rendered React tree after each test so the jsdom document does not
// leak nodes (or attached <audio> elements) between tests.
afterEach(() => {
  cleanup();
});
