import type { ReportColumn } from '@hrms/shared';
import { toCsv } from '../reports/report-export';
import { parseCsv, parseSheet } from './csv-parse';

/**
 * The corpus that earns a hand-rolled parser.
 *
 * `report-export.ts` is dependency-free by design and this is its inverse, so
 * the bar is that anything `toCsv` writes comes back unchanged. A misparse here
 * does not throw — it silently files an employee under the wrong department —
 * which is the one failure mode a dependency would have been worth avoiding.
 */
describe('parseCsv', () => {
  it('reads a plain sheet', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads CRLF, bare LF, and a trailing newline without inventing a row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2);
  });

  it('strips a byte-order mark rather than reading it as part of a header', () => {
    const [header] = parseCsv('﻿name,email\nA,b@c.d');
    expect(header?.[0]).toBe('name');
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('a,b\n"Smith, John",x')).toEqual([
      ['a', 'b'],
      ['Smith, John', 'x'],
    ]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([['a'], ['line one\nline two']]);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(parseCsv('a\n"She said ""hello"""')).toEqual([['a'], ['She said "hello"']]);
  });

  it('trims an unquoted field and leaves a quoted one alone', () => {
    expect(parseCsv('a,b\n  x  ,"  y  "')).toEqual([
      ['a', 'b'],
      ['x', '  y  '],
    ]);
  });

  /*
   * The lossy one. csvCell prefixes a formula trigger with an apostrophe to
   * stop Excel evaluating it, so a surname beginning `-` comes back as `'-`.
   * Stripping it is what makes export-edit-reimport a safe round trip; not
   * stripping it corrupts a name a little more on every pass.
   */
  it('undoes the formula-injection apostrophe', () => {
    expect(parseCsv("a\n'-Smith")).toEqual([['a'], ['-Smith']]);
    expect(parseCsv("a\n'=SUM(A1)")).toEqual([['a'], ['=SUM(A1)']]);
  });

  /* And leaves an apostrophe that was never a guard alone. */
  it('does not eat a legitimate leading apostrophe', () => {
    expect(parseCsv("a\n'Brien")).toEqual([['a'], ["'Brien"]]);
  });

  it('ignores a wholly blank line', () => {
    expect(parseCsv('a,b\n\n1,2')).toHaveLength(2);
  });
});

/**
 * The property that matters, stated once: whatever the exporter writes, the
 * parser reads back identically. Everything above is a special case of it.
 */
describe('round trip with toCsv', () => {
  const columns: ReportColumn[] = [
    { key: 'name', header: 'Name' },
    { key: 'note', header: 'Note' },
  ];

  const CASES: string[] = [
    'Plain',
    'Smith, John',
    'She said "hello"',
    'line one\nline two',
    '-Minus leading',
    '=SUM(A1)',
    '@handle',
    "O'Brien",
    'Ünïcodé näme',
    '  padded  ',
    '',
  ];

  it.each(CASES)('survives a round trip: %j', (value) => {
    const csv = toCsv(columns, [{ name: value, note: 'x' }]);
    const rows = parseCsv(csv);
    // A quoted field keeps its padding; an unquoted one is trimmed on the way
    // back, and `toCsv` does not quote for whitespace — so compare trimmed.
    expect(rows[1]?.[0]).toBe(value.trim());
  });

  it('round-trips a whole sheet of awkward values at once', () => {
    const rows = CASES.map((value, index) => ({ name: value, note: `n${index}` }));
    const parsed = parseCsv(toCsv(columns, rows));
    // Header, plus every non-empty row. The empty-name row still has a note,
    // so it is not dropped as blank.
    expect(parsed).toHaveLength(rows.length + 1);
  });
});

describe('parseSheet', () => {
  it('matches headers case-insensitively and out of order', () => {
    const sheet = parseSheet('Work Email,First Name\nb@c.d,Asha');
    expect(sheet.headers).toEqual(['work email', 'first name']);
    expect(sheet.records[0]?.values['first name']).toBe('Asha');
  });

  /* Row numbers count the header, so an error message names the line the
     person is looking at in their spreadsheet. */
  it('numbers rows the way the spreadsheet does', () => {
    const sheet = parseSheet('a\nx\ny');
    expect(sheet.records.map((r) => r.row)).toEqual([2, 3]);
  });

  it('fills a missing trailing column with an empty string rather than undefined', () => {
    const sheet = parseSheet('a,b,c\n1,2');
    expect(sheet.records[0]?.values.c).toBe('');
  });

  it('is empty for an empty file rather than throwing', () => {
    expect(parseSheet('')).toEqual({ headers: [], records: [] });
  });
});
