'use client';

import { type ExpenseClaimCreateInput, expenseClaimCreateSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { SelectItem } from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Paperclip, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormDatePicker, FormInput, FormSelect } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { documentsApi } from '@/features/documents/api';
import { expenseKeys, expensesApi } from '@/features/expenses/api';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const BLANK_LINE = {
  categoryId: '',
  spentOn: '',
  amount: 0,
  description: '',
  receiptId: null,
};

/**
 * Raise or edit a claim.
 *
 * Lines are held in one array and posted whole, because that is what the API
 * does with them — `update` replaces them wholesale, so a half-saved claim is a
 * state that cannot happen. Same call emergency contacts make.
 *
 * Receipts go through the ordinary document upload, so they land in the
 * claimant's own folder and inherit its permission checks. That does mean
 * anybody with `document.read` over that person can see a receipt, which is the
 * right default — it is their document — but it is a decision rather than an
 * accident. The one addition on top of those checks: whoever may read the
 * claim may open its receipt (`readableAsReceipt` in the documents service),
 * because Finance approves claims while holding no document scope beyond its
 * own.
 */
export function ClaimFormDialog({
  claimId,
  initial,
  open,
  onOpenChange,
}: {
  /** Absent for a new claim. */
  claimId?: string;
  initial?: ExpenseClaimCreateInput;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadingInto, setUploadingInto] = useState<number | null>(null);

  const categories = useQuery({
    queryKey: expenseKeys.categories(),
    queryFn: expensesApi.categories,
    enabled: open,
  });

  const form = useZodForm<ExpenseClaimCreateInput>(expenseClaimCreateSchema, {
    defaultValues: initial ?? { title: '', items: [BLANK_LINE] },
  });

  const items = form.watch('items') ?? [];

  const save = useApiMutation({
    mutationFn: (values: ExpenseClaimCreateInput) =>
      claimId ? expensesApi.update(claimId, values) : expensesApi.create(values),
    invalidate: [expenseKeys.all()],
    success: 'Claim saved',
    onSuccess: () => onOpenChange(false),
  });

  const setLines = (next: typeof items) =>
    form.setValue('items', next, { shouldDirty: true, shouldValidate: true });

  const attach = async (file: File, index: number) => {
    const employeeId = user?.employee?.id;
    if (!employeeId) return;
    setUploadingInto(index);
    try {
      const document = await documentsApi.upload(employeeId, file, undefined, () => {});
      const next = [...items];
      next[index] = { ...next[index], receiptId: document.id };
      setLines(next);
      toast.success('Receipt attached');
    } catch {
      toast.error('That receipt could not be attached');
    } finally {
      setUploadingInto(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={claimId ? 'Edit the claim' : 'New claim'}
      submitting={save.isPending}
      submitLabel="Save"
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
    >
      <FormInput
        control={form.control}
        name="title"
        label="What is this claim for"
        placeholder="Client visit, Pune"
        required
      />

      <div className="space-y-4">
        {items.map((line, index) => (
          <div
            // Index is the identity here: lines have no id until they are saved,
            // and the array is replaced wholesale rather than reordered.
            // biome-ignore lint/suspicious/noArrayIndexKey: unsaved lines have no id
            key={index}
            className="space-y-3 rounded-lg border p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm">Line {index + 1}</p>
              {items.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove line ${index + 1}`}
                  onClick={() => setLines(items.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </div>

            <FormSelect
              control={form.control}
              name={`items.${index}.categoryId`}
              label="Category"
              placeholder="What kind of spend"
              busy={categories.isPending}
              required
            >
              {(categories.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </FormSelect>

            <FormDatePicker
              control={form.control}
              name={`items.${index}.spentOn`}
              label="Date"
              required
            />

            <FormInput
              control={form.control}
              name={`items.${index}.amount`}
              label="Amount"
              type="number"
              step="0.01"
              placeholder="0.00"
              required
            />

            <FormInput
              control={form.control}
              name={`items.${index}.description`}
              label="What was it"
              placeholder="Return train fare"
              required
            />

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingInto !== null}
              onClick={() => {
                setUploadingInto(index);
                fileInput.current?.click();
              }}
            >
              <Paperclip className="size-4" aria-hidden />
              {line.receiptId ? 'Replace the receipt' : 'Attach a receipt'}
            </Button>
          </div>
        ))}
      </div>

      {/* One input for every line: the button that opens it records which line
          it is filling, so a hidden input per row would be pure duplication. */}
      <input
        ref={fileInput}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,application/pdf"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && uploadingInto !== null) void attach(file, uploadingInto);
        }}
      />

      <Button
        type="button"
        variant="outline"
        onClick={() => setLines([...items, { ...BLANK_LINE }])}
      >
        <Plus className="size-4" aria-hidden /> Add a line
      </Button>
    </FormDialog>
  );
}
