/**
 * Reading CSV back in.
 *
 * `report-export.ts` writes it and had no inverse, because nothing until now
 * needed to read a spreadsheet. Hand-rolled to match that file's stated
 * position — "both formats are dependency-free by design" — and only because
 * the round-trip is pinned by a test corpus. A misparsed row here does not
 * throw; it silently creates an employee reporting to the wrong person, which
 * is the kind of bug worth a dependency if the tests are not going to be
 * written.
 */

const BOM = '﻿';

/**
 * The apostrophe `csvCell` adds in front of a formula trigger is **lossy on the
 * way back**: a surname legitimately beginning `-` round-trips as `'-`. So one
 * leading apostrophe is stripped, but only when what follows would have been
 * prefixed in the first place — otherwise `O'Brien` written as `'O'Brien` by
 * some other tool would lose a character it was entitled to keep.
 */
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function unescapeCell(value: string): string {
  if (value.startsWith("'") && FORMULA_TRIGGERS.test(value.slice(1))) return value.slice(1);
  return value;
}

/**
 * RFC 4180, one pass, character by character.
 *
 * Handles quoted fields containing commas and newlines, doubled quotes inside a
 * quoted field, CRLF and bare LF line endings, and a leading byte-order mark.
 * A quoted field's trailing whitespace is kept; an unquoted field's is trimmed,
 * because a spreadsheet pads and a person did not mean to.
 */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;

  const endField = () => {
    row.push(wasQuoted ? unescapeCell(field) : unescapeCell(field.trim()));
    field = '';
    wasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      wasQuoted = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\r') {
      // Swallow the LF of a CRLF; a lone CR is still a line break.
      if (text[i + 1] === '\n') i += 1;
      endRow();
    } else if (char === '\n') {
      endRow();
    } else {
      field += char;
    }
  }

  // A file ending without a newline still has a last row; one ending *with* a
  // newline does not have an extra empty one.
  if (field !== '' || wasQuoted || row.length > 0) endRow();

  return rows.filter((r) => r.some((cell) => cell !== ''));
}

export interface ParsedSheet {
  /** Header names as written, lower-cased and trimmed for matching. */
  headers: string[];
  /** One record per row, keyed by header. Row numbers are 1-based and count
   *  the header, so they match what the spreadsheet shows. */
  records: { row: number; values: Record<string, string> }[];
}

/**
 * Headers matched case-insensitively and order-independently, because nobody
 * keeps a downloaded template's column order and a strict match would reject
 * files that are entirely fine.
 */
export function parseSheet(input: string): ParsedSheet {
  const rows = parseCsv(input);
  if (rows.length === 0) return { headers: [], records: [] };

  const headers = (rows[0] as string[]).map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((cells, index) => {
    const values: Record<string, string> = {};
    headers.forEach((header, column) => {
      values[header] = cells[column] ?? '';
    });
    return { row: index + 2, values };
  });
  return { headers, records };
}
