import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  build24Q,
  type ChallanEntry,
  type Deductee,
  FVU_SPEC_VERSION,
  LAYOUT_TRANSCRIBED,
} from './tds-files';

const challan = (month: string, tds: number): ChallanEntry => ({
  month,
  bsrCode: '0510308',
  challanSerial: '00123',
  depositDate: `${month}-07`,
  tds,
  surcharge: 0,
  educationCess: 0,
  interest: 0,
  fee: 0,
  penalty: 0,
  others: 0,
});

const person = (code: string, pan: string | null, tds: number): Deductee => ({
  employeeCode: code,
  employeeName: `Person ${code}`,
  pan,
  tdsDeducted: tds,
  grossSalary: tds * 20,
});

const base = {
  tan: 'AHMH12345A',
  deductorName: 'Acme Industries Private Limited',
  deductorPan: 'AAACA1234A',
  responsiblePerson: 'Priya Sharma',
  financialYear: '2026-27',
  quarter: 'Q2' as const,
};

describe('build24Q', () => {
  it('reports honestly whether the layout was transcribed', () => {
    // Asserts the actual current state, not the implementation line restated:
    // nobody has transcribed the layout yet, so the sentinel version is still
    // in place and the flag must be false. Task 13 flips both together, and
    // when it does this test has to be updated to match rather than pass by
    // construction.
    expect(FVU_SPEC_VERSION).toBe('UNTRANSCRIBED');
    expect(LAYOUT_TRANSCRIBED).toBe(false);
  });

  // Task 13: unskip once the layout is transcribed and the fixture is written
  // and read against the specification by eye.
  it.todo('matches the golden file');

  it('emits one deductee record per person per month', () => {
    const result = build24Q({
      ...base,
      challans: [challan('2026-07', 500), challan('2026-08', 500)],
      deductees: {
        '2026-07': [person('EMP-1', 'ABCPD1234E', 300), person('EMP-2', 'ABCPD5678F', 200)],
        '2026-08': [person('EMP-1', 'ABCPD1234E', 300), person('EMP-2', 'ABCPD5678F', 200)],
      },
    });
    expect(result.rowCount).toBe(4);
  });

  it('reports a deductee with no PAN rather than dropping them', () => {
    // A missing PAN is what forces deduction at 20% and what the portal
    // rejects on. Omitting the row would file a short return.
    const result = build24Q({
      ...base,
      challans: [challan('2026-07', 500)],
      deductees: { '2026-07': [person('EMP-1', null, 300), person('EMP-2', 'ABCPD5678F', 200)] },
    });
    expect(result.noPan.map((d) => d.employeeCode)).toEqual(['EMP-1']);
    expect(result.rowCount).toBe(2);
  });

  it('totals TDS across every challan in the quarter', () => {
    const result = build24Q({
      ...base,
      challans: [challan('2026-07', 500), challan('2026-08', 700), challan('2026-09', 300)],
      deductees: {
        '2026-07': [person('EMP-1', 'ABCPD1234E', 500)],
        '2026-08': [person('EMP-1', 'ABCPD1234E', 700)],
        '2026-09': [person('EMP-1', 'ABCPD1234E', 300)],
      },
    });
    expect(result.totals.challanTds).toBe(1500);
    expect(result.totals.deducteeTds).toBe(1500);
  });

  it('orders challans by month however they arrive', () => {
    // Deductee rows reference their challan by index, so a caller handing
    // these over out of order would mis-key every row under them.
    const result = build24Q({
      ...base,
      challans: [challan('2026-09', 300), challan('2026-07', 500)],
      deductees: {
        '2026-07': [person('EMP-1', 'ABCPD1234E', 500)],
        '2026-09': [person('EMP-1', 'ABCPD1234E', 300)],
      },
    });
    const first = result.content.split('\n').find((l) => l.startsWith('CD'));
    expect(first).toContain('2026-07');
  });

  it('produces byte-identical output for identical input', () => {
    // The golden-file property: a return regenerated in December must be the
    // same file it was in October.
    const input = {
      ...base,
      challans: [challan('2026-07', 500)],
      deductees: { '2026-07': [person('EMP-1', 'ABCPD1234E', 500)] },
    };
    expect(build24Q(input).content).toBe(build24Q(input).content);
  });
});

describe('purity', () => {
  it('has no clock and no database', () => {
    const source = readFileSync(join(__dirname, 'tds-files.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/new Date\(|Date\.now|prisma|PrismaService/);
  });
});
