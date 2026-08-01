'use client';

import { Button } from '@hrms/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@hrms/ui/components/dropdown-menu';
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/components/session-provider';
import { fetchBlob } from '@/lib/api-client';

/**
 * Export for payroll reports.
 *
 * Separate from the reports module's ExportMenu, which is typed to that
 * module's own report names and a from/to range — payroll reports take a
 * month. Bending one to fit both would make the type say less than it knows.
 */
export function PayrollExport({
  kind,
  month,
  disabled,
}: {
  kind: string;
  month: string;
  disabled?: boolean;
}) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const canExport = can('report.export');

  async function download(format: 'csv' | 'excel') {
    setBusy(true);
    try {
      const blob = await fetchBlob(`/payroll/reports/${kind}?month=${month}&format=${format}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hrms-payroll-${kind}-${month}.${format === 'csv' ? 'csv' : 'xls'}`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed', { description: 'Please try again in a moment.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={busy || disabled}
            className="gap-2 print:hidden"
          />
        }
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
        Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {/* Shown-but-disabled without the permission, so the restriction is
            visible rather than mysterious. */}
        <DropdownMenuItem disabled={!canExport} onClick={() => download('csv')}>
          <FileText className="size-4" aria-hidden /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canExport} onClick={() => download('excel')}>
          <FileSpreadsheet className="size-4" aria-hidden /> Excel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
