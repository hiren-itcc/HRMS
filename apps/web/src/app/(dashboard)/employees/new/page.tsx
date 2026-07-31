'use client';

import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session-provider';
import { EmployeeForm } from '@/features/employees/components/employee-form';

export default function NewEmployeePage() {
  const router = useRouter();
  const { can, status } = useSession();

  if (status === 'authenticated' && !can('employee.create')) {
    router.replace('/employees');
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Add employee</h1>
        <p className="text-muted-foreground text-sm">
          Create the HR record — a login invite can be sent later
        </p>
      </div>
      <EmployeeForm onSaved={(id) => router.replace(`/employees/${id}`)} />
    </div>
  );
}
