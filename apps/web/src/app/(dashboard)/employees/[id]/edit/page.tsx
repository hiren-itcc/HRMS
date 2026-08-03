'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/components/session-provider';
import { employeesApi } from '@/features/employees/api';
import { EmployeeForm } from '@/features/employees/components/employee-form';
import { fullName } from '@/features/employees/types';

export default function EditEmployeePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, status } = useSession();
  const employee = useQuery({
    queryKey: ['employees', 'detail', id],
    queryFn: () => employeesApi.detail(id),
  });

  /*
   * Someone who can read the record but not change it is sent back to the
   * detail page rather than shown an error — the edit route is reachable by
   * URL alone. The redirect has to happen in an effect: navigating during
   * render updates the Router while this component is still rendering.
   */
  const redirecting = status === 'authenticated' && !can('employee.update');

  useEffect(() => {
    if (redirecting) router.replace(`/employees/${id}`);
  }, [redirecting, router, id]);

  if (redirecting) return null;
  if (employee.isLoading) return <Skeleton className="h-96 w-full max-w-3xl rounded-xl" />;
  if (!employee.data) return null;
  const e = employee.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1>Edit {fullName(e)}</h1>
        <p className="text-muted-foreground text-sm">{e.employeeCode}</p>
      </div>
      <EmployeeForm
        employeeId={id}
        initial={{
          employeeCode: e.employeeCode,
          firstName: e.firstName,
          lastName: e.lastName,
          workEmail: e.workEmail,
          personalEmail: e.personalEmail ?? '',
          phone: e.phone ?? '',
          dateOfBirth: e.dateOfBirth?.slice(0, 10) ?? '',
          gender: e.gender ?? undefined,
          addressLine: e.addressLine ?? '',
          city: e.city ?? '',
          country: e.country ?? '',
          /*
           * Job details are required now, but records created before that may
           * hold nulls. Seeding them as empty means the field shows unanswered
           * and has to be filled before the edit can be saved, rather than the
           * gap silently surviving another round trip.
           */
          departmentId: e.departmentId ?? '',
          designationId: e.designationId ?? '',
          locationId: e.locationId ?? '',
          shiftId: e.shiftId ?? '',
          employmentTypeId: e.employmentTypeId ?? '',
          managerId: e.managerId,
          /*
           * An onboarding hire has no settable status to show — they leave
           * that state by being approved, not by an edit here. Omitting it
           * keeps the select on its default rather than offering a value the
           * API would reject.
           */
          status: e.status === 'ONBOARDING' ? undefined : e.status,
          joinDate: e.joinDate.slice(0, 10),
        }}
        onSaved={(savedId) => {
          queryClient.invalidateQueries({ queryKey: ['employees'] });
          router.replace(`/employees/${savedId}`);
        }}
      />
    </div>
  );
}
