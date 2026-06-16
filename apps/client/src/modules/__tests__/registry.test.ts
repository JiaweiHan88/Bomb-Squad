import { describe, expect, it } from 'vitest';
import {
  getModuleRenderer,
  registerModuleRenderer,
  selectModuleRenderer,
  type ModuleRenderer,
} from '../registry.js';
import { PLACEHOLDER_RENDERER } from '../PlaceholderModule.js';

const makeRenderer = (id: string): ModuleRenderer => ({
  id,
  DefuserView: () => null,
});

describe('module renderer registry', () => {
  it('falls back to the placeholder renderer for unregistered ids — never undefined, never throws', () => {
    const renderer = getModuleRenderer('no-such-module');
    expect(renderer).toBe(PLACEHOLDER_RENDERER);
    expect(typeof renderer.DefuserView).toBe('function');
  });

  it('placeholder also covers the dev-harness placeholder id until Epic 5 registers real modules', () => {
    expect(getModuleRenderer('placeholder')).toBe(PLACEHOLDER_RENDERER);
  });

  it('returns a registered renderer by id', () => {
    const wires = makeRenderer('test-wires');
    registerModuleRenderer(wires);
    expect(getModuleRenderer('test-wires')).toBe(wires);
  });

  it('registration is additive — other ids still fall back', () => {
    registerModuleRenderer(makeRenderer('test-additive'));
    expect(getModuleRenderer('test-additive')).not.toBe(PLACEHOLDER_RENDERER);
    expect(getModuleRenderer('still-unknown')).toBe(PLACEHOLDER_RENDERER);
  });

  it('throws on duplicate registration (fail-loud, HealthRegistry precedent)', () => {
    registerModuleRenderer(makeRenderer('test-dup'));
    expect(() => registerModuleRenderer(makeRenderer('test-dup'))).toThrow(/test-dup/);
  });
});

describe('selectModuleRenderer (Story 4.6 prep value-free guarantee)', () => {
  it('forces the placeholder renderer for every id when typesOnly — even a registered one', () => {
    const real = makeRenderer('test-prep-registered');
    registerModuleRenderer(real);
    // Live round resolves the real renderer...
    expect(selectModuleRenderer('test-prep-registered', false)).toBe(real);
    // ...but Preparation never draws a value-bearing face.
    expect(selectModuleRenderer('test-prep-registered', true)).toBe(PLACEHOLDER_RENDERER);
  });

  it('falls back to the placeholder for unknown ids in the live round (typesOnly === false)', () => {
    expect(selectModuleRenderer('still-unknown-2', false)).toBe(PLACEHOLDER_RENDERER);
  });
});
