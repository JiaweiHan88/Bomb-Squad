/**
 * Color-word emphasis for manual content (mockup `4. Expert Manual.html` `.w`
 * classes). Colorblind floor: the WORD is the signal — tinting recognised
 * color words is decoration layered on top of the text, never a replacement
 * for it. Inks are the mockup's on-cream tints (no design token covers
 * content-ink tints; cream/led tokens are reserved for other meanings).
 */

export const MANUAL_COLOR_INKS: Readonly<Record<string, string>> = {
  red: '#B3261A',
  blue: '#1E5FC2',
  white: '#7A6F58',
  yellow: '#9A7A10',
  black: '#1A1410',
};

export interface TextRun {
  text: string;
  /** Lowercase color-word key into MANUAL_COLOR_INKS, when this run is one. */
  colorWord?: string;
}

const COLOR_WORD_RE = /\b(red|blue|white|yellow|black)\b/gi;

/** Pure: splits text into runs, tagging whole color words (case-insensitive). */
export function splitColorWords(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(COLOR_WORD_RE)) {
    const start = match.index;
    if (start > last) runs.push({ text: text.slice(last, start) });
    runs.push({ text: match[0], colorWord: match[0].toLowerCase() });
    last = start + match[0].length;
  }
  if (last < text.length || runs.length === 0) runs.push({ text: text.slice(last) });
  return runs;
}
