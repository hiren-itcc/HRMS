import type { ReportColumn } from '@hrms/shared';

/**
 * Pure export serializers — no Prisma, no I/O, fully unit-testable.
 * Both formats are dependency-free by design (see the module plan): CSV is
 * RFC-4180, and Excel uses SpreadsheetML, the single-file XML workbook
 * format Excel/Numbers/Sheets all open natively.
 */

export type ReportRow = Record<string, string | number | null | undefined>;

/** Excel only honours UTF-8 in CSV when the byte-order mark is present. */
export const UTF8_BOM = '﻿';

/**
 * Spreadsheets evaluate any cell starting with one of these, so an employee
 * who names themselves `=HYPERLINK(...)` would get their formula executed in
 * HR's Excel. Prefixing with an apostrophe forces the cell to text and is
 * stripped on display (CSV injection, CWE-1236).
 */
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  // Numbers are ours, not user input, and must stay numeric to be summable.
  if (typeof value === 'number') return String(value);
  const raw = String(value);
  const text = FORMULA_TRIGGERS.test(raw) ? `'${raw}` : raw;
  // Quote when the field contains a delimiter, quote or newline; escape
  // embedded quotes by doubling them (RFC 4180).
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns: ReportColumn[], rows: ReportRow[]): string {
  const header = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(','));
  return UTF8_BOM + [header, ...body].join('\r\n');
}

/** XML text escaping — an employee named "Smith & Co" must not break the sheet. */
function xml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function isNumeric(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * SpreadsheetML 2003 workbook: bold header row, sized columns and typed
 * cells, so totals and sorting work in the spreadsheet rather than
 * arriving as text.
 */
export function toSpreadsheetMl(columns: ReportColumn[], rows: ReportRow[], title: string): string {
  const headerCells = columns
    .map((c) => `<Cell ss:StyleID="head"><Data ss:Type="String">${xml(c.header)}</Data></Cell>`)
    .join('');

  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((c) => {
          const value = row[c.key];
          if (value === null || value === undefined) return '<Cell/>';
          if (c.type === 'number' || (c.type === undefined && isNumeric(value))) {
            return `<Cell><Data ss:Type="Number">${xml(value)}</Data></Cell>`;
          }
          return `<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`;
        })
        .join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  const colDefs = columns
    .map((c) => `<Column ss:Width="${c.type === 'number' ? 90 : 160}"/>`)
    .join('');

  return `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="head"><Font ss:Bold="1"/><Interior ss:Color="#EEF2FF" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="${xml(title).slice(0, 31)}">
  <Table>${colDefs}<Row>${headerCells}</Row>${bodyRows}</Table>
 </Worksheet>
</Workbook>`;
}

export interface ExportPayload {
  body: string;
  contentType: string;
  extension: string;
}

/** Chooses the serializer and the headers the controller needs. */
export function serializeReport(
  format: 'csv' | 'excel',
  columns: ReportColumn[],
  rows: ReportRow[],
  title: string,
): ExportPayload {
  return format === 'csv'
    ? { body: toCsv(columns, rows), contentType: 'text/csv; charset=utf-8', extension: 'csv' }
    : {
        body: toSpreadsheetMl(columns, rows, title),
        contentType: 'application/vnd.ms-excel; charset=utf-8',
        extension: 'xls',
      };
}
