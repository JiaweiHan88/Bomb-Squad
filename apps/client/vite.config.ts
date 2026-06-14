/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: {
    // The preview server runs behind Caddy, which forwards the original Host
    // header. Vite ≥6.0.9 rejects non-localhost Hosts by default, which would
    // 403 every page load on a real domain. The container is only reachable
    // via Caddy (and the published debug port), so allowing all hosts is safe.
    allowedHosts: true,
  },
  test: {
    // jsdom gives DOM/window/sessionStorage so React components can be rendered
    // and queried. It is a superset of the node env the pure-logic tests ran in,
    // so those keep passing. See src/test/setup.ts for jest-dom matchers + cleanup.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Mock/stub hygiene for the project-wide convention: restore spies and undo
    // vi.stubGlobal between tests so e.g. identity.test.ts's sessionStorage stub
    // and connectVoice.test.ts's spies can't leak within a file. (Vitest per-file
    // isolation already prevents cross-file leakage; this covers within-file.)
    restoreMocks: true,
    unstubGlobals: true,
  },
});
