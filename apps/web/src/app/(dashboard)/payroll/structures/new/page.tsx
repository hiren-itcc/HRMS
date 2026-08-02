'use client';

import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { StructureForm } from '@/features/payroll/components/structure-form';

/**
 * A static segment, so it wins over `[id]` — `/payroll/structures/new` never
 * resolves as a structure whose id happens to be "new".
 */
export default function NewStructurePage() {
  const { can, status } = useSession();

  if (status === 'authenticated' && !can('payroll.structure.manage')) {
    return <NoAccess what="salary structures" />;
  }
  return <StructureForm />;
}
