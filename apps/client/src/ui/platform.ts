/**
 * Pure platform-gate decision logic (no React, no DOM) so it is unit-testable.
 *
 * Gate result precedence (EXPERIENCE.md "Responsive & Platform"):
 *   1. mobile browser        -> bounce screen
 *   2. viewport < 1280×720   -> resize gate
 *   3. otherwise             -> render the app
 */
export type GateResult = 'ok' | 'mobile' | 'too-small';

/** Minimum supported viewport is 1280×720 inclusive. */
export const MIN_WIDTH = 1280;
export const MIN_HEIGHT = 720;

export function isViewportTooSmall(width: number, height: number): boolean {
  return width < MIN_WIDTH || height < MIN_HEIGHT;
}

/** Conservative mobile sniff — V1 is desktop-only, so we only need to bounce phones/tablets. */
export function isMobileUA(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(userAgent);
}

export interface GateInput {
  width: number;
  height: number;
  userAgent: string;
}

/**
 * Mobile takes priority over the size check: a phone can report an odd large
 * viewport (landscape, DPR quirks) yet still must be bounced.
 */
export function evaluateGate({ width, height, userAgent }: GateInput): GateResult {
  if (isMobileUA(userAgent)) return 'mobile';
  if (isViewportTooSmall(width, height)) return 'too-small';
  return 'ok';
}
