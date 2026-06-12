/**
 * The Defuser click primitive (Story 5.1, FR20 / UX-DR13).
 *
 * EXPERIENCE.md: "Click (Defuser): sole module interaction primitive. Wire
 * cut = click. Button press = mousedown+mouseup. Button hold = mousedown,
 * sustain, mouseup." Right/middle-click are reserved; there are NO bomb-side
 * keyboard shortcuts (prevents Defuser self-coaching).
 *
 * These helpers are the gesture vocabulary every DefuserView uses. They:
 * - accept only the primary button,
 * - reject drag-orbit releases (camera-controls owns left-drag),
 * - stop propagation so module-internal clicks don't re-trigger ModuleBay's
 *   click-to-focus on the faceplate behind them,
 * - emit module ACTIONS via callbacks — they know nothing about sockets or
 *   reducers. Hold duration is never measured here: "sustained" is reducer
 *   state between the press and release actions (no wall-clock game rules).
 *
 * Typed structurally (not against ThreeEvent) so the pure logic is testable
 * without an R3F canvas; R3F's ThreeEvent satisfies this shape.
 */

/** Pointer travel (px) beyond which a release is a drag-orbit, not a click.
 *  Shared with ModuleBay's click-to-focus so the two never disagree. */
export const CLICK_DRAG_TOLERANCE_PX = 4;

export interface ModulePointerEvent {
  /** 0 = primary. Right/middle are reserved (UX-DR13). */
  button: number;
  /** Screen-px travelled since pointerdown (provided by R3F). */
  delta: number;
  pointerId?: number;
  stopPropagation(): void;
  /** R3F event target — supports DOM-style pointer capture when present. */
  target?: unknown;
}

export function isPrimaryActivation(button: number, delta: number): boolean {
  return button === 0 && delta <= CLICK_DRAG_TOLERANCE_PX;
}

interface PointerCaptureTarget {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
}

/** Single-click gesture (wire cut, keypad symbol, maze cell, Morse TX…). */
export function moduleClickHandlers(onActivate: () => void): {
  onClick: (event: ModulePointerEvent) => void;
} {
  return {
    onClick: (event) => {
      // Swallow unconditionally: the module surface owns its pointer events
      // (a right-click on a wire must not bubble anywhere either).
      event.stopPropagation();
      if (!isPrimaryActivation(event.button, event.delta)) return;
      onActivate();
    },
  };
}

/**
 * Press/hold gesture (The Button, dev-demo). Press = the down+up pair in
 * quick succession; hold = down, sustain, up — the SAME event surface; what
 * the pair means is the module reducer's judgement, not the input layer's.
 *
 * The release is delivered even after a drag (no drag-tolerance check on
 * pointerup): swallowing releases risks a stuck "held" state, and a hold's
 * correctness is judged by the reducer anyway. The pointer is captured on
 * press so a release outside the mesh still arrives. A pointercancel (gesture
 * stolen by the browser / context lost) is treated as a release for the same
 * reason — a captured hold must never strand the module in `held: true`.
 *
 * stopPropagation runs before the button guard (like moduleClickHandlers):
 * the module surface owns ALL its pointer events, so a reserved-button press
 * must not bubble to ModuleBay's click-to-focus either.
 */
export function modulePressHoldHandlers(
  onPress: () => void,
  onRelease: () => void,
): {
  onPointerDown: (event: ModulePointerEvent) => void;
  onPointerUp: (event: ModulePointerEvent) => void;
  onPointerCancel: (event: ModulePointerEvent) => void;
} {
  const release = (event: ModulePointerEvent) => {
    event.stopPropagation();
    if (event.pointerId !== undefined) {
      (event.target as PointerCaptureTarget | undefined)?.releasePointerCapture?.(event.pointerId);
    }
    onRelease();
  };
  return {
    onPointerDown: (event) => {
      event.stopPropagation();
      if (event.button !== 0) return;
      if (event.pointerId !== undefined) {
        (event.target as PointerCaptureTarget | undefined)?.setPointerCapture?.(event.pointerId);
      }
      onPress();
    },
    onPointerUp: (event) => {
      if (event.button !== 0) return;
      release(event);
    },
    // Cancelled gesture (touch interrupted, browser intervention): release
    // regardless of which button — capture must be freed and the hold ended.
    onPointerCancel: release,
  };
}
