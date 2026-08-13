'use client';

import {
  TAX_DECLARATION_STATUS_LABELS,
  TAX_DECLARATION_STATUSES,
  TAX_REGIME_LABELS,
  TAX_REGIMES,
} from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@hrms/ui/components/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { formatMoney } from '@/features/payroll/api';
import {
  currentMonth,
  type EmployeeTaxRow,
  financialYearOf,
  taxApi,
  taxKeys,
} from '@/features/tax/api';
import { DeclarationStatusBadge } from '@/features/tax/components/tax-summary-cards';

/**
 * Everybody's tax position for a year.
 *
 * A dash rather than a zero wherever the financial year has no confirmed
 * configuration: "no rules entered" and "no tax due" are different answers and
 * must not render the same.
 */
export default function TaxEmployeesPage() {
  const month = currentMonth();
  const [financialYear, setFinancialYear] = useState(() => financialYearOf(month));
  const [regime, setRegime] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');

  const filters = {
    // 'ALL' is a sentinel: Base UI's Select cannot hold an empty string, so the
    // "no filter" choice needs a value and the query strips it here.
    ...(regime !== 'ALL' ? { regime } : {}),
    ...(status !== 'ALL' ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };

  const query = useQuery({
    queryKey: taxKeys.employees(financialYear, month, filters),
    queryFn: () => taxApi.employees(financialYear, month, filters),
  });

  const configs = useQuery({
    queryKey: taxKeys.configuration(),
    queryFn: () => taxApi.configuration(),
  });
  const years = [...new Set((configs.data ?? []).map((row) => row.financialYear))].sort().reverse();
  // Same banner as the employee page, for the same reason: HR is the one who
  // would otherwise quote these figures to somebody.
  const placeholderSource =
    (configs.data ?? []).find(
      (row) => row.financialYear === financialYear && row.source?.startsWith('PLACEHOLDER'),
    )?.source ?? null;

  const money = (value: number | null) =>
    value === null ? <span className="text-muted-foreground">—</span> : formatMoney(value);

  const columns: Column<EmployeeTaxRow>[] = [
    {
      key: 'employee',
      header: 'Employee',
      alwaysVisible: true,
      render: (row) => (
        <Link
          href={`/payroll/tax/employees/${row.employeeId}`}
          className="font-medium hover:underline"
        >
          {row.firstName} {row.lastName}
        </Link>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      render: (row) => <span className="font-mono text-xs">{row.employeeCode}</span>,
    },
    { key: 'department', header: 'Department', render: (row) => row.department ?? '—' },
    {
      key: 'regime',
      header: 'Regime',
      render: (row) => <Badge variant="outline">{TAX_REGIME_LABELS[row.regime]}</Badge>,
    },
    {
      key: 'declaration',
      header: 'Declaration',
      render: (row) =>
        row.declarationStatus ? (
          <DeclarationStatusBadge status={row.declarationStatus} />
        ) : (
          <span className="text-muted-foreground text-sm">
            {row.regime === 'NEW' ? 'Not needed' : 'None'}
          </span>
        ),
    },
    {
      key: 'taxable',
      header: 'Taxable income',
      render: (row) => <span className="tabular-nums">{money(row.projectedTaxableIncome)}</span>,
    },
    {
      key: 'annual',
      header: 'Annual tax',
      render: (row) => <span className="tabular-nums">{money(row.annualTax)}</span>,
    },
    {
      key: 'deducted',
      header: 'Deducted',
      render: (row) => <span className="tabular-nums">{money(row.alreadyDeducted)}</span>,
    },
    {
      key: 'remaining',
      header: 'Remaining',
      render: (row) => <span className="tabular-nums">{money(row.remainingTax)}</span>,
    },
    {
      key: 'monthly',
      header: 'This month',
      render: (row) => (
        <span className="flex items-center justify-end gap-2 tabular-nums">
          {money(row.monthlyTds)}
          {row.overridden && <Badge variant="outline">Override</Badge>}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {placeholderSource && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <span className="font-medium">These tax rates are placeholders.</span> {placeholderSource}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* The same filter bar every other list uses — design-system Select and
            the InputGroup search, not bare HTML controls. */}
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon>
            <Search className="size-4" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name or code"
            aria-label="Search employees"
          />
        </InputGroup>

        <Select value={financialYear} onValueChange={setFinancialYear}>
          <SelectTrigger className="w-36" aria-label="Financial year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(years.length > 0 ? years : [financialYear]).map((year) => (
              <SelectItem key={year} value={year}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={regime} onValueChange={setRegime}>
          <SelectTrigger className="w-44" aria-label="Filter by regime">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any regime</SelectItem>
            {TAX_REGIMES.map((option) => (
              <SelectItem key={option} value={option}>
                {TAX_REGIME_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44" aria-label="Filter by declaration status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any declaration</SelectItem>
            {TAX_DECLARATION_STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {TAX_DECLARATION_STATUS_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={query.data}
        rowKey={(row) => row.employeeId}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="Nobody matches"
        emptyHint="Try a different year or clear the filters."
      />

      <p className="text-muted-foreground text-xs">
        Figures are as of payroll month {month}. A dash means FY {financialYear} has no confirmed
        tax rules yet — that is not the same as no tax being due.
      </p>
    </div>
  );
}
