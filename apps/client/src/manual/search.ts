import type { ManualChapter } from './chapters.js';

/**
 * Pure, synchronous chapter-name filter for the `/` search (EXPERIENCE.md:
 * keyboard-first, "<300ms to 'Chapter 10 visible'"). Being an in-memory
 * substring match over ≤ a dozen titles is what makes that budget trivial —
 * never make this async or lazy-load chapter content behind it.
 *
 * Ranking: title-prefix matches first, then in-title substring matches;
 * stable input order within each group. Empty/whitespace query → all chapters.
 */
export function searchChapters(
  chapters: readonly ManualChapter[],
  query: string,
): ManualChapter[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...chapters];

  const prefix: ManualChapter[] = [];
  const substring: ManualChapter[] = [];
  for (const chapter of chapters) {
    const title = chapter.chapterTitle.toLowerCase();
    if (title.startsWith(q)) prefix.push(chapter);
    else if (title.includes(q)) substring.push(chapter);
  }
  return [...prefix, ...substring];
}
