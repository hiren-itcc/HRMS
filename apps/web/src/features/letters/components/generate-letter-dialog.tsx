'use client';

import { LETTER_TEMPLATES } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@hrms/ui/components/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Field } from '@/components/field';
import { useApiMutation } from '@/hooks/use-crud';
import { type LetterListItem, letterKeys, lettersApi } from '../api';
import { LetterFrame } from './letter-frame';

interface Props {
  employeeId: string;
  employeeName: string;
  /** Already-issued letters, so a second offer is a deliberate choice. */
  existing: LetterListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Letters an employment normally has exactly one of. */
const ONCE_PER_EMPLOYMENT = new Set(['offer_letter', 'appointment_letter']);

/**
 * Pick a template, see the real letter, then issue it. The preview is rendered
 * by the server from the same code path that issues, so what is approved here
 * is what gets frozen.
 */
export function GenerateLetterDialog({
  employeeId,
  employeeName,
  existing,
  open,
  onOpenChange,
}: Props) {
  const _queryClient = useQueryClient();
  const [templateKey, setTemplateKey] = useState(LETTER_TEMPLATES[0]?.key ?? '');

  const preview = useQuery({
    queryKey: ['letters', 'preview', employeeId, templateKey],
    queryFn: () => lettersApi.preview(employeeId, templateKey),
    enabled: open && templateKey !== '',
  });

  const issue = useApiMutation({
    mutationFn: () => lettersApi.issue(employeeId, templateKey),
    invalidate: [letterKeys.all()],
    success: (letter) => `${letter.title} issued — ${letter.letterNumber}`,
    error: 'Could not issue the letter',
    onSuccess: (_letter) => {
      onOpenChange(false);
    },
  });

  const priorOfThisKind = existing.filter((l) => l.templateKey === templateKey);
  const blockers = preview.data?.blockers ?? [];
  const canIssue = preview.isSuccess && blockers.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Generate a letter</DialogTitle>
          <DialogDescription>For {employeeName}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-4">
          <Field label="Letter type">
            {(a11y) => (
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger {...a11y}>
                  <SelectValue placeholder="Choose a letter" />
                </SelectTrigger>
                <SelectContent>
                  {LETTER_TEMPLATES.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          {priorOfThisKind.length > 0 && (
            <p className="rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs">
              {priorOfThisKind.length} already issued, most recently{' '}
              {new Date(priorOfThisKind[0].issuedAt).toLocaleDateString('en-GB')}.
              {ONCE_PER_EMPLOYMENT.has(templateKey) &&
                ' This kind is normally issued once — consider voiding the earlier one.'}
            </p>
          )}

          {blockers.map((blocker) => (
            <p
              key={blocker}
              className="flex items-start gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-destructive-foreground text-xs"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {blocker}
            </p>
          ))}

          {preview.isLoading && <Skeleton className="h-64 w-full rounded-lg" />}
          {preview.data && (
            <div className="overflow-hidden rounded-xl border">
              <p className="border-b bg-muted/40 px-3 py-2 font-medium text-xs">
                {preview.data.title}
              </p>
              <LetterFrame html={preview.data.bodyHtml} className="h-80 w-full border-0 bg-white" />
            </div>
          )}
        </DialogPanel>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canIssue || issue.isPending} onClick={() => issue.mutate()}>
            {issue.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Issue letter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
