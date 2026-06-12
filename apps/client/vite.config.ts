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
});
