'use client';

import { documentCategoryCreateSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { FormInput } from '@/components/form';
import { IconAction } from '@/components/icon-action';
import { FadeInItem, Stagger } from '@/components/motion';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { documentsApi } from '@/features/documents/api';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

type FolderValues = z.input<typeof documentCategoryCreateSchema>;

/** Folder administration — the org-wide taxonomy every employee files into. */
export default function DocumentFoldersPage() {
  const { can, status } = useSession();
  const _queryClient = useQueryClient();
  const [folderOpen, setFolderOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const canManage = can('document.manage');

  const folders = useQuery({
    queryKey: ['documents', 'folders', 'org'],
    queryFn: () => documentsApi.folders(),
    enabled: canManage,
  });

  const form = useZodForm<FolderValues>(documentCategoryCreateSchema);
  const renameForm = useZodForm<FolderValues>(documentCategoryCreateSchema);

  const createFolder = useApiMutation({
    mutationFn: documentsApi.createFolder,
    invalidate: [['documents']],
    success: 'Folder created',
    error: 'Could not create the folder',
    onSuccess: () => {
      setFolderOpen(false);
    },
  });

  const removeFolder = useApiMutation({
    mutationFn: documentsApi.removeFolder,
    invalidate: [['documents']],
    success: 'Folder deleted',
    error: 'Could not delete the folder',
  });

  /*
   * Renaming was the one folder operation with an endpoint and no button. It
   * matters more than it looks: a folder cannot be deleted while documents are
   * in it, so a badly-named folder that people have already filed into could
   * only be fixed by emptying it first.
   *
   * Documents point at the folder by id, so a rename moves nothing.
   */
  const renameFolder = useApiMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      documentsApi.renameFolder(id, { name }),
    invalidate: [['documents']],
    success: 'Folder renamed',
    error: 'Could not rename the folder',
    onSuccess: () => {
      setRenaming(null);
    },
  });

  if (status === 'authenticated' && !canManage) return <NoAccess what="document folders" />;

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>Folders</h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              Shared across every employee — a folder must be empty to delete
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              form.reset({ name: '' });
              setFolderOpen(true);
            }}
          >
            <FolderPlus className="size-4" aria-hidden /> New folder
          </Button>
        </div>
      </FadeInItem>

      <FadeInItem>
        <Card>
          <CardHeader>
            <CardTitle>Document folders</CardTitle>
            <CardDescription>Counts are across the whole organization</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {folders.data?.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-xl border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{f.name}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {f.documentCount} document{f.documentCount === 1 ? '' : 's'} across the org
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconAction
                    label={`Rename folder ${f.name}`}
                    icon={Pencil}
                    size="icon"
                    onClick={() => {
                      renameForm.reset({ name: f.name });
                      setRenaming(f);
                    }}
                  />
                  <IconAction
                    label={`Delete folder ${f.name}`}
                    icon={Trash2}
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => removeFolder.mutate(f.id)}
                    disabled={removeFolder.isPending}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </FadeInItem>

      <FormDialog
        open={folderOpen}
        onOpenChange={setFolderOpen}
        title="New folder"
        description="Folders are shared by every employee, e.g. Resume or PAN."
        onSubmit={form.handleSubmit((v) => createFolder.mutate(v))}
        submitting={createFolder.isPending}
        submitLabel="Create folder"
      >
        <FormInput
          control={form.control}
          name="name"
          label="Folder name"
          autoFocus
          placeholder="Certificates"
        />
      </FormDialog>

      <FormDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename folder"
        description="Documents point at the folder by id, so nothing moves and nothing is refiled."
        onSubmit={renameForm.handleSubmit((v) =>
          renaming ? renameFolder.mutate({ id: renaming.id, name: v.name }) : undefined,
        )}
        submitting={renameFolder.isPending}
        submitLabel="Save name"
      >
        <FormInput
          control={renameForm.control}
          name="name"
          label="Folder name"
          autoFocus
          placeholder="Certificates"
        />
      </FormDialog>
    </Stagger>
  );
}
