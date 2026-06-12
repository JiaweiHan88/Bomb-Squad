/**
 * Pure letterbox math for the bomb stage (no React, no DOM).
 *
 * The bomb scene is framed for the 16:9 design baseline (EXPERIENCE.md
 * "Responsive & Platform"). The stage is the largest 16:9 box that fits the
 * viewport — wider viewports (21:9) get vertical bars left/right, taller
 * viewports (16:10) get horizontal bars top/bottom. Because the chassis is
 * framed within the 16:9 box, fitting the box guarantees the chassis is
 * never cropped.
 */
export interface StageSize {
  width: number;
  height: number;
}

export const STAGE_ASPECT = 16 / 9;

export function computeStageSize(
  viewportW: number,
  viewportH: number,
  aspect: number = STAGE_ASPECT,
): StageSize {
  if (
    !Number.isFinite(viewportW) ||
    !Number.isFinite(viewportH) ||
    !Number.isFinite(aspect) ||
    viewportW <= 0 ||
    viewportH <= 0 ||
    aspect <= 0
  ) {
    return { width: 0, height: 0 };
  }

  if (viewportW / viewportH > aspect) {
    // Viewport wider than the stage aspect → full height, bars left/right.
    return { width: viewportH * aspect, height: viewportH };
  }
  // Viewport taller/narrower than the stage aspect → full width, bars top/bottom.
  return { width: viewportW, height: viewportW / aspect };
}
