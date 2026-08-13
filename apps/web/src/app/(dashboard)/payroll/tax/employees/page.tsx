'use client';

import { TAX_DECLARATION_STATUSES, TAX_REGIME_LABELS, TAX_REGIMES } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Input } from '@hrms/ui/components/input';
import { useQuery } from '@tanstack/react-query';
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
  const [regime, setRegime] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');

  const filters = {
    ...(regime ? { regime } : {}),
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };

  const query = useQuery({
    queryKey: taxKeys.employees(financialYear, month, filters),
    queryFn: () => taxApi.employees(financialYear, month, filters),
  });

  const years = useQuery({
    queryKey: taxKeys.configuration(),
    queryFn: () => taxApi.configuration(),
    select: (rows) => [...new Set(rows.map((row) => row.financialYear))].sort().reverse(),
  });

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
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="fy" className="font-medium text-sm">
            Financial year
          </label>
          <select
            id="fy"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={financialYear}
            onChange={(event) => setFinancialYear(event.target.value)}
          >
            {(years.data ?? [financialYear]).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="regime" className="font-medium text-sm">
            Regime
          </label>
          <select
            id="regime"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={regime}
            onChange={(event) => setRegime(event.target.value)}
          >
            <option value="">All</option>
            {TAX_REGIMES.map((option) => (
              <option key={option} value={option}>
                {TAX_REGIME_LABELS[option]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="status" className="font-medium text-sm">
            Declaration
          </label>
          <select
            id="status"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All</option>
            {TAX_DECLARATION_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="search" className="font-medium text-sm">
            Search
          </label>
          <Input
            id="search"
            placeholder="Name or code"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
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
