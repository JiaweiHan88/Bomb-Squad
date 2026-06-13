import { describe, expect, it } from 'vitest';
import { WIRES_MODULE_ID } from '@bomb-squad/shared';
import { WIRES_MODULE, SANDBOX_MODULES } from '../index.js';
import { getModuleRenderer } from '../registry.js';

/**
 * The client half of the plugin contract for wires (Story 5.3): importing the
 * module barrel registers the renderer (import-time side effect) and exposes
 * the IModule binding for the sandbox.
 */
describe('wires client binding', () => {
  it('registers its renderer via the barrel import (no scene changes)', () => {
    const renderer = getModuleRenderer(WIRES_MODULE_ID);
    expect(renderer.id).toBe(WIRES_MODULE_ID);
  });

  it('exposes the full IModule contract', () => {
    expect(WIRES_MODULE.id).toBe(WIRES_MODULE_ID);
    expect(typeof WIRES_MODULE.generate).toBe('function');
    expect(typeof WIRES_MODULE.reduce).toBe('function');
    const pages = WIRES_MODULE.getManualPages();
    expect(pages[0].chapterId).toBe(WIRES_MODULE_ID);
    expect(pages[0].sections.filter((s) => s.table?.headers[0] === '#')).toHaveLength(4);
  });

  it('is listed for the sandbox picker', () => {
    expect(SANDBOX_MODULES.some((m) => m.id === WIRES_MODULE_ID)).toBe(true);
  });
});
