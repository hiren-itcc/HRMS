'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ANNOUNCEMENT_CATEGORY_LABELS,
  ANNOUNCEMENT_PRIORITY_LABELS,
  announcementCreateSchema,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Checkbox } from '@hrms/ui/components/checkbox';
import { Input } from '@hrms/ui/components/input';
import { Label } from '@hrms/ui/components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Paperclip, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { departmentsApi, locationsApi } from '@/features/organization/api';
import { ApiError } from '@/lib/api-client';
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
  const pinnedId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);

  const form = useForm<FormValues>({ resolver: zodResolver(announcementCreateSchema) });
  const audience = form.watch('audience') ?? 'ALL';
  const body = form.watch('body') ?? '';

  const departments = useQuery({
    queryKey: ['org-departments', 'options'],
    queryFn: departmentsApi.options,
    staleTime: 60_000,
    enabled: open,
  });
  const locations = useQuery({
    queryKey: ['org-locations', 'options'],
    queryFn: locationsApi.options,
    staleTime: 60_000,
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

  const save = useMutation({
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
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.success(
        editing
          ? 'Announcement updated'
          : saved.isScheduled
            ? 'Announcement scheduled'
            : 'Announcement published',
      );
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not save the announcement'),
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
        toast.error(err instanceof ApiError ? err.message : `Could not attach ${file.name}`);
      }
    }
    setUploading(null);
    queryClient.invalidateQueries({ queryKey: ['announcements'] });
  };

  const detach = useMutation({
    mutationFn: announcementsApi.removeAttachment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] });
      toast.success('Attachment removed');
    },
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
      <Field label="Title" error={form.formState.errors.title?.message}>
        {(a11y) => (
          <Input
            {...a11y}
            autoFocus
            placeholder="Diwali holiday schedule"
            {...form.register('title')}
          />
        )}
      </Field>

      <div className="space-y-2">
        <Label htmlFor="ann-message">Message</Label>
        <RichTextEditor
          id="ann-message"
          value={body}
          onChange={(v) => form.setValue('body', v, { shouldDirty: true, shouldValidate: true })}
          aria-invalid={Boolean(form.formState.errors.body)}
        />
        {form.formState.errors.body && (
          <p role="alert" className="text-destructive-text text-sm">
            {form.formState.errors.body.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ann-category">Category</Label>
          <Select
            value={form.watch('category') ?? 'GENERAL'}
            onValueChange={(v) =>
              form.setValue('category', v as FormValues['category'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="ann-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ANNOUNCEMENT_CATEGORY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ann-priority">Priority</Label>
          <Select
            value={form.watch('priority') ?? 'NORMAL'}
            onValueChange={(v) =>
              form.setValue('priority', v as FormValues['priority'], { shouldDirty: true })
            }
          >
            <SelectTrigger id="ann-priority" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ANNOUNCEMENT_PRIORITY_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ann-audience">Audience</Label>
        <Select
          value={audience}
          onValueChange={(v) =>
            form.setValue('audience', v as FormValues['audience'], { shouldDirty: true })
          }
        >
          <SelectTrigger id="ann-audience" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Everyone</SelectItem>
            <SelectItem value="DEPARTMENT">A department</SelectItem>
            <SelectItem value="LOCATION">A location</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {audience === 'DEPARTMENT' && (
        <div className="space-y-2">
          <Label htmlFor="ann-department">Department</Label>
          <Select
            value={form.watch('departmentId') ?? null}
            onValueChange={(v) => form.setValue('departmentId', v, { shouldDirty: true })}
          >
            <SelectTrigger
              id="ann-department"
              className="w-full"
              aria-invalid={Boolean(form.formState.errors.departmentId)}
            >
              <SelectValue placeholder="Choose a department" />
            </SelectTrigger>
            <SelectContent>
              {departments.data?.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.departmentId && (
            <p role="alert" className="text-destructive-text text-sm">
              {form.formState.errors.departmentId.message}
            </p>
          )}
        </div>
      )}

      {audience === 'LOCATION' && (
        <div className="space-y-2">
          <Label htmlFor="ann-location">Location</Label>
          <Select
            value={form.watch('locationId') ?? null}
            onValueChange={(v) => form.setValue('locationId', v, { shouldDirty: true })}
          >
            <SelectTrigger
              id="ann-location"
              className="w-full"
              aria-invalid={Boolean(form.formState.errors.locationId)}
            >
              <SelectValue placeholder="Choose a location" />
            </SelectTrigger>
            <SelectContent>
              {locations.data?.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.locationId && (
            <p role="alert" className="text-destructive-text text-sm">
              {form.formState.errors.locationId.message}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Publish at"
          error={form.formState.errors.publishAt?.message}
          hint="Leave empty to post now"
        >
          {(a11y) => <Input {...a11y} type="datetime-local" {...form.register('publishAt')} />}
        </Field>
        <Field label="Expires at" error={form.formState.errors.expiresAt?.message} hint="Optional">
          {(a11y) => <Input {...a11y} type="datetime-local" {...form.register('expiresAt')} />}
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id={pinnedId}
          checked={form.watch('isPinned') ?? false}
          onCheckedChange={(v) => form.setValue('isPinned', v === true, { shouldDirty: true })}
        />
        <Label htmlFor={pinnedId} className="font-normal">
          Pin to the top of the feed
        </Label>
      </div>

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
