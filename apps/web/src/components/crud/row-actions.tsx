'use client';

import type { Permission } from '@hrms/shared';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@hrms/ui/components/tooltip';
import { Pencil, Trash2 } from 'lucide-react';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';

interface RowActionsProps {
  name: string;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
  /** Permissions gating each action (default: org.manage for both) */
  editPerm?: Permission;
  deletePerm?: Permission;
}

/** Edit + delete-with-confirmation, gated by the caller's permissions. */
export function RowActions({
  name,
  onEdit,
  onDelete,
  deleting,
  editPerm = 'org.manage',
  deletePerm = editPerm,
}: RowActionsProps) {
  const { can } = useSession();
  const canEdit = can(editPerm);
  const canDelete = can(deletePerm);
  if (!canEdit && !canDelete) return null;

  return (
    <>
      {canEdit && <IconAction label={`Edit ${name}`} icon={Pencil} onClick={onEdit} />}
      {canDelete && (
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger
              render={
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      aria-label={`Delete ${name}`}
                    />
                  }
                />
              }
            >
              <Trash2 className="size-4" aria-hidden />
            </TooltipTrigger>
            <TooltipContent>Delete {name}</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
              <AlertDialogDescription>
                This cannot be undone. Records referencing it will be detached or block the delete.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={deleting} onClick={onDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
