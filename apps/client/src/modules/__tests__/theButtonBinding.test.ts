import { describe, expect, it } from 'vitest';
import { BUTTON_MODULE_ID } from '@bomb-squad/shared';
import { BUTTON_MODULE, SANDBOX_MODULES } from '../index.js';
import { getModuleRenderer } from '../registry.js';

/**
 * The client half of the plugin contract for the-button (Story 5.4): importing
 * the module barrel registers the renderer (import-time side effect) and
 * exposes the IModule binding for the sandbox.
 */
describe('the-button client binding', () => {
  it('registers its renderer via the barrel import (no scene changes)', () => {
    const renderer = getModuleRenderer(BUTTON_MODULE_ID);
    expect(renderer.id).toBe(BUTTON_MODULE_ID);
  });

  it('exposes the full IModule contract', () => {
    expect(BUTTON_MODULE.id).toBe(BUTTON_MODULE_ID);
    expect(typeof BUTTON_MODULE.generate).toBe('function');
    expect(typeof BUTTON_MODULE.reduce).toBe('function');
    const pages = BUTTON_MODULE.getManualPages();
    expect(pages[0].chapterId).toBe(BUTTON_MODULE_ID);
    // decision table + release table both present
    expect(pages[0].sections.some((s) => s.table?.headers.includes('Condition'))).toBe(true);
    expect(pages[0].sections.some((s) => s.heading === 'Releasing a held button')).toBe(true);
  });

  it('is listed for the sandbox picker', () => {
    expect(SANDBOX_MODULES.some((m) => m.id === BUTTON_MODULE_ID)).toBe(true);
  });
});
