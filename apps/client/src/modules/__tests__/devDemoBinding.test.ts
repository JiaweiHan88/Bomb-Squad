import { describe, expect, it } from 'vitest';
import { DEV_DEMO_MODULE_ID } from '@bomb-squad/shared';
import { DEV_DEMO_MODULE, SANDBOX_MODULES } from '../index.js';
import { getModuleRenderer } from '../registry.js';

/**
 * The client half of the plugin contract (AC1/AC2): importing the module
 * barrel registers the renderer (import-time side effect) and exposes the
 * IModule binding for the sandbox.
 */
describe('dev-demo client binding', () => {
  it('registers its renderer via the barrel import (no scene changes)', () => {
    const renderer = getModuleRenderer(DEV_DEMO_MODULE_ID);
    expect(renderer.id).toBe(DEV_DEMO_MODULE_ID);
  });

  it('exposes the full IModule contract', () => {
    expect(DEV_DEMO_MODULE.id).toBe(DEV_DEMO_MODULE_ID);
    expect(typeof DEV_DEMO_MODULE.generate).toBe('function');
    expect(typeof DEV_DEMO_MODULE.reduce).toBe('function');
    const pages = DEV_DEMO_MODULE.getManualPages();
    expect(pages[0].chapterId).toBe(DEV_DEMO_MODULE_ID);
    expect(pages[0].sections.length).toBeGreaterThan(0);
  });

  it('is listed for the sandbox picker', () => {
    expect(SANDBOX_MODULES.some((m) => m.id === DEV_DEMO_MODULE_ID)).toBe(true);
  });
});
