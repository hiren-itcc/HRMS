'use client';

import { Button } from '@hrms/ui/components/button';
import { Popover, PopoverPopup, PopoverTrigger } from '@hrms/ui/components/popover';
import { Separator } from '@hrms/ui/components/separator';
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
 * **Everything except the photo lives in a popover**, behind a camera badge on
 * its corner. Laid out inline, the two buttons and the format hint were a
 * 400px-wide row wedged between somebody's face and their name on the employee
 * header — permanent screen space for an action almost nobody performs twice.
 * A photo is set once and then looked at.
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
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  /*
   * One size at both call sites. The badge is a fixed 28px, so a smaller avatar
   * would give it half the width of the face it sits on — and a badge that
   * scales with the avatar is a second dimension to keep in step for no gain.
   */
  const avatar = (
    <EmployeeAvatar src={src} fallback={fallback} className="size-16" fallbackClassName="text-lg" />
  );

  if (!canEdit) return avatar;

  const finish = async () => {
    // The old photo's bytes are cached under its old path. The new URL carries
    // a different hash so it misses that entry, but the stale one would sit
    // there for the rest of the session.
    await queryClient.invalidateQueries({ queryKey: ['avatar'] });
    await onDone();
  };

  const choose = async (file: File) => {
    // Closed first: the popover would otherwise sit over the spinner it caused.
    setOpen(false);
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
    setOpen(false);
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
    <div className="relative w-fit shrink-0">
      {avatar}

      {busy && (
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
          <Loader2 className="size-5 animate-spin" aria-hidden />
        </span>
      )}

      {/*
        Hidden and opened by a button rather than wrapped in a <label>: a label
        carrying no text of its own is a control a screen reader cannot
        announce. The button says what it does, and clicking the input is what
        it does.
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

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={busy}
              // Not "Change photo": the popover contains an item by that name,
              // and two controls sharing one accessible name is the sort of
              // thing that only bites somebody using a screen reader.
              aria-label="Photo options"
              className="-bottom-1 -right-1 absolute size-7 rounded-full bg-background p-0 shadow-sm"
            />
          }
        >
          <Camera className="size-3.5" aria-hidden />
        </PopoverTrigger>

        <PopoverPopup align="start" className="w-60 flex-col p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start font-normal"
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="size-4" aria-hidden />
            {src ? 'Change photo' : 'Add a photo'}
          </Button>

          {src && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start font-normal text-destructive hover:text-destructive"
              onClick={remove}
            >
              <Trash2 className="size-4" aria-hidden /> Remove photo
            </Button>
          )}

          <Separator className="my-1" />
          <p className="px-2 pb-1 text-muted-foreground text-xs">
            PNG, JPEG or WebP. It is squared and shrunk in your browser before it is sent.
          </p>
        </PopoverPopup>
      </Popover>
    </div>
  );
}
