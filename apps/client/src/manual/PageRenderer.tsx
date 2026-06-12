import type { ManualPage, ManualSection, ManualTable } from '@bomb-squad/shared';
import { splitColorWords, MANUAL_COLOR_INKS } from './colorWords.js';

/**
 * Generic structured-data renderer: one ManualPage → paper-styled React (AC4).
 * Rendering only — zero knowledge of any specific module. All literal values
 * are mockup-derived on-cream inks (`4. Expert Manual.html`); the page surface
 * itself (cream bg / manual ink / serif) is owned by the sheet in ManualViewer.
 */

function EmphasizedText({ text }: { text: string }) {
  const runs = splitColorWords(text);
  return (
    <>
      {runs.map((run, i) =>
        run.colorWord === undefined ? (
          <span key={i}>{run.text}</span>
        ) : (
          <span key={i} className="font-semibold" style={{ color: MANUAL_COLOR_INKS[run.colorWord] }}>
            {run.text}
          </span>
        ),
      )}
    </>
  );
}

function TableView({ table }: { table: ManualTable }) {
  const hasHeaders = table.headers.some((h) => h.trim() !== '');
  return (
    <table className="w-full border-collapse font-manual text-[15px]">
      {hasHeaders && (
        <thead>
          <tr>
            {table.headers.map((header, i) => (
              <th
                key={i}
                className="border-b-2 pb-1.5 text-left font-mono text-[11px] font-bold uppercase tracking-[0.1em]"
                style={{ borderColor: '#211A12', color: '#8A7A5E' }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {table.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, c) => (
              <td
                key={c}
                className={`border-b px-1 py-1.5 align-top leading-snug ${
                  c === row.length - 1 ? 'whitespace-nowrap text-right font-semibold' : 'pr-3.5'
                }`}
                style={{ borderColor: '#D8CBAC', color: '#2A2118' }}
              >
                <EmphasizedText text={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectionView({ section }: { section: ManualSection }) {
  return (
    <section className="mb-5">
      {section.heading !== undefined && (
        <h2 className="mb-2 font-manual text-[20px] font-bold">{section.heading}</h2>
      )}
      {section.content !== '' && (
        <p className="mb-3 max-w-[60ch] font-manual text-[17px] leading-[1.55]" style={{ color: '#2A2118' }}>
          <EmphasizedText text={section.content} />
        </p>
      )}
      {section.table !== undefined && <TableView table={section.table} />}
    </section>
  );
}

export default function PageRenderer({ page }: { page: ManualPage }) {
  return (
    <div>
      {page.sections.map((section, i) => (
        <SectionView key={i} section={section} />
      ))}
    </div>
  );
}
