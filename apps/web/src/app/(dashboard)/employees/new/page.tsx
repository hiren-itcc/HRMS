'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/components/session-provider';
import { EmployeeForm } from '@/features/employees/components/employee-form';

export default function NewEmployeePage() {
  const router = useRouter();
  const { can, status } = useSession();

  // Same reason as the edit page: redirect in an effect, never during render.
  const redirecting = status === 'authenticated' && !can('employee.create');

  useEffect(() => {
    if (redirecting) router.replace('/employees');
  }, [redirecting, router]);

  if (redirecting) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1>Add employee</h1>
        <p className="text-muted-foreground text-sm">
          Create the HR record — a login invite can be sent later
        </p>
      </div>
      <EmployeeForm onSaved={(id) => router.replace(`/employees/${id}`)} />
    </div>
  );
}
