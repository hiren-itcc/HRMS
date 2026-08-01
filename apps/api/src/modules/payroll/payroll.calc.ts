import { COMPONENT_CODES } from '@hrms/shared';
import { daysInMonth, isWeekend } from '../../common/utils/calendar';
import { computeStatutory, type PayrollConfig, round2 } from './payroll.statutory';

/**
 * The payslip calculation.
 *
 * Pure by design — no Prisma, no dates read from the clock, no settings
 * lookups. Everything it needs arrives as an argument, so every rule below is
 * reachable from a test. Payroll is arithmetic; arithmetic should be proved
 * rather than eyeballed in a staging environment.
 */

export type CalcType = 'FLAT' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_CTC' | 'STATUTORY' | 'BALANCE';
export type ComponentKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';

export interface StructureLineInput {
  code: string;
  name: string;
  kind: ComponentKind;
  calcType: CalcType;
  value: number;
  order: number;
}

/** A one-off amount for this run: bonus, incentive, loan recovery, advance. */
export interface AdjustmentInput {
  code: string;
  name: string;
  kind: ComponentKind;
  amount: number;
}

export interface PayslipCalcInput {
  month: string;
  /** Monthly cost to company the structure resolves against. */
  monthlyCtc: number;
  lines: StructureLineInput[];
  /** Entered rather than projected — see the payroll settings. */
  monthlyTds?: number;
  /** Days of unpaid leave and unexplained absence in the month. */
  lopDays?: number;
  /** Set for someone who joined mid-month; ISO yyyy-mm-dd. */
  joinDate?: string | null;
  /** Set for someone who left mid-month; ISO yyyy-mm-dd. */
  exitDate?: string | null;
  adjustments?: AdjustmentInput[];
  config: PayrollConfig;
  /** Week-off days, needed only when lopBasis is WORKING_DAYS. */
  weekOffDays?: number[];
}

export interface PayslipLineResult {
  code: string;
  name: string;
  kind: ComponentKind;
  amount: number;
  order: number;
}

export interface PayslipCalcResult {
  lines: PayslipLineResult[];
  workingDays: number;
  lopDays: number;
  payableDays: number;
  grossEarnings: number;
  totalDeductions: number;
  employerContribution: number;
  netPay: number;
  /**
   * Deductions that could not be taken because they exceeded gross. Payroll
   * never pays a negative salary; the remainder is carried instead.
   */
  carriedShortfall: number;
}

/**
 * Days in the month that count toward a full salary.
 *
 * Calendar days is the common Indian practice — a month is a month whether it
 * has 28 days or 31. Working days suits organizations that pay per shift.
 */
export function periodDays(month: string, config: PayrollConfig, weekOffDays: number[] = [0, 6]) {
  const days = daysInMonth(month);
  if (config.lopBasis === 'WORKING_DAYS') {
    return days.filter((day) => !isWeekend(day, weekOffDays)).length;
  }
  return days.length;
}

/**
 * Days the employee was actually on the payroll this month.
 *
 * A joiner is payable from their join date, a leaver up to their exit date.
 * Both are inclusive: someone who joins on the 15th is paid for the 15th.
 */
export function employedDays(
  month: string,
  config: PayrollConfig,
  weekOffDays: number[] = [0, 6],
  joinDate?: string | null,
  exitDate?: string | null,
): number {
  const days = daysInMonth(month);
  const inWindow = days.filter(
    (day) => (!joinDate || day >= joinDate) && (!exitDate || day <= exitDate),
  );
  if (config.lopBasis === 'WORKING_DAYS') {
    return inWindow.filter((day) => !isWeekend(day, weekOffDays)).length;
  }
  return inWindow.length;
}

/**
 * Resolves the earning lines against CTC.
 *
 * Order matters: BASIC is computed first because percentage lines and PF are
 * both levied on it, and BALANCE is computed last because it absorbs whatever
 * is left. Anything else in between is order-independent.
 */
export function resolveEarnings(
  lines: StructureLineInput[],
  monthlyCtc: number,
): Map<string, number> {
  const earnings = lines.filter((line) => line.kind === 'EARNING');
  const amounts = new Map<string, number>();

  const basicLine = earnings.find((line) => line.code === COMPONENT_CODES.BASIC);
  const basic = basicLine ? resolveOne(basicLine, monthlyCtc, 0) : 0;
  if (basicLine) amounts.set(basicLine.code, basic);

  for (const line of earnings) {
    if (line.code === COMPONENT_CODES.BASIC || line.calcType === 'BALANCE') continue;
    amounts.set(line.code, resolveOne(line, monthlyCtc, basic));
  }

  const balanceLine = earnings.find((line) => line.calcType === 'BALANCE');
  if (balanceLine) {
    const assigned = [...amounts.values()].reduce((sum, n) => sum + n, 0);
    // Never negative: an over-specified structure leaves nothing rather than
    // clawing back from the other components.
    amounts.set(balanceLine.code, round2(Math.max(0, monthlyCtc - assigned)));
  }
  return amounts;
}

function resolveOne(line: StructureLineInput, monthlyCtc: number, basic: number): number {
  switch (line.calcType) {
    case 'FLAT':
      return round2(line.value);
    case 'PERCENT_OF_CTC':
      return round2((monthlyCtc * line.value) / 100);
    case 'PERCENT_OF_BASIC':
      return round2((basic * line.value) / 100);
    default:
      // STATUTORY lines are filled in by the statutory engine, not here.
      return 0;
  }
}

export function calculatePayslip(input: PayslipCalcInput): PayslipCalcResult {
  const {
    month,
    monthlyCtc,
    lines,
    config,
    weekOffDays = [0, 6],
    monthlyTds = 0,
    lopDays = 0,
    joinDate,
    exitDate,
    adjustments = [],
  } = input;

  const totalDays = periodDays(month, config, weekOffDays);
  const employed = employedDays(month, config, weekOffDays, joinDate, exitDate);
  // LOP cannot exceed the days actually worked — a stale leave record must not
  // push someone into negative attendance.
  const cappedLop = Math.min(Math.max(lopDays, 0), employed);
  const payableDays = round2(Math.max(0, employed - cappedLop));
  const proration = totalDays > 0 ? payableDays / totalDays : 0;

  const fullEarnings = resolveEarnings(lines, monthlyCtc);
  const byCode = new Map(lines.map((line) => [line.code, line]));

  const result: PayslipLineResult[] = [];
  let gross = 0;
  let basicForPf = 0;

  for (const [code, fullAmount] of fullEarnings) {
    const line = byCode.get(code);
    if (!line) continue;
    const amount = round2(fullAmount * proration);
    if (code === COMPONENT_CODES.BASIC) basicForPf = amount;
    gross += amount;
    result.push({ code, name: line.name, kind: 'EARNING', amount, order: line.order });
  }

  // Adjustments are not prorated: a bonus is a bonus regardless of how much
  // of the month was worked.
  for (const adj of adjustments.filter((a) => a.kind === 'EARNING')) {
    gross += adj.amount;
    result.push({ ...adj, amount: round2(adj.amount), order: 500 });
  }
  gross = round2(gross);

  const statutory = computeStatutory({ basic: basicForPf, gross, config });

  /*
   * `priority` decides what gets taken first when there is not enough gross
   * to cover everything; `order` only decides where the line prints. They are
   * separate on purpose — a structure is free to give "Other deductions" a
   * low display order, and that must not let it jump the queue ahead of a
   * statutory obligation.
   */
  type Deduction = PayslipLineResult & { priority: number };
  const deductions: Deduction[] = [];
  const pushDeduction = (
    code: string,
    fallbackName: string,
    amount: number,
    order: number,
    priority: number,
  ) => {
    if (amount <= 0) return;
    deductions.push({
      code,
      name: byCode.get(code)?.name ?? fallbackName,
      kind: 'DEDUCTION',
      amount: round2(amount),
      order,
      priority,
    });
  };

  const STATUTORY = 0;
  const TAX = 1;
  const CONTRACTUAL = 2;
  const DISCRETIONARY = 3;

  pushDeduction(COMPONENT_CODES.PF, 'Provident Fund', statutory.employeePf, 600, STATUTORY);
  pushDeduction(
    COMPONENT_CODES.ESI,
    'Employee State Insurance',
    statutory.employeeEsi,
    601,
    STATUTORY,
  );
  pushDeduction(
    COMPONENT_CODES.PROFESSIONAL_TAX,
    'Professional Tax',
    statutory.professionalTax,
    602,
    STATUTORY,
  );
  pushDeduction(COMPONENT_CODES.TDS, 'Income Tax (TDS)', monthlyTds, 603, TAX);

  // Structure-defined deductions prorate with the salary.
  for (const line of lines) {
    if (line.kind !== 'DEDUCTION' || line.calcType === 'STATUTORY') continue;
    if (deductions.some((d) => d.code === line.code)) continue;
    pushDeduction(
      line.code,
      line.name,
      resolveOne(line, monthlyCtc, basicForPf) * proration,
      line.order,
      CONTRACTUAL,
    );
  }

  // Loan and advance recovery come last: they can wait a month, a statutory
  // obligation cannot.
  for (const adj of adjustments.filter((a) => a.kind === 'DEDUCTION')) {
    pushDeduction(adj.code, adj.name, adj.amount, 700, DISCRETIONARY);
  }

  const requested = round2(deductions.reduce((sum, d) => sum + d.amount, 0));

  /*
   * A salary is never negative. Loan recovery plus a heavy LOP month can
   * genuinely ask for more than was earned, so deductions are taken in
   * priority order until gross is exhausted and the rest is carried — the
   * payslip records how much, so the shortfall is visible rather than
   * silently forgiven.
   */
  let remaining = gross;
  const applied: PayslipLineResult[] = [];
  for (const deduction of [...deductions].sort(
    (a, b) => a.priority - b.priority || a.order - b.order,
  )) {
    const take = round2(Math.min(deduction.amount, remaining));
    remaining = round2(remaining - take);
    if (take > 0) {
      const { priority: _priority, ...line } = deduction;
      applied.push({ ...line, amount: take });
    }
  }
  const totalDeductions = round2(applied.reduce((sum, d) => sum + d.amount, 0));
  const carriedShortfall = round2(requested - totalDeductions);

  const employerLines: PayslipLineResult[] = [];
  const pushEmployer = (code: string, fallbackName: string, amount: number, order: number) => {
    if (amount <= 0) return;
    employerLines.push({
      code,
      name: byCode.get(code)?.name ?? fallbackName,
      kind: 'EMPLOYER_CONTRIBUTION',
      amount: round2(amount),
      order,
    });
  };
  pushEmployer(COMPONENT_CODES.EMPLOYER_PF, 'Employer PF', statutory.employerPf, 800);
  pushEmployer(COMPONENT_CODES.EMPLOYER_ESI, 'Employer ESI', statutory.employerEsi, 801);

  const employerContribution = round2(employerLines.reduce((sum, line) => sum + line.amount, 0));

  return {
    lines: [...result, ...applied, ...employerLines].sort((a, b) => a.order - b.order),
    workingDays: totalDays,
    lopDays: round2(cappedLop),
    payableDays,
    grossEarnings: gross,
    totalDeductions,
    employerContribution,
    netPay: round2(gross - totalDeductions),
    carriedShortfall,
  };
}
