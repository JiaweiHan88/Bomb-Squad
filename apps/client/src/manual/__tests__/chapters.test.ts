import { describe, it, expect } from 'vitest';
import type { ManualPage } from '@bomb-squad/shared';
import { buildChapters, adjacentChapterId } from '../chapters.js';

const page = (chapterId: string, chapterTitle: string, marker = ''): ManualPage => ({
  chapterId,
  chapterTitle,
  sections: [{ content: marker || chapterTitle }],
});

describe('buildChapters', () => {
  it('returns empty for empty input', () => {
    expect(buildChapters([])).toEqual([]);
  });

  it('groups pages by chapterId preserving first-seen chapter order', () => {
    const chapters = buildChapters([
      page('wires', 'Wires', 'w1'),
      page('the-button', 'The Button', 'b1'),
      page('wires', 'Wires', 'w2'),
    ]);
    expect(chapters.map((c) => c.chapterId)).toEqual(['wires', 'the-button']);
    expect(chapters[0]!.pages.map((p) => p.sections[0]!.content)).toEqual(['w1', 'w2']);
    expect(chapters[1]!.pages).toHaveLength(1);
  });

  it('takes the chapter title from the first page of the chapter', () => {
    const chapters = buildChapters([
      page('wires', 'Wires', 'w1'),
      page('wires', 'Wires (cont.)', 'w2'),
    ]);
    expect(chapters[0]!.chapterTitle).toBe('Wires');
  });

  it('does not mutate the input array', () => {
    const input = [page('b', 'B'), page('a', 'A')];
    const frozen = Object.freeze([...input]);
    expect(() => buildChapters(frozen as ManualPage[])).not.toThrow();
    expect(frozen.map((p) => p.chapterId)).toEqual(['b', 'a']);
  });
});

describe('adjacentChapterId', () => {
  const chapters = buildChapters([page('a', 'A'), page('b', 'B'), page('c', 'C')]);

  it('moves forward and backward by one chapter', () => {
    expect(adjacentChapterId(chapters, 'a', 1)).toBe('b');
    expect(adjacentChapterId(chapters, 'c', -1)).toBe('b');
  });

  it('returns null at the ends (no wrap-around)', () => {
    expect(adjacentChapterId(chapters, 'a', -1)).toBeNull();
    expect(adjacentChapterId(chapters, 'c', 1)).toBeNull();
  });

  it('returns null for an unknown current chapter or empty list', () => {
    expect(adjacentChapterId(chapters, 'nope', 1)).toBeNull();
    expect(adjacentChapterId([], 'a', 1)).toBeNull();
  });
});
