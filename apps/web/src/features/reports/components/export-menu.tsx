'use client';

import { Button } from '@hrms/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@hrms/ui/components/dropdown-menu';
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/components/session-provider';
import { type ReportName, type ReportRange, reportsApi } from '../api';

interface ExportMenuProps {
  report: ReportName;
  range: ReportRange;
  /** Renders every row, then prints — the browser is the PDF writer. */
  onPrint: () => void;
}

export function ExportMenu({ report, range, onPrint }: ExportMenuProps) {
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const canExport = can('report.export');

  async function download(format: 'csv' | 'excel') {
    setBusy(true);
    try {
      await reportsApi.download(report, range, format);
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
          <Button variant="outline" size="sm" disabled={busy} className="gap-2 print:hidden" />
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
        {/* Viewing and extracting are separate privileges: a manager may read
            their team's numbers without being able to walk out with the file.
            Shown-but-disabled so the restriction is visible, not mysterious. */}
        <DropdownMenuItem disabled={!canExport} onClick={() => download('csv')}>
          <FileText className="size-4" aria-hidden />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canExport} onClick={() => download('excel')}>
          <FileSpreadsheet className="size-4" aria-hidden />
          Excel
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTimeout(onPrint, 0)}>
          <Printer className="size-4" aria-hidden />
          PDF / Print
        </DropdownMenuItem>
        {!canExport && (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            File export needs the “report.export” permission.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
