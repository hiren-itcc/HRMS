'use client';

import { type TicketCreateInput, ticketCreateSchema } from '@hrms/shared';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormInput, FormSelect, FormTextarea } from '@/components/form';
import { helpdeskApi, helpdeskKeys } from '@/features/helpdesk/api';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

/**
 * Raise a ticket.
 *
 * Three fields, and no priority among them: priority is the desk's to set, and
 * a field the person asking controls is a field that is always URGENT. Urgency
 * belongs in the description, where it can be read rather than ranked.
 *
 * Only active categories are offered — a deactivated desk still holds its old
 * tickets so the history stays readable, but nothing new should land on it.
 */
export function TicketFormDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const categories = useQuery({
    queryKey: helpdeskKeys.categories(true),
    queryFn: () => helpdeskApi.listCategories(true),
    enabled: open,
  });

  const form = useZodForm<TicketCreateInput>(ticketCreateSchema, {
    defaultValues: { categoryId: '', subject: '', description: '' },
  });

  const raise = useApiMutation({
    mutationFn: (values: TicketCreateInput) => helpdeskApi.create(values),
    invalidate: [helpdeskKeys.all()],
    success: 'Ticket raised',
    onSuccess: () => {
      form.reset();
      onOpenChange(false);
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Raise a ticket"
      submitting={raise.isPending}
      submitLabel="Send it"
      onSubmit={form.handleSubmit((values) => raise.mutate(values))}
    >
      <FormSelect
        control={form.control}
        name="categoryId"
        label="What is this about"
        placeholder="Pick a desk"
        required
      >
        {(categories.data ?? []).map((category) => (
          <SelectItem key={category.id} value={category.id}>
            {category.name}
          </SelectItem>
        ))}
      </FormSelect>

      <FormInput
        control={form.control}
        name="subject"
        label="Subject"
        placeholder="Payslip is missing a reimbursement"
        required
      />

      <FormTextarea
        control={form.control}
        name="description"
        label="What do you need"
        placeholder="Say what happened, and what you expected instead."
        hint="If it is urgent, say so here — the desk sets the priority."
        rows={6}
        required
      />
    </FormDialog>
  );
}
