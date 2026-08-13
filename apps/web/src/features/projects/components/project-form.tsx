'use client';

import {
  PROJECT_STATUS_LABELS,
  PROJECT_STATUSES,
  type ProjectCreateInput,
  projectCreateSchema,
} from '@hrms/shared';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormDatePicker, FormInput, FormSelect, FormTextarea } from '@/components/form';
import { employeesApi } from '@/features/employees/api';
import { fullName } from '@/features/employees/types';
import { useZodForm } from '@/hooks/use-zod-form';
import type { Project } from '../api';

export const BLANK_PROJECT: ProjectCreateInput = {
  code: '',
  name: '',
  description: null,
  status: 'PLANNED',
  startsOn: '',
  endsOn: null,
  managerId: '',
};

function toInput(project: Project): ProjectCreateInput {
  return {
    code: project.code,
    name: project.name,
    description: project.description,
    status: project.status,
    startsOn: project.startsOn,
    endsOn: project.endsOn,
    managerId: project.managerId,
  };
}

/**
 * Opening or editing a project.
 *
 * The code stays editable, unlike a pay component's: nothing in this module
 * looks a project up by code — the engine that would break does not exist here,
 * and `@@unique([organizationId, code])` is what keeps two from colliding.
 */
export function ProjectFormDialog({
  open,
  project,
  submitting,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** The project being edited, or null when opening a new one. */
  project: Project | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: ProjectCreateInput) => void;
}) {
  const form = useZodForm<ProjectCreateInput>(projectCreateSchema, {
    defaultValues: BLANK_PROJECT,
  });

  useEffect(() => {
    if (open) form.reset(project ? toInput(project) : BLANK_PROJECT);
  }, [open, project, form]);

  const people = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => employeesApi.options(),
  });

  const startsOn = form.watch('startsOn');

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={project ? 'Edit the project' : 'Open a project'}
      submitting={submitting}
      submitLabel="Save"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <FormInput
        control={form.control}
        name="name"
        label="Name"
        placeholder="Apollo replatform"
        required
      />
      <FormInput
        control={form.control}
        name="code"
        label="Code"
        placeholder="APOLLO"
        hint="Capitals, numbers, hyphens and underscores. Shown wherever the name will not fit."
        required
      />
      <FormTextarea
        control={form.control}
        name="description"
        label="What it is"
        placeholder="One line somebody outside the team would understand."
      />
      <FormSelect control={form.control} name="status" label="Status" required>
        {PROJECT_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {PROJECT_STATUS_LABELS[status]}
          </SelectItem>
        ))}
      </FormSelect>
      <FormSelect
        control={form.control}
        name="managerId"
        label="Who runs it"
        placeholder="Choose a project manager"
        hint="They can staff the project without any HR permission."
        busy={people.isPending}
        required
      >
        {(people.data ?? []).map((person) => (
          <SelectItem key={person.id} value={person.id}>
            {fullName(person)} · {person.employeeCode}
          </SelectItem>
        ))}
      </FormSelect>
      <FormDatePicker control={form.control} name="startsOn" label="Starts on" required />
      <FormDatePicker
        control={form.control}
        name="endsOn"
        label="Ends on"
        min={startsOn || null}
        hint="Leave blank while it is open-ended. Hours cannot be logged past it."
      />
    </FormDialog>
  );
}
