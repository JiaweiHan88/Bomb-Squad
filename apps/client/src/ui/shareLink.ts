/**
 * Shareable session link: query param on the root path, NOT a path route.
 * The deployed client (`vite preview` behind Caddy) has no SPA fallback, so
 * deep-link paths 404 — and the app deliberately has no router. Story 2.3
 * reads `?join=` to prefill the join-code input.
 */
export function buildShareLink(origin: string, joinCode: string): string {
  return `${origin}/?join=${encodeURIComponent(joinCode)}`;
}
