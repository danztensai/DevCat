// Minimal RFC 4180-ish CSV parser with delimiter detection (, ; tab |).

export const MAX_CSV_ROWS = 200_000;

/** Pick the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text: string, hint?: string): string {
  if (hint && /\.tsv$/i.test(hint)) return "\t";
  const sample = text.slice(0, 20_000).split(/\r?\n/).filter((l) => l.length > 0).slice(0, 20);
  let best = ",";
  let bestScore = -1;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = sample.map((l) => countOutsideQuotes(l, d));
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length;
    const score = consistent * 1000 + counts[0];
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (!q && ch === d) n++;
  }
  return n;
}

export function parseCsv(text: string, delimiter: string, maxRows = MAX_CSV_ROWS): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { q = true; i++; continue; }
    if (ch === delimiter) { row.push(field); field = ""; i++; continue; }
    if (ch === "\n" || ch === "\r") {
      row.push(field); field = "";
      rows.push(row); row = [];
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (rows.length >= maxRows) return { rows, truncated: i < n };
      continue;
    }
    field += ch; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return { rows, truncated: false };
}

/** Spreadsheet column letters: 0 → A, 25 → Z, 26 → AA. */
export function colLetter(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
