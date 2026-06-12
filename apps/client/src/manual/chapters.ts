import type { ManualPage } from '@bomb-squad/shared';

/**
 * A manual chapter: all pages sharing one `chapterId`, in input order.
 *
 * The viewer consumes `ManualChapter[]` built from `IModule.getManualPages()`
 * output (structured data — AC4) and has zero knowledge of specific modules.
 * Wiring "all registered modules → chapters" lands with the real modules
 * (Story 5.3+); the dev harness feeds fixtures through the same function.
 */
export interface ManualChapter {
  chapterId: string;
  /** Title of the chapter's first page. */
  chapterTitle: string;
  pages: ManualPage[];
}

/** Pure: groups pages by chapterId, preserving first-seen chapter order. */
export function buildChapters(pages: readonly ManualPage[]): ManualChapter[] {
  const byId = new Map<string, ManualChapter>();
  for (const page of pages) {
    const existing = byId.get(page.chapterId);
    if (existing === undefined) {
      byId.set(page.chapterId, {
        chapterId: page.chapterId,
        chapterTitle: page.chapterTitle,
        pages: [page],
      });
    } else {
      existing.pages.push(page);
    }
  }
  return [...byId.values()];
}

/**
 * Pure: the chapterId `delta` steps from `currentId`, or null when out of
 * bounds (no wrap-around — flipping past the last page of a paper manual
 * doesn't loop back to page one) or when `currentId` is unknown.
 */
export function adjacentChapterId(
  chapters: readonly ManualChapter[],
  currentId: string,
  delta: number,
): string | null {
  const index = chapters.findIndex((c) => c.chapterId === currentId);
  if (index === -1) return null;
  const target = index + delta;
  if (target < 0 || target >= chapters.length) return null;
  return chapters[target]!.chapterId;
}
