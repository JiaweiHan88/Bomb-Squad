import { describe, it, expect } from 'vitest';
import { splitColorWords, MANUAL_COLOR_INKS } from '../colorWords.js';

describe('splitColorWords', () => {
  it('returns a single untagged run for text without color words', () => {
    expect(splitColorWords('Cut exactly one wire.')).toEqual([{ text: 'Cut exactly one wire.' }]);
  });

  it('returns a single empty run for empty text', () => {
    expect(splitColorWords('')).toEqual([{ text: '' }]);
  });

  it('tags whole color words case-insensitively, preserving original casing', () => {
    expect(splitColorWords('No Red wires')).toEqual([
      { text: 'No ' },
      { text: 'Red', colorWord: 'red' },
      { text: ' wires' },
    ]);
  });

  it('handles adjacent and trailing color words', () => {
    expect(splitColorWords('red, white, blue')).toEqual([
      { text: 'red', colorWord: 'red' },
      { text: ', ' },
      { text: 'white', colorWord: 'white' },
      { text: ', ' },
      { text: 'blue', colorWord: 'blue' },
    ]);
  });

  it('does not match color words embedded in larger words', () => {
    expect(splitColorWords('redo the rewhitening')).toEqual([{ text: 'redo the rewhitening' }]);
  });

  it('every taggable word has an ink defined', () => {
    for (const word of ['red', 'blue', 'white', 'yellow', 'black']) {
      expect(MANUAL_COLOR_INKS[word]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
