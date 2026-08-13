'use client';

import { type ProjectMemberCreateInput, projectMemberCreateSchema } from '@hrms/shared';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormDatePicker, FormInput, FormSelect } from '@/components/form';
import { employeesApi } from '@/features/employees/api';
import { fullName } from '@/features/employees/types';
import { useZodForm } from '@/hooks/use-zod-form';
import type { ProjectMember } from '../api';

const BLANK: ProjectMemberCreateInput = {
  employeeId: '',
  role: null,
  allocation: 100,
  joinedOn: '',
  leftOn: null,
};

/**
 * Staffing somebody onto a project, or changing how they sit on it.
 *
 * `employeeId` is fixed once the membership exists. Moving one to a different
 * person would silently reassign hours already logged under it — remove them
 * and add the other one, which the API refuses to do once there are any.
 */
export function MemberFormDialog({
  open,
  member,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The membership being edited, or null when staffing somebody new. */
  member: ProjectMember | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: ProjectMemberCreateInput) => void;
}) {
  const form = useZodForm<ProjectMemberCreateInput>(projectMemberCreateSchema, {
    defaultValues: BLANK,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(
      member
        ? {
            employeeId: member.employeeId,
            role: member.role,
            allocation: member.allocation,
            joinedOn: member.joinedOn,
            leftOn: member.leftOn,
          }
        : BLANK,
    );
  }, [open, member, form]);

  const people = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => employeesApi.options(),
    enabled: !member,
  });

  const joinedOn = form.watch('joinedOn');

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={
        member
          ? `Edit ${member.employee ? fullName(member.employee) : 'this member'}`
          : 'Add somebody to the project'
      }
      submitting={submitting}
      submitLabel="Save"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      {member ? null : (
        <FormSelect
          control={form.control}
          name="employeeId"
          label="Who"
          placeholder="Choose somebody"
          busy={people.isPending}
          required
        >
          {(people.data ?? []).map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {fullName(person)} · {person.employeeCode}
            </SelectItem>
          ))}
        </FormSelect>
      )}
      <FormInput
        control={form.control}
        name="role"
        label="What they do here"
        placeholder="Engineer"
        hint="Free text — a job title rarely describes a project role."
      />
      <FormInput
        control={form.control}
        name="allocation"
        label="Allocation"
        type="number"
        min="1"
        max="100"
        hint="Percent of their time. Planning only — it is never checked against the hours they log."
        required
      />
      <FormDatePicker control={form.control} name="joinedOn" label="Joined on" required />
      <FormDatePicker
        control={form.control}
        name="leftOn"
        label="Left on"
        min={joinedOn || null}
        hint="Set this when somebody rolls off. Their logged hours stay."
      />
    </FormDialog>
  );
}
