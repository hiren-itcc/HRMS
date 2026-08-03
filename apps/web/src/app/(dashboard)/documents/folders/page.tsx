'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { documentCategoryCreateSchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { Field } from '@/components/field';
import { FadeInItem, Stagger } from '@/components/motion';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { documentsApi } from '@/features/documents/api';
import { ApiError } from '@/lib/api-client';

type FolderValues = z.input<typeof documentCategoryCreateSchema>;

/** Folder administration — the org-wide taxonomy every employee files into. */
export default function DocumentFoldersPage() {
  const { can, status } = useSession();
  const queryClient = useQueryClient();
  const [folderOpen, setFolderOpen] = useState(false);
  const canManage = can('document.manage');

  const folders = useQuery({
    queryKey: ['documents', 'folders', 'org'],
    queryFn: () => documentsApi.folders(),
    enabled: canManage,
  });

  const form = useForm<FolderValues>({ resolver: zodResolver(documentCategoryCreateSchema) });

  const createFolder = useMutation({
    mutationFn: documentsApi.createFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Folder created');
      setFolderOpen(false);
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not create the folder'),
  });

  const removeFolder = useMutation({
    mutationFn: documentsApi.removeFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      toast.success('Folder deleted');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the folder'),
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  aria-label={`Delete folder ${f.name}`}
                  disabled={removeFolder.isPending}
                  onClick={() => removeFolder.mutate(f.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
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
        <Field label="Folder name" error={form.formState.errors.name?.message}>
          {(a11y) => (
            <Input {...a11y} autoFocus placeholder="Certificates" {...form.register('name')} />
          )}
        </Field>
      </FormDialog>
    </Stagger>
  );
}
