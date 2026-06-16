import type { ManualPage, ManualSection } from '@bomb-squad/shared';
import { getButtonManualPages } from '@bomb-squad/shared';

/**
 * Minimal typed renderer of the module's structured manual data (contract
 * file). The real paper-styled manual viewer (Story 5.2) consumes the same
 * getManualPages() output — modules never author markup, only data.
 */

function Section({ section }: { section: ManualSection }) {
  return (
    <section className="space-y-2">
      {section.heading ? <h3 className="font-semibold">{section.heading}</h3> : null}
      <p>{section.content}</p>
      {section.table ? (
        <table className="border-collapse text-left">
          <thead>
            <tr>
              {section.table.headers.map((h) => (
                <th key={h} className="border border-current px-2 py-1">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.table.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="border border-current px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

export function ButtonManualPages() {
  return (
    <div className="space-y-6">
      {getButtonManualPages().map((page: ManualPage) => (
        <article key={page.chapterId} className="space-y-3">
          <h2 className="text-lg font-semibold">{page.chapterTitle}</h2>
          {page.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </article>
      ))}
    </div>
  );
}
