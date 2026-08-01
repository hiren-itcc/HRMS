'use client';

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
import { Loader2 } from 'lucide-react';

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
  submitLabel: string;
  children: React.ReactNode;
}

/** Dialog + form chrome shared by every org CRUD screen. */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitting,
  submitLabel,
  children,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {/*
         * Per the coss dialog contract: the header stays outside the form, and
         * the form is `contents` so the popup's flex column still sees header,
         * panel and footer as its own direct sections. DialogPanel is what
         * carries the body padding and the scroll area — Radix's DialogContent
         * padded everything itself, so without it the fields sat flush against
         * the dialog edge.
         */}
        <form onSubmit={onSubmit} className="contents" noValidate>
          <DialogPanel className="space-y-4">{children}</DialogPanel>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
