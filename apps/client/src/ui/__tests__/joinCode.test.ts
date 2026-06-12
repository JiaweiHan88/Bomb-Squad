import { describe, it, expect } from 'vitest';
import {
  sanitizeCode,
  applyCharAt,
  applyPasteAt,
  applyBackspaceAt,
  isCodeComplete,
  isJoinReady,
  EMPTY_CELLS,
} from '../joinCode.js';

const cells = (s: string): string[] => {
  const out = [...EMPTY_CELLS];
  [...s].forEach((ch, i) => {
    out[i] = ch;
  });
  return out;
};

describe('sanitizeCode', () => {
  it('uppercases and strips everything outside A–Z0–9', () => {
    expect(sanitizeCode('ktane5')).toBe('KTANE5');
    expect(sanitizeCode(' kt-an_e5 ')).toBe('KTANE5');
    expect(sanitizeCode('a:b 1💣2')).toBe('AB12');
    expect(sanitizeCode('')).toBe('');
  });
});

describe('applyCharAt', () => {
  it('sets one sanitized char and advances focus', () => {
    const result = applyCharAt(EMPTY_CELLS, 0, 'k');
    expect(result.cells[0]).toBe('K');
    expect(result.focusIndex).toBe(1);
  });

  it('clamps focus at the last cell', () => {
    const result = applyCharAt(cells('KTANE'), 5, '5');
    expect(result.cells.join('')).toBe('KTANE5');
    expect(result.focusIndex).toBe(5);
  });

  it('clears the cell (no advance) when the char sanitizes away', () => {
    const result = applyCharAt(cells('K'), 0, '!');
    expect(result.cells[0]).toBe('');
    expect(result.focusIndex).toBe(0);
  });

  it('does not mutate the input array', () => {
    const input = [...EMPTY_CELLS];
    applyCharAt(input, 0, 'K');
    expect(input[0]).toBe('');
  });
});

describe('applyPasteAt', () => {
  it('splits a full-code paste across all six cells (mockup behavior)', () => {
    const result = applyPasteAt(EMPTY_CELLS, 0, 'ktane5');
    expect(result.cells).toEqual(['K', 'T', 'A', 'N', 'E', '5']);
    expect(result.focusIndex).toBe(5);
  });

  it('spreads from the paste index and truncates overflow', () => {
    const result = applyPasteAt(cells('KT'), 2, 'XYZ123');
    expect(result.cells).toEqual(['K', 'T', 'X', 'Y', 'Z', '1']);
    expect(result.focusIndex).toBe(5);
  });

  it('sanitizes pasted junk before splitting', () => {
    const result = applyPasteAt(EMPTY_CELLS, 0, ' kt-an ');
    expect(result.cells).toEqual(['K', 'T', 'A', 'N', '', '']);
    expect(result.focusIndex).toBe(4);
  });

  it('is a no-op (same values, same focus) for an all-junk paste', () => {
    const result = applyPasteAt(cells('K'), 1, '!!!');
    expect(result.cells).toEqual(cells('K'));
    expect(result.focusIndex).toBe(1);
  });
});

describe('applyBackspaceAt', () => {
  it('clears the current cell when it is filled', () => {
    const result = applyBackspaceAt(cells('KTA'), 2);
    expect(result.cells).toEqual(cells('KT'));
    expect(result.focusIndex).toBe(2);
  });

  it('retreats and clears the previous cell when current is empty', () => {
    const result = applyBackspaceAt(cells('KT'), 2);
    expect(result.cells).toEqual(cells('K'));
    expect(result.focusIndex).toBe(1);
  });

  it('is a no-op at the first empty cell', () => {
    const result = applyBackspaceAt(EMPTY_CELLS, 0);
    expect(result.cells).toEqual(EMPTY_CELLS);
    expect(result.focusIndex).toBe(0);
  });
});

describe('isCodeComplete', () => {
  it('requires all six cells filled', () => {
    expect(isCodeComplete(cells('KTANE5'))).toBe(true);
    expect(isCodeComplete(cells('KTANE'))).toBe(false);
    expect(isCodeComplete(EMPTY_CELLS)).toBe(false);
  });
});

describe('isJoinReady (mirror of the server validator)', () => {
  const full = cells('KTANE5');

  it('ready: complete code + trimmed 1–24 char name + chosen role', () => {
    expect(isJoinReady(full, 'Maya', 'expert')).toBe(true);
    expect(isJoinReady(full, ' Maya ', 'spectator')).toBe(true);
    expect(isJoinReady(full, 'x'.repeat(24), 'defuser')).toBe(true);
  });

  it('not ready: missing role, missing/oversized name, incomplete code', () => {
    expect(isJoinReady(full, 'Maya', null)).toBe(false);
    expect(isJoinReady(full, '   ', 'expert')).toBe(false);
    expect(isJoinReady(full, 'x'.repeat(25), 'expert')).toBe(false);
    expect(isJoinReady(cells('KTANE'), 'Maya', 'expert')).toBe(false);
  });
});
