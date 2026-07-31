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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@hrms/ui/components/dialog';
import { cn } from '@hrms/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Eye,
  FileText,
  FileType2,
  Image as ImageIcon,
  Loader2,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/components/session-provider';
import { ApiError } from '@/lib/api-client';
import {
  ACCEPTED_TYPES,
  documentsApi,
  type EmployeeDocument,
  formatBytes,
  isPreviewable,
} from './api';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function DocIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('image/'))
    return <ImageIcon className="size-4.5 text-info" aria-hidden />;
  if (mimeType === 'application/pdf')
    return <FileText className="size-4.5 text-destructive" aria-hidden />;
  return <FileType2 className="size-4.5 text-primary" aria-hidden />;
}

interface DocumentsCardProps {
  employeeId: string;
}

/** Upload / preview / download / delete for one employee's documents. */
export function DocumentsCard({ employeeId }: DocumentsCardProps) {
  const { user, can } = useSession();
  const queryClient = useQueryClient();
  const isSelf = user?.employee?.id === employeeId;
  const canUpload = can('document.upload') || (isSelf && can('document.upload.own'));

  const docs = useQuery({
    queryKey: ['documents', employeeId],
    queryFn: () => documentsApi.list(employeeId),
    retry: false,
  });

  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const [preview, setPreview] = useState<{ doc: EmployeeDocument; url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs must be released when the preview closes
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        setUploading({ name: file.name, percent: 0 });
        try {
          await documentsApi.upload(employeeId, file, (percent) =>
            setUploading({ name: file.name, percent }),
          );
          toast.success(`${file.name} uploaded`);
        } catch (err) {
          toast.error(err instanceof ApiError ? err.message : `Could not upload ${file.name}`);
        }
      }
      setUploading(null);
      queryClient.invalidateQueries({ queryKey: ['documents', employeeId] });
    },
    [employeeId, queryClient],
  );

  const remove = useMutation({
    mutationFn: (id: string) => documentsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', employeeId] });
      toast.success('Document deleted');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not delete the document'),
  });

  const openPreview = async (doc: EmployeeDocument) => {
    try {
      const blob = await documentsApi.fileBlob(doc.id);
      setPreview({ doc, url: URL.createObjectURL(blob) });
    } catch {
      toast.error('Could not load the preview');
    }
  };

  const download = async (doc: EmployeeDocument) => {
    try {
      const blob = await documentsApi.fileBlob(doc.id);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: doc.name });
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not download the file');
    }
  };

  // Viewer has no access to this employee's documents — show nothing
  if (docs.isError && docs.error instanceof ApiError && docs.error.status === 403) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Documents</CardTitle>
        <CardDescription>PDF, DOCX and images · contracts, IDs, certificates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canUpload && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
            }}
            disabled={uploading !== null}
            className={cn(
              'flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-150',
              dragOver
                ? 'border-primary bg-accent'
                : 'border-border hover:border-primary/50 hover:bg-accent/40',
              uploading && 'cursor-wait opacity-70',
            )}
            aria-label="Upload documents"
          >
            <span className="gradient-primary flex size-10 items-center justify-center rounded-xl text-white">
              {uploading ? (
                <Loader2 className="size-5 animate-spin" aria-hidden />
              ) : (
                <UploadCloud className="size-5" aria-hidden />
              )}
            </span>
            {uploading ? (
              <span className="w-full max-w-xs space-y-1.5">
                <span className="block truncate font-medium text-sm">
                  Uploading {uploading.name}… {uploading.percent}%
                </span>
                <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="gradient-primary block h-full rounded-full transition-[width] duration-200"
                    style={{ width: `${uploading.percent}%` }}
                  />
                </span>
              </span>
            ) : (
              <>
                <span className="font-medium text-sm">
                  Drag &amp; drop files here, or click to browse
                </span>
                <span className="text-muted-foreground text-xs">
                  PDF, DOCX, PNG, JPEG, WebP — up to 10 MB
                </span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </button>
        )}

        {docs.isLoading && (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-13 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}

        {!docs.isLoading && docs.data?.length === 0 && !canUpload && (
          <p className="py-4 text-center text-muted-foreground text-sm">No documents on file.</p>
        )}

        <ul className="space-y-2">
          {docs.data?.map((doc) => {
            const canDelete = can('document.manage') || (isSelf && doc.uploadedById === user?.id);
            return (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-accent/40"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <DocIcon mimeType={doc.mimeType} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{doc.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {formatBytes(doc.sizeBytes)} · {dateFmt.format(new Date(doc.createdAt))}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  {isPreviewable(doc.mimeType) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openPreview(doc)}
                      aria-label={`Preview ${doc.name}`}
                    >
                      <Eye className="size-4" aria-hidden />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => download(doc)}
                    aria-label={`Download ${doc.name}`}
                  >
                    <Download className="size-4" aria-hidden />
                  </Button>
                  {canDelete && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Delete ${doc.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete “{doc.name}”?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The document will no longer be visible. This cannot be undone from the
                            app.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground [background-image:none] hover:bg-destructive/90"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(doc.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent className="max-h-[92dvh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{preview?.doc.name}</DialogTitle>
          </DialogHeader>
          {preview &&
            (preview.doc.mimeType.startsWith('image/') ? (
              // biome-ignore lint/performance/noImgElement: blob object URLs can't go through next/image
              <img
                src={preview.url}
                alt={preview.doc.name}
                className="max-h-[75dvh] w-full rounded-lg object-contain"
              />
            ) : (
              <iframe
                src={preview.url}
                title={preview.doc.name}
                className="h-[75dvh] w-full rounded-lg border"
              />
            ))}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
