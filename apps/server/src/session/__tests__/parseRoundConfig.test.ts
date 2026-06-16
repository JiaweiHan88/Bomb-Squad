import { describe, expect, it } from '@jest/globals';
import type { RoundConfig } from '@bomb-squad/shared';
import { parseRoundConfig } from '../parseRoundConfig.js';

const fullConfig: RoundConfig = {
  difficulty: 'medium',
  moduleCount: 5,
  timerMs: 360_000,
  strikeSpeedUpPct: 25,
  modulePool: ['wires', 'the-button'],
  modifiers: { asymmetricExpertRoles: true, spectatorLifelines: false },
};

describe('parseRoundConfig — full mode (ROUND_CONFIGURE)', () => {
  it('accepts a complete valid config and returns a FRESH object', () => {
    const res = parseRoundConfig(fullConfig, { full: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config).toEqual(fullConfig);
    expect(res.config).not.toBe(fullConfig); // never the input reference
    expect(res.config.modifiers).not.toBe(fullConfig.modifiers);
    expect(res.config.modulePool).not.toBe(fullConfig.modulePool);
  });

  it('accepts a complete config without modulePool (tier-default pool)', () => {
    const { modulePool: _omit, ...noPool } = fullConfig;
    const res = parseRoundConfig(noPool, { full: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config.modulePool).toBeUndefined();
  });

  it.each([
    ['missing difficulty', { ...fullConfig, difficulty: undefined }],
    ['missing moduleCount', { ...fullConfig, moduleCount: undefined }],
    ['missing timerMs', { ...fullConfig, timerMs: undefined }],
    ['missing strikeSpeedUpPct', { ...fullConfig, strikeSpeedUpPct: undefined }],
    ['missing modifiers', { ...fullConfig, modifiers: undefined }],
  ])('rejects a config %s', (_label, cfg) => {
    const res = parseRoundConfig(cfg, { full: true });
    expect(res.ok).toBe(false);
  });

  it('requires BOTH modifier flags in full mode', () => {
    const res = parseRoundConfig(
      { ...fullConfig, modifiers: { asymmetricExpertRoles: true } },
      { full: true },
    );
    expect(res.ok).toBe(false);
  });
});

describe('parseRoundConfig — range and shape validation', () => {
  it.each([
    ['moduleCount 2 (below range)', { ...fullConfig, moduleCount: 2 }],
    ['moduleCount 12 (above range)', { ...fullConfig, moduleCount: 12 }],
    ['moduleCount non-integer', { ...fullConfig, moduleCount: 4.5 }],
    ['strikeSpeedUpPct -1', { ...fullConfig, strikeSpeedUpPct: -1 }],
    ['strikeSpeedUpPct 51', { ...fullConfig, strikeSpeedUpPct: 51 }],
    ['timerMs 0', { ...fullConfig, timerMs: 0 }],
    ['unknown difficulty', { ...fullConfig, difficulty: 'extreme' }],
    ['unknown modifier key', { ...fullConfig, modifiers: { asymmetricExpertRoles: true, spectatorLifelines: false, x: true } }],
    ['non-boolean modifier', { ...fullConfig, modifiers: { asymmetricExpertRoles: 'yes', spectatorLifelines: false } }],
    ['non-string pool member', { ...fullConfig, modulePool: ['wires', 7] }],
    ['unknown top-level key', { ...fullConfig, bogus: 1 }],
  ])('rejects %s', (_label, cfg) => {
    expect(parseRoundConfig(cfg, { full: true }).ok).toBe(false);
  });

  it('rejects an empty modulePool override', () => {
    expect(parseRoundConfig({ ...fullConfig, modulePool: [] }, { full: true }).ok).toBe(false);
  });

  it('rejects a modulePool id with no registered generator', () => {
    const res = parseRoundConfig({ ...fullConfig, modulePool: ['keypads'] }, { full: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).toMatch(/keypads/);
  });

  it('rejects a non-object config', () => {
    expect(parseRoundConfig(null, { full: true }).ok).toBe(false);
    expect(parseRoundConfig([], { full: true }).ok).toBe(false);
    expect(parseRoundConfig(42, { full: true }).ok).toBe(false);
  });
});

describe('parseRoundConfig — partial mode (SESSION_CREATE)', () => {
  it('accepts a sparse partial and only carries provided keys', () => {
    const res = parseRoundConfig({ difficulty: 'hard' }, { full: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config).toEqual({ difficulty: 'hard' });
  });

  it('accepts an empty object', () => {
    const res = parseRoundConfig({}, { full: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config).toEqual({});
  });

  it('treats explicitly-undefined keys as absent', () => {
    const res = parseRoundConfig({ moduleCount: undefined }, { full: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.config).toEqual({});
  });

  it('still range-checks provided keys', () => {
    expect(parseRoundConfig({ moduleCount: 99 }, { full: false }).ok).toBe(false);
  });
});
