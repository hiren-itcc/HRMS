'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { FileWarning } from 'lucide-react';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { payrollApi } from '@/features/payroll/api';
import { StructureForm } from '@/features/payroll/components/structure-form';

export default function EditStructurePage() {
  const { id } = useParams<{ id: string }>();
  const { can, status } = useSession();
  const canManage = can('payroll.structure.manage');

  const structure = useQuery({
    queryKey: ['payroll', 'structures', id],
    queryFn: () => payrollApi.structure(id),
    enabled: canManage,
    retry: false,
  });

  if (status === 'authenticated' && !canManage) return <NoAccess what="salary structures" />;
  if (structure.isLoading) return <Skeleton className="h-96 w-full" />;
  if (structure.isError || !structure.data) {
    return (
      <EmptyState
        icon={FileWarning}
        title="Structure not found"
        hint="It may have been deleted since this page was opened."
        className="py-24"
      />
    );
  }

  return <StructureForm existing={structure.data} />;
}
