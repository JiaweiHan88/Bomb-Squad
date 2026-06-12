import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchModuleAction, setModuleActionDispatch } from '../dispatch.js';

afterEach(() => {
  setModuleActionDispatch(null);
  vi.restoreAllMocks();
});

describe('module action dispatch seam', () => {
  it('routes actions to the installed backend', () => {
    const backend = vi.fn();
    setModuleActionDispatch(backend);
    dispatchModuleAction(2, { type: 'CUT' });
    expect(backend).toHaveBeenCalledWith(2, { type: 'CUT' });
  });

  it('drops (with a warning) when no backend is installed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => dispatchModuleAction(0, { type: 'CUT' })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('uninstalling restores the no-backend behavior', () => {
    const backend = vi.fn();
    setModuleActionDispatch(backend);
    setModuleActionDispatch(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dispatchModuleAction(0, {});
    expect(backend).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });
});
