import { letterTemplateDefault } from '@hrms/shared';
import { render } from '../mail/template-renderer';
import {
  bodyContainsSalary,
  buildLetterVars,
  formatTenure,
  type LetterContext,
  type LetterSubject,
  missingVariables,
} from './letter-vars';

const subject: LetterSubject = {
  employeeCode: 'EMP-0001',
  firstName: 'Asha',
  lastName: 'Verma',
  joinDate: new Date('2024-04-01T00:00:00Z'),
  exitDate: null,
  department: { name: 'Engineering' },
  designation: { title: 'Senior Engineer' },
  location: { name: 'Pune' },
  employmentType: { name: 'permanent' },
  manager: { firstName: 'Meera', lastName: 'Iyer' },
};

const context: LetterContext = {
  orgName: 'Acme Industries',
  letterNumber: 'OFR/2026/0001',
  issuedByName: 'Priya Nair',
  issueDate: new Date('2026-08-02T00:00:00Z'),
  monthlyCtc: 120000,
};

describe('buildLetterVars', () => {
  it('never leaves a declared variable without a value', () => {
    const vars = buildLetterVars(subject, context);
    for (const template of ['offer_letter', 'appointment_letter', 'salary_certificate']) {
      const def = letterTemplateDefault(template);
      expect(missingVariables(template, def?.bodyHtml ?? '', vars)).toEqual([]);
    }
  });

  it('reads "present" for a serving employee rather than a visible placeholder', () => {
    const vars = buildLetterVars(subject, context);
    expect(vars.exitDate).toBe('present');

    const body = letterTemplateDefault('experience_letter')?.bodyHtml ?? '';
    expect(render(body, vars)).not.toContain('{{');
  });

  it('omits salary entirely when none is assigned — never a zero', () => {
    const vars = buildLetterVars(subject, { ...context, monthlyCtc: null });
    expect(vars.monthlyCtc).toBeUndefined();
    expect(vars.annualCtc).toBeUndefined();
    // And that omission is what the issue path must catch before freezing.
    const body = letterTemplateDefault('salary_certificate')?.bodyHtml ?? '';
    expect(missingVariables('salary_certificate', body, vars)).toContain('monthlyCtc');
  });

  it('derives the annual figure from the monthly one', () => {
    const vars = buildLetterVars(subject, context);
    expect(vars.monthlyCtc).toBe('₹1,20,000');
    expect(vars.annualCtc).toBe('₹14,40,000');
  });
});

describe('escaping, which is permanent once a letter is frozen', () => {
  it('neutralises markup in an employee-entered name', () => {
    const vars = buildLetterVars(
      { ...subject, firstName: '<script>alert(1)</script>', lastName: '' },
      context,
    );
    const html = render('<p>Dear {{employeeName}},</p>', vars);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('bodyContainsSalary', () => {
  const appointment = letterTemplateDefault('appointment_letter');

  it('is true for a template that ships with pay in it', () => {
    const offer = letterTemplateDefault('offer_letter');
    if (!offer) throw new Error('offer_letter missing from the catalogue');
    expect(bodyContainsSalary(offer, offer.bodyHtml)).toBe(true);
  });

  it('is false for the shipped appointment letter', () => {
    if (!appointment) throw new Error('appointment_letter missing from the catalogue');
    expect(bodyContainsSalary(appointment, appointment.bodyHtml)).toBe(false);
  });

  it('flips to true when an org edits pay into a salary-free template', () => {
    if (!appointment) throw new Error('appointment_letter missing from the catalogue');
    const edited = `${appointment.bodyHtml}<p>Your pay is {{monthlyCtc}}.</p>`;
    expect(bodyContainsSalary(appointment, edited)).toBe(true);
  });
});

describe('formatTenure', () => {
  it.each([
    ['2024-04-01', '2026-08-02', '2 years 4 months'],
    ['2026-01-01', '2026-08-01', '7 months'],
    ['2025-08-02', '2026-08-02', '1 year'],
    ['2026-07-20', '2026-08-02', 'less than a month'],
  ])('%s → %s is %s', (from, to, expected) => {
    expect(formatTenure(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`))).toBe(expected);
  });
});
