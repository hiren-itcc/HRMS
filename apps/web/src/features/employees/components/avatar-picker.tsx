'use client';

import { Button } from '@hrms/ui/components/button';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { prepareAvatar } from '@/features/employees/avatar-image';
import { ApiError, api, uploadFile } from '@/lib/api-client';

/**
 * The avatar, as the control that changes it.
 *
 * A separate "upload a photo" field beside a picture of the current one is two
 * things saying the same thing. The photo is the button.
 *
 * `onDone` is what the caller uses to refresh whatever holds the URL — the
 * session for your own photo, the employee query for somebody else's. This
 * component deliberately does not know which.
 */
export function AvatarPicker({
  src,
  fallback,
  endpoint,
  canEdit,
  onDone,
}: {
  src: string | null | undefined;
  fallback: string;
  /** `/me/avatar` for yourself, `/employees/:id/avatar` for somebody else. */
  endpoint: string;
  canEdit: boolean;
  /** Awaited, so a caller may return a promise or nothing. */
  onDone: () => unknown;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  if (!canEdit) {
    return (
      <EmployeeAvatar
        src={src}
        fallback={fallback}
        className="size-20"
        fallbackClassName="text-xl"
      />
    );
  }

  const finish = async () => {
    // The old photo's bytes are cached under its old path. The new URL carries
    // a different hash so it misses that entry, but the stale one would sit
    // there for the rest of the session.
    await queryClient.invalidateQueries({ queryKey: ['avatar'] });
    await onDone();
  };

  const choose = async (file: File) => {
    setBusy(true);
    try {
      const { blob, filename } = await prepareAvatar(file);
      const form = new FormData();
      form.append('file', blob, filename);
      await uploadFile(endpoint, form, () => {});
      await finish();
      toast.success('Photo updated');
    } catch (error) {
      toast.error(error instanceof ApiError ? error.body.message : 'That photo could not be saved');
    } finally {
      setBusy(false);
      // Lets the same file be chosen again after a failure.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api(endpoint, { method: 'DELETE' });
      await finish();
      toast.success('Photo removed');
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.body.message : 'That photo could not be removed',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <EmployeeAvatar
          src={src}
          fallback={fallback}
          className="size-20"
          fallbackClassName="text-xl"
        />
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {/*
          Hidden and opened by the button beside it, rather than being a
          <label> wrapping one: a label carrying no text of its own is a
          control a screen reader cannot announce. The button says what it
          does, and clicking the input is what it does.
        */}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void choose(file);
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="size-4" aria-hidden />
            {src ? 'Change photo' : 'Add a photo'}
          </Button>
          {src && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={remove}>
              <Trash2 className="size-4" aria-hidden /> Remove
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          PNG, JPEG or WebP. It is squared and shrunk in your browser before it is sent.
        </p>
      </div>
    </div>
  );
}
