import { describe, it, expect } from 'vitest';
import type { ManualPage } from '@bomb-squad/shared';
import { buildChapters } from '../chapters.js';
import { searchChapters } from '../search.js';

const page = (chapterId: string, chapterTitle: string): ManualPage => ({
  chapterId,
  chapterTitle,
  sections: [{ content: chapterTitle }],
});

const chapters = buildChapters([
  page('wires', 'Wires'),
  page('the-button', 'The Button'),
  page('wire-sequences', 'Wire Sequences'),
  page('memory', 'Memory'),
]);

describe('searchChapters', () => {
  it('returns all chapters for an empty or whitespace query', () => {
    expect(searchChapters(chapters, '')).toEqual(chapters);
    expect(searchChapters(chapters, '   ')).toEqual(chapters);
  });

  it('matches case-insensitively by substring of the title', () => {
    const hits = searchChapters(chapters, 'MEM');
    expect(hits.map((c) => c.chapterId)).toEqual(['memory']);
  });

  it('ranks prefix matches before in-word matches, keeping relative order within each group', () => {
    // "wire" prefixes "Wires" and "Wire Sequences"; "button" only substring-matches "The Button".
    const hits = searchChapters(chapters, 'wire');
    expect(hits.map((c) => c.chapterId)).toEqual(['wires', 'wire-sequences']);

    const mixed = searchChapters(chapters, 'b');
    // "The Button" contains "b" (word-start on "Button" is still not a title prefix).
    expect(mixed.map((c) => c.chapterId)).toEqual(['the-button']);
  });

  it('returns empty for a non-matching query', () => {
    expect(searchChapters(chapters, 'zzz')).toEqual([]);
  });

  it('trims the query before matching', () => {
    expect(searchChapters(chapters, '  memory  ').map((c) => c.chapterId)).toEqual(['memory']);
  });
});
