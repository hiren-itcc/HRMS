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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hrms/ui/components/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@hrms/ui/components/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@hrms/ui/components/tooltip';
import { cn } from '@hrms/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Download,
  Eye,
  FileText,
  FileType2,
  FolderInput,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Search,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { errorMessage } from '@/hooks/use-crud';
import { ApiError } from '@/lib/api-client';
import {
  ACCEPTED_TYPES,
  documentsApi,
  type EmployeeDocument,
  fileKindLabel,
  formatBytes,
  isImage,
  isPdf,
} from './api';
import { DocumentPreview } from './components/document-preview';

const ALL = 'all';
const NO_FOLDER = 'none';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function DocIcon({ mimeType }: { mimeType: string }) {
  if (isImage(mimeType)) return <ImageIcon className="size-5 text-info" aria-hidden />;
  if (isPdf(mimeType)) return <FileText className="size-5 text-destructive" aria-hidden />;
  return <FileType2 className="size-5 text-primary" aria-hidden />;
}

interface BrowserProps {
  employeeId: string;
  /** Compact mode drops the folder rail (used inside the employee detail page). */
  compact?: boolean;
}

/**
 * Folder-based document browser — used both on /documents (own files) and
 * inside an employee's record, so the two can never drift apart.
 */
export function DocumentsBrowser({ employeeId, compact = false }: BrowserProps) {
  const { user, can } = useSession();
  const queryClient = useQueryClient();
  const reduce = useReducedMotion();

  const isSelf = user?.employee?.id === employeeId;
  const canUpload = can('document.upload') || (isSelf && can('document.upload.own'));
  const canManage = can('document.manage');

  const [folderId, setFolderId] = useState<string>(ALL);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [uploadFolder, setUploadFolder] = useState<string>(NO_FOLDER);
  const [uploading, setUploading] = useState<{ name: string; percent: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce typing into the query (300ms, per the UX rules)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const folders = useQuery({
    queryKey: ['documents', 'folders', employeeId],
    queryFn: () => documentsApi.folders(employeeId),
    retry: false,
  });

  const docs = useQuery({
    queryKey: ['documents', employeeId, folderId, search],
    queryFn: () =>
      documentsApi.list(employeeId, {
        categoryId: folderId === ALL ? undefined : folderId,
        search: search || undefined,
      }),
    retry: false,
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
    [queryClient],
  );

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const target = uploadFolder === NO_FOLDER ? undefined : uploadFolder;
      for (const file of Array.from(files)) {
        setUploading({ name: file.name, percent: 0 });
        try {
          await documentsApi.upload(employeeId, file, target, (percent) =>
            setUploading({ name: file.name, percent }),
          );
          toast.success(`${file.name} uploaded`);
        } catch (err) {
          toast.error(errorMessage(err, `Could not upload ${file.name}`));
        }
      }
      setUploading(null);
      invalidate();
    },
    [employeeId, uploadFolder, invalidate],
  );

  const remove = useMutation({
    mutationFn: documentsApi.remove,
    onSuccess: () => {
      invalidate();
      toast.success('Document deleted');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not delete')),
  });

  const move = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      documentsApi.move(id, categoryId),
    onSuccess: () => {
      invalidate();
      toast.success('Document moved');
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not move')),
  });

  const download = async (doc: EmployeeDocument) => {
    try {
      const blob = await documentsApi.fileBlob(doc.id);
      const href = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href, download: doc.name }).click();
      URL.revokeObjectURL(href);
    } catch {
      toast.error('Could not download the file');
    }
  };

  // No access to this employee's documents at all
  if (docs.isError && docs.error instanceof ApiError && docs.error.status === 403) return null;

  const rows = docs.data ?? [];
  const totalDocs = folders.data?.reduce((sum, f) => sum + f.documentCount, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* Folder rail */}
      {!compact && (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <div className="flex w-max gap-2">
            <FolderChip
              label="All documents"
              count={totalDocs}
              active={folderId === ALL}
              onClick={() => setFolderId(ALL)}
            />
            {folders.data?.map((f) => (
              <FolderChip
                key={f.id}
                label={f.name}
                count={f.documentCount}
                active={folderId === f.id}
                onClick={() => setFolderId(f.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* InputGroup, not an icon absolutely positioned over a padded
            input: the input's own bg-background painted over the icon in
            light mode, which is why it only showed in dark. */}
        <InputGroup className="w-full max-w-xs">
          <InputGroupAddon>
            <Search className="size-4" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search documents…"
            aria-label="Search documents"
          />
          {searchInput && (
            <InputGroupAddon align="inline-end">
              <IconAction
                label="Clear search"
                icon={X}
                size="icon-sm"
                onClick={() => setSearchInput('')}
              />
            </InputGroupAddon>
          )}
        </InputGroup>
        {compact && folders.data && folders.data.length > 0 && (
          <Select value={folderId} onValueChange={setFolderId}>
            <SelectTrigger className="w-44" aria-label="Filter by folder">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All folders</SelectItem>
              {folders.data.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {canUpload && (
        <div className="space-y-2">
          {folders.data && folders.data.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-sm">Upload into</span>
              <Select value={uploadFolder} onValueChange={setUploadFolder}>
                <SelectTrigger className="w-48" aria-label="Folder for new uploads">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FOLDER}>No folder</SelectItem>
                  {folders.data.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
              'flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-150',
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
        </div>
      )}

      {docs.isLoading && (
        <div className="grid gap-2 sm:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      )}

      {!docs.isLoading && rows.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-12 text-center">
          <FolderOpen className="size-8 text-muted-foreground/50" aria-hidden />
          <p className="font-medium text-sm">
            {search ? `No documents match “${search}”` : 'This folder is empty'}
          </p>
          <p className="text-muted-foreground text-xs">
            {search
              ? 'Try a different search term.'
              : canUpload
                ? 'Drop a file above to add the first one.'
                : 'Nothing has been filed here yet.'}
          </p>
        </div>
      )}

      <ul className="grid gap-2 sm:grid-cols-2">
        <AnimatePresence initial={false}>
          {rows.map((doc, i) => {
            const canDelete = canManage || (isSelf && doc.uploadedById === user?.id);
            return (
              <motion.li
                key={doc.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.18 }}
                className="hover-lift flex items-center gap-3 rounded-xl border bg-card p-3"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <DocIcon mimeType={doc.mimeType} />
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewIndex(i)}
                  className="min-w-0 flex-1 cursor-pointer text-left"
                >
                  <p className="truncate font-medium text-sm">{doc.name}</p>
                  <p className="truncate text-muted-foreground text-xs">
                    {fileKindLabel(doc.mimeType)} · {formatBytes(doc.sizeBytes)} ·{' '}
                    {dateFmt.format(new Date(doc.createdAt))}
                    {doc.category && ` · ${doc.category.name}`}
                  </p>
                </button>
                <div className="flex shrink-0 gap-0.5">
                  <IconAction
                    label={`Preview ${doc.name}`}
                    icon={Eye}
                    size="icon"
                    onClick={() => setPreviewIndex(i)}
                  />
                  <IconAction
                    label={`Download ${doc.name}`}
                    icon={Download}
                    size="icon"
                    onClick={() => download(doc)}
                  />
                  {canUpload && (folders.data?.length ?? 0) > 0 && (
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Move ${doc.name}`}
                                />
                              }
                            />
                          }
                        >
                          <FolderInput className="size-4" aria-hidden />
                        </TooltipTrigger>
                        <TooltipContent>Move to a folder</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={doc.categoryId === null}
                          onClick={() => move.mutate({ id: doc.id, categoryId: null })}
                        >
                          No folder
                        </DropdownMenuItem>
                        {folders.data?.map((f) => (
                          <DropdownMenuItem
                            key={f.id}
                            disabled={doc.categoryId === f.id}
                            onClick={() => move.mutate({ id: doc.id, categoryId: f.id })}
                          >
                            {f.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
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
                                  aria-label={`Delete ${doc.name}`}
                                />
                              }
                            />
                          }
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </TooltipTrigger>
                        <TooltipContent>Delete {doc.name}</TooltipContent>
                      </Tooltip>
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
                            variant="destructive"
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
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      <DocumentPreview documents={rows} index={previewIndex} onIndexChange={setPreviewIndex} />
    </div>
  );
}

function FolderChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 whitespace-nowrap rounded-xl border px-3.5 py-2 text-sm transition-colors',
        active
          ? 'gradient-primary border-transparent text-white shadow-primary/20 shadow-md'
          : 'hover:border-primary/40 hover:bg-accent',
      )}
    >
      <FolderOpen className="size-4" aria-hidden />
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
          active ? 'bg-white/20' : 'bg-muted text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}
