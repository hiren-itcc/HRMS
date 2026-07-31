'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@hrms/ui/components/alert-dialog';
import { Button } from '@hrms/ui/components/button';
import { Pencil, Trash2 } from 'lucide-react';
import { useSession } from '@/components/session-provider';

interface RowActionsProps {
  name: string;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
}

/** Edit + delete-with-confirmation, only rendered for org.manage holders. */
export function RowActions({ name, onEdit, onDelete, deleting }: RowActionsProps) {
  const { can } = useSession();
  if (!can('org.manage')) return null;

  return (
    <>
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Edit ${name}`}>
        <Pencil className="size-4" aria-hidden />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            aria-label={`Delete ${name}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Records referencing it will be detached or block the delete.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
