'use client';

import { ONBOARDING_DOCUMENTS, type OnboardingDocumentSlot } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ACCEPTED_TYPES, documentsApi, formatBytes } from '@/features/documents/api';
import { type OnboardingRecord, onboardingApi, onboardingKeys } from '@/features/onboarding/api';
import { ApiError } from '@/lib/api-client';

/** Which column on the record holds each slot's document id. */
const SLOT_FIELD = {
  idProof: 'idProofDocId',
  bankProof: 'bankProofDocId',
  education: 'educationDocId',
  prevEmployment: 'prevEmploymentDocId',
} as const satisfies Record<OnboardingDocumentSlot, keyof OnboardingRecord>;

/**
 * The checklist drives the upload, not the other way round.
 *
 * A generic file browser cannot tick a checklist off: the employee uploads a
 * PNG into a folder and nothing knows it was meant to be the ID proof. So each
 * requirement gets its own control, which uploads into the right folder and
 * files it against the slot in one action.
 */
export function OnboardingDocuments({
  record,
  employeeId,
  disabled,
}: {
  record: OnboardingRecord;
  employeeId: string;
  disabled: boolean;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<OnboardingDocumentSlot | null>(null);
  const inputs = useRef<Partial<Record<OnboardingDocumentSlot, HTMLInputElement | null>>>({});

  const folders = useQuery({
    queryKey: ['documents', 'folders', employeeId],
    queryFn: () => documentsApi.folders(employeeId),
  });

  // Everything already on file, so an employee who uploaded before we asked
  // can point at it instead of uploading the same picture twice.
  const existing = useQuery({
    queryKey: ['documents', 'list', employeeId],
    queryFn: () => documentsApi.list(employeeId),
  });

  const attach = useMutation({
    mutationFn: (input: { slot: OnboardingDocumentSlot; documentId: string }) =>
      onboardingApi.attach(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: onboardingKeys.all() }),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not file that document'),
  });

  async function uploadFor(slot: OnboardingDocumentSlot, file: File, folderName: string) {
    setBusy(slot);
    try {
      const folderId = folders.data?.find((f) => f.name === folderName)?.id;
      const doc = await documentsApi.upload(employeeId, file, folderId, () => undefined);
      await attach.mutateAsync({ slot, documentId: doc.id });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success(`${file.name} filed`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Could not upload ${file.name}`);
    } finally {
      setBusy(null);
    }
  }

  const firstJob = record.hasPreviousEmployment === false;

  return (
    <ul className="space-y-2">
      {ONBOARDING_DOCUMENTS.map((item) => {
        const attachedId = record[SLOT_FIELD[item.slot]] as string | null;
        const attached = existing.data?.find((d) => d.id === attachedId);
        // A first-jobber has no relieving letter; the declaration answers it.
        const notApplicable = item.slot === 'prevEmployment' && firstJob;

        return (
          <li
            key={item.slot}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={
                  attachedId || notApplicable
                    ? 'flex size-7 shrink-0 items-center justify-center rounded-full bg-success/15 text-success-text'
                    : 'flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground'
                }
              >
                {attachedId || notApplicable ? (
                  <Check className="size-4" aria-hidden />
                ) : (
                  <Upload className="size-3.5" aria-hidden />
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium text-sm">{item.label}</span>
                <span className="block truncate text-muted-foreground text-xs">
                  {notApplicable
                    ? 'Not needed — you said this is your first job'
                    : attached
                      ? `${attached.name} · ${formatBytes(attached.sizeBytes)}`
                      : item.hint}
                </span>
              </span>
            </div>

            {!notApplicable && !disabled && (
              <div className="flex flex-wrap items-center gap-2">
                {(existing.data?.length ?? 0) > 0 && (
                  <Select
                    value={attachedId ?? ''}
                    onValueChange={(documentId) => attach.mutate({ slot: item.slot, documentId })}
                  >
                    <SelectTrigger
                      className="w-44"
                      aria-label={`Use an uploaded file for ${item.label}`}
                    >
                      <SelectValue placeholder="Use uploaded file" />
                    </SelectTrigger>
                    <SelectContent>
                      {existing.data?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <input
                  ref={(el) => {
                    inputs.current[item.slot] = el;
                  }}
                  type="file"
                  accept={ACCEPTED_TYPES}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadFor(item.slot, file, item.folder);
                    event.target.value = '';
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => inputs.current[item.slot]?.click()}
                >
                  {busy === item.slot ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Upload className="size-4" aria-hidden />
                  )}
                  {attachedId ? 'Replace' : 'Upload'}
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
