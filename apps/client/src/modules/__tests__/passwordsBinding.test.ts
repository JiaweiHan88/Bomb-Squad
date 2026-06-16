import { describe, expect, it } from 'vitest';
import { PASSWORDS_MODULE_ID, PASSWORD_WORDS } from '@bomb-squad/shared';
import { PASSWORDS_MODULE, SANDBOX_MODULES } from '../index.js';
import { getModuleRenderer } from '../registry.js';

/**
 * The client half of the plugin contract for passwords (Story 5.5): importing
 * the module barrel registers the renderer (import-time side effect) and
 * exposes the IModule binding for the sandbox.
 */
describe('passwords client binding', () => {
  it('registers its renderer via the barrel import (no scene changes)', () => {
    const renderer = getModuleRenderer(PASSWORDS_MODULE_ID);
    expect(renderer.id).toBe(PASSWORDS_MODULE_ID);
  });

  it('exposes the full IModule contract', () => {
    expect(PASSWORDS_MODULE.id).toBe(PASSWORDS_MODULE_ID);
    expect(typeof PASSWORDS_MODULE.generate).toBe('function');
    expect(typeof PASSWORDS_MODULE.reduce).toBe('function');
    const pages = PASSWORDS_MODULE.getManualPages();
    expect(pages[0].chapterId).toBe(PASSWORDS_MODULE_ID);
    // the word table lists exactly PASSWORD_WORDS
    const table = pages[0].sections.find((s) => s.table)?.table;
    expect(table?.rows.flat().filter((c) => c.length > 0)).toEqual([...PASSWORD_WORDS]);
  });

  it('is listed for the sandbox picker', () => {
    expect(SANDBOX_MODULES.some((m) => m.id === PASSWORDS_MODULE_ID)).toBe(true);
  });
});
