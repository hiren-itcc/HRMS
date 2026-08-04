'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ANNOUNCEMENT_CATEGORY_LABELS,
  ANNOUNCEMENT_PRIORITY_LABELS,
  announcementCreateSchema,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Label } from '@hrms/ui/components/label';
import { SelectItem } from '@hrms/ui/components/select';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormCheckbox, FormField, FormInput, FormSelect } from '@/components/form';
import { departmentsApi, locationsApi } from '@/features/organization/api';
import { errorMessage, useApiMutation, useOptions } from '@/hooks/use-crud';
import { type Announcement, announcementsApi } from '../api';
import { RichTextEditor } from './rich-text-editor';

type FormValues = z.input<typeof announcementCreateSchema>;

/** datetime-local wants "YYYY-MM-DDTHH:mm" in local time. */
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface ComposeProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing announcement. */
  editing: Announcement | null;
}

export function ComposeDialog({ open, onOpenChange, editing }: ComposeProps) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);

  const form = useForm<FormValues>({ resolver: zodResolver(announcementCreateSchema) });
  const audience = form.watch('audience') ?? 'ALL';

  const departments = useOptions('org-departments', departmentsApi.options, (d) => d.name, {
    enabled: open,
  });
  const locations = useOptions('org-locations', locationsApi.options, (l) => l.name, {
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: editing?.title ?? '',
      body: editing?.body ?? '',
      category: editing?.category ?? 'GENERAL',
      priority: editing?.priority ?? 'NORMAL',
      audience: editing?.audience ?? 'ALL',
      departmentId: editing?.departmentId ?? null,
      locationId: editing?.locationId ?? null,
      isPinned: editing?.isPinned ?? false,
      publishAt: editing ? toLocalInput(editing.publishAt) : '',
      expiresAt: editing ? toLocalInput(editing.expiresAt) : '',
    });
  }, [open, editing, form]);

  const save = useApiMutation({
    mutationFn: (values: FormValues) => {
      const parsed = announcementCreateSchema.parse(values);
      // datetime-local gives local wall time — send a real instant
      const payload = {
        ...parsed,
        publishAt: parsed.publishAt ? new Date(parsed.publishAt).toISOString() : undefined,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt).toISOString() : null,
      };
      return editing
        ? announcementsApi.update(editing.id, payload)
        : announcementsApi.create(payload);
    },
    invalidate: [['announcements']],
    success: (saved) =>
      editing
        ? 'Announcement updated'
        : saved.isScheduled
          ? 'Announcement scheduled'
          : 'Announcement published',
    error: 'Could not save the announcement',
    onSuccess: (_saved) => {
      onOpenChange(false);
    },
  });

  const attach = async (files: FileList) => {
    if (!editing) return;
    for (const file of Array.from(files)) {
      setUploading({ name: file.name, percent: 0 });
      try {
        await announcementsApi.addAttachment(editing.id, file, (percent) =>
          setUploading({ name: file.name, percent }),
        );
        toast.success(`${file.name} attached`);
      } catch (err) {
        toast.error(errorMessage(err, `Could not attach ${file.name}`));
      }
    }
    setUploading(null);
    queryClient.invalidateQueries({ queryKey: ['announcements'] });
  };

  const detach = useApiMutation({
    mutationFn: announcementsApi.removeAttachment,
    invalidate: [['announcements']],
    success: 'Attachment removed',
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit announcement' : 'New announcement'}
      description="Markdown is supported. Leave the publish time empty to post immediately."
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      submitting={save.isPending}
      submitLabel={editing ? 'Save changes' : 'Publish'}
    >
      <FormInput
        control={form.control}
        name="title"
        label="Title"
        autoFocus
        placeholder="Diwali holiday schedule"
      />

      {/* RichTextEditor is feature-local, so it uses the escape hatch. */}
      <FormField control={form.control} name="body" label="Message">
        {({ field, a11y }) => (
          <RichTextEditor
            id={a11y.id}
            aria-invalid={a11y['aria-invalid']}
            aria-describedby={a11y['aria-describedby']}
            value={field.value ?? ''}
            onChange={field.onChange}
          />
        )}
      </FormField>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormSelect control={form.control} name="category" label="Category">
          {Object.entries(ANNOUNCEMENT_CATEGORY_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </FormSelect>
        <FormSelect control={form.control} name="priority" label="Priority">
          {Object.entries(ANNOUNCEMENT_PRIORITY_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </FormSelect>
      </div>

      {/*
       * Narrowing the audience hides the other select but did not clear what it
       * held, so an announcement aimed at a location was still submitted with
       * the department somebody picked a moment earlier. Whichever id the new
       * audience does not use is dropped.
       */}
      <FormSelect
        control={form.control}
        name="audience"
        label="Audience"
        onValueChange={(next) => {
          if (next !== 'DEPARTMENT') form.setValue('departmentId', null, { shouldDirty: true });
          if (next !== 'LOCATION') form.setValue('locationId', null, { shouldDirty: true });
        }}
      >
        <SelectItem value="ALL">Everyone</SelectItem>
        <SelectItem value="DEPARTMENT">A department</SelectItem>
        <SelectItem value="LOCATION">A location</SelectItem>
      </FormSelect>

      {audience === 'DEPARTMENT' && (
        <FormSelect
          control={form.control}
          name="departmentId"
          label="Department"
          required
          busy={departments.options === undefined}
          placeholder="Choose a department"
        >
          {departments.options?.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.label}
            </SelectItem>
          ))}
        </FormSelect>
      )}

      {audience === 'LOCATION' && (
        <FormSelect
          control={form.control}
          name="locationId"
          label="Location"
          required
          busy={locations.options === undefined}
          placeholder="Choose a location"
        >
          {locations.options?.map((l) => (
            <SelectItem key={l.id} value={l.id}>
              {l.label}
            </SelectItem>
          ))}
        </FormSelect>
      )}

      {/*
       * datetime-local rather than FormDatePicker: these carry a time as well
       * as a date, and the picker is date-only.
       */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          control={form.control}
          name="publishAt"
          label="Publish at"
          hint="Leave empty to post now"
          type="datetime-local"
        />
        <FormInput
          control={form.control}
          name="expiresAt"
          label="Expires at"
          hint="Optional"
          type="datetime-local"
        />
      </div>

      <FormCheckbox control={form.control} name="isPinned" label="Pin to the top of the feed" />

      {/* Attachments need an announcement id, so they appear once it exists */}
      {editing ? (
        <div className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm">Attachments</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading !== null}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Paperclip className="size-4" aria-hidden />
              )}
              Attach file
            </Button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) attach(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {uploading && (
            <div className="space-y-1">
              <p className="truncate text-muted-foreground text-xs">
                {uploading.name} — {uploading.percent}%
              </p>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="gradient-primary h-full rounded-full transition-[width] duration-200"
                  style={{ width: `${uploading.percent}%` }}
                />
              </div>
            </div>
          )}
          {editing.attachments.length === 0 && !uploading && (
            <p className="text-muted-foreground text-xs">No files attached yet.</p>
          )}
          <ul className="space-y-1">
            {editing.attachments.map((att) => (
              <li
                key={att.id}
                className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs"
              >
                <span className="truncate">{att.name}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-destructive hover:text-destructive"
                  aria-label={`Remove ${att.name}`}
                  onClick={() => detach.mutate(att.id)}
                >
                  <X className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Publish first, then reopen the announcement to attach files.
        </p>
      )}
    </FormDialog>
  );
}
