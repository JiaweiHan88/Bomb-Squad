import { describe, expect, it, vi } from 'vitest';
import {
  CLICK_DRAG_TOLERANCE_PX,
  isPrimaryActivation,
  moduleClickHandlers,
  modulePressHoldHandlers,
  type ModulePointerEvent,
} from '../interaction.js';

/** Minimal stand-in for an R3F ThreeEvent (the handlers are typed structurally). */
const event = (overrides: Partial<ModulePointerEvent> = {}): ModulePointerEvent => ({
  button: 0,
  delta: 0,
  pointerId: 1,
  stopPropagation: vi.fn(),
  target: undefined,
  ...overrides,
});

describe('isPrimaryActivation', () => {
  it('accepts a left click within the drag tolerance', () => {
    expect(isPrimaryActivation(0, 0)).toBe(true);
    expect(isPrimaryActivation(0, CLICK_DRAG_TOLERANCE_PX)).toBe(true);
  });

  it('rejects right/middle buttons (reserved — UX-DR13)', () => {
    expect(isPrimaryActivation(2, 0)).toBe(false);
    expect(isPrimaryActivation(1, 0)).toBe(false);
  });

  it('rejects drag-orbit releases past the tolerance', () => {
    expect(isPrimaryActivation(0, CLICK_DRAG_TOLERANCE_PX + 1)).toBe(false);
    expect(isPrimaryActivation(0, 100)).toBe(false);
  });
});

describe('moduleClickHandlers', () => {
  it('activates on a clean left click and stops propagation (no click-to-focus leak)', () => {
    const onActivate = vi.fn();
    const e = event();
    moduleClickHandlers(onActivate).onClick(e);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('ignores right-click but still swallows the event', () => {
    const onActivate = vi.fn();
    const e = event({ button: 2 });
    moduleClickHandlers(onActivate).onClick(e);
    expect(onActivate).not.toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('ignores a drag-orbit release', () => {
    const onActivate = vi.fn();
    moduleClickHandlers(onActivate).onClick(event({ delta: 12 }));
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe('modulePressHoldHandlers', () => {
  it('delivers press on left pointerdown and release on pointerup', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const handlers = modulePressHoldHandlers(onPress, onRelease);
    handlers.onPointerDown(event());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
    handlers.onPointerUp(event());
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('ignores non-left buttons entirely', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const handlers = modulePressHoldHandlers(onPress, onRelease);
    handlers.onPointerDown(event({ button: 2 }));
    handlers.onPointerUp(event({ button: 1 }));
    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('delivers the release even after a drag (no stuck-held state)', () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const handlers = modulePressHoldHandlers(onPress, onRelease);
    handlers.onPointerDown(event());
    handlers.onPointerUp(event({ delta: 50 }));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it('captures the pointer on press so off-mesh releases still arrive', () => {
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    const handlers = modulePressHoldHandlers(vi.fn(), vi.fn());
    handlers.onPointerDown(event({ target: { setPointerCapture } }));
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    handlers.onPointerUp(event({ target: { releasePointerCapture } }));
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it('tolerates targets without pointer-capture support', () => {
    const handlers = modulePressHoldHandlers(vi.fn(), vi.fn());
    expect(() => {
      handlers.onPointerDown(event({ target: {} }));
      handlers.onPointerUp(event({ target: undefined }));
    }).not.toThrow();
  });
});
