import type { ReportColumn } from '@hrms/shared';
import { serializeReport, toCsv, toSpreadsheetMl, UTF8_BOM } from './report-export';

const columns: ReportColumn[] = [
  { key: 'name', header: 'Name' },
  { key: 'days', header: 'Days', type: 'number' },
];

describe('toCsv', () => {
  it('writes a BOM so Excel reads UTF-8 correctly', () => {
    expect(toCsv(columns, [])).toMatch(new RegExp(`^${UTF8_BOM}`));
  });

  it('emits headers even with no rows', () => {
    expect(toCsv(columns, []).replace(UTF8_BOM, '')).toBe('Name,Days');
  });

  it('quotes fields containing a comma', () => {
    const csv = toCsv(columns, [{ name: 'Verma, Asha', days: 3 }]);
    expect(csv).toContain('"Verma, Asha",3');
  });

  it('doubles embedded quotes', () => {
    const csv = toCsv(columns, [{ name: 'Bob "The Builder"', days: 1 }]);
    expect(csv).toContain('"Bob ""The Builder""",1');
  });

  it('quotes fields containing newlines', () => {
    const csv = toCsv(columns, [{ name: 'line1\nline2', days: 1 }]);
    expect(csv).toContain('"line1\nline2"');
  });

  it('renders null and undefined as empty cells, not "null"', () => {
    const csv = toCsv(columns, [{ name: null, days: undefined }]);
    expect(csv.replace(UTF8_BOM, '').split('\r\n')[1]).toBe(',');
  });

  it('preserves non-ascii names', () => {
    expect(toCsv(columns, [{ name: 'Zoë Müller', days: 2 }])).toContain('Zoë Müller');
  });

  it('separates rows with CRLF', () => {
    const csv = toCsv(columns, [
      { name: 'a', days: 1 },
      { name: 'b', days: 2 },
    ]);
    expect(csv.replace(UTF8_BOM, '').split('\r\n')).toHaveLength(3);
  });
});

describe('toSpreadsheetMl', () => {
  it('escapes XML-significant characters so the sheet is not corrupted', () => {
    const xml = toSpreadsheetMl(columns, [{ name: 'Smith & <Co>', days: 1 }], 'Test');
    expect(xml).toContain('Smith &amp; &lt;Co&gt;');
    expect(xml).not.toContain('Smith & <Co>');
  });

  it('types numeric cells as numbers so totals work in Excel', () => {
    const xml = toSpreadsheetMl(columns, [{ name: 'Asha', days: 12 }], 'Test');
    expect(xml).toContain('<Data ss:Type="Number">12</Data>');
    expect(xml).toContain('<Data ss:Type="String">Asha</Data>');
  });

  it('emits an empty cell for null rather than the text "null"', () => {
    expect(toSpreadsheetMl(columns, [{ name: null, days: null }], 'Test')).toContain('<Cell/>');
  });

  it('escapes the worksheet title and respects the 31-char sheet-name limit', () => {
    const xml = toSpreadsheetMl(columns, [], 'A very long report title & more than Excel allows');
    const name = xml.match(/ss:Name="([^"]*)"/)?.[1] ?? '';
    expect(name.length).toBeLessThanOrEqual(31);
  });

  it('is well-formed enough to start with the XML declaration', () => {
    expect(toSpreadsheetMl(columns, [], 'Test').startsWith('<?xml version="1.0"?>')).toBe(true);
  });
});

describe('serializeReport', () => {
  it('returns csv content type and extension', () => {
    const out = serializeReport('csv', columns, [], 'Test');
    expect(out.extension).toBe('csv');
    expect(out.contentType).toContain('text/csv');
  });

  it('returns excel content type and extension', () => {
    const out = serializeReport('excel', columns, [], 'Test');
    expect(out.extension).toBe('xls');
    expect(out.contentType).toContain('vnd.ms-excel');
  });
});
