'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
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

  if (status === 'authenticated' && !can('employee.update')) {
    router.replace(`/employees/${id}`);
    return null;
  }

  if (employee.isLoading) return <Skeleton className="h-96 w-full max-w-3xl rounded-xl" />;
  if (!employee.data) return null;
  const e = employee.data;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Edit {fullName(e)}</h1>
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
          departmentId: e.departmentId,
          designationId: e.designationId,
          locationId: e.locationId,
          managerId: e.managerId,
          shiftId: e.shiftId,
          employmentTypeId: e.employmentTypeId,
          status: e.status,
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
