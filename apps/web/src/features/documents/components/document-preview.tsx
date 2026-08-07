'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@hrms/ui/components/dialog';
import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileType2,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IconAction } from '@/components/icon-action';
import {
  documentsApi,
  type EmployeeDocument,
  fileKindLabel,
  formatBytes,
  isImage,
  isPdf,
} from '../api';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

interface PreviewProps {
  /** The full list so the viewer can page through documents. */
  documents: EmployeeDocument[];
  index: number | null;
  onIndexChange: (index: number | null) => void;
}

/**
 * Full-screen-ish viewer: PDFs render inline, images support fit/zoom,
 * DOCX falls back to a download prompt. Arrow keys move between files.
 */
export function DocumentPreview({ documents, index, onIndexChange }: PreviewProps) {
  const reduce = useReducedMotion();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const doc = index === null ? null : documents[index];

  // Fetch (authenticated) blob whenever the visible document changes
  useEffect(() => {
    if (!doc) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);
    setZoomed(false);
    documentsApi
      .fileBlob(doc.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && toast.error('Could not load the preview'))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc]);

  const step = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = index + delta;
      if (next >= 0 && next < documents.length) onIndexChange(next);
    },
    [index, documents.length, onIndexChange],
  );

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, step]);

  const download = async () => {
    if (!doc) return;
    try {
      const blob = await documentsApi.fileBlob(doc.id);
      const href = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href, download: doc.name }).click();
      URL.revokeObjectURL(href);
    } catch {
      toast.error('Could not download the file');
    }
  };

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onIndexChange(null)}>
      <DialogContent className="max-h-[94dvh] gap-3 sm:max-w-4xl">
        <DialogHeader className="pr-10">
          <DialogTitle className="truncate text-base">{doc?.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {doc && (
              <>
                <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                  {fileKindLabel(doc.mimeType)}
                </span>
                <span>{formatBytes(doc.sizeBytes)}</span>
                <span>· {dateFmt.format(new Date(doc.createdAt))}</span>
                {doc.category && <span>· {doc.category.name}</span>}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-3">
          <div className="relative flex min-h-[50dvh] items-center justify-center overflow-auto rounded-xl border bg-muted/30">
            {loading && (
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
            )}

            {!loading && doc && url && isImage(doc.mimeType) && (
              // biome-ignore lint/performance/noImgElement: blob: object URLs cannot go through next/image
              <motion.img
                key={doc.id}
                src={url}
                alt={doc.name}
                initial={reduce ? false : { opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                onClick={() => setZoomed((z) => !z)}
                className={cn(
                  'rounded-lg',
                  zoomed
                    ? 'max-w-none cursor-zoom-out'
                    : 'max-h-[70dvh] w-auto max-w-full cursor-zoom-in object-contain',
                )}
              />
            )}

            {!loading && doc && url && isPdf(doc.mimeType) && (
              <iframe src={url} title={doc.name} className="h-[70dvh] w-full rounded-lg" />
            )}

            {!loading && doc && !isImage(doc.mimeType) && !isPdf(doc.mimeType) && (
              <div className="flex flex-col items-center gap-3 p-10 text-center">
                <span className="gradient-primary flex size-14 items-center justify-center rounded-2xl text-white">
                  <FileType2 className="size-7" aria-hidden />
                </span>
                <p className="font-medium text-sm">
                  {fileKindLabel(doc.mimeType)} files can't be previewed in the browser
                </p>
                <Button onClick={download}>
                  <Download className="size-4" aria-hidden /> Download to view
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <IconAction
                label="Previous document"
                icon={ChevronLeft}
                variant="outline"
                size="icon"
                onClick={() => step(-1)}
                disabled={index === null || index === 0}
              />
              <span className="px-1 text-muted-foreground text-sm tabular-nums">
                {index !== null ? index + 1 : 0} / {documents.length}
              </span>
              <IconAction
                label="Next document"
                icon={ChevronRight}
                variant="outline"
                size="icon"
                onClick={() => step(1)}
                disabled={index === null || index >= documents.length - 1}
              />
            </div>
            <div className="flex gap-2">
              {doc && isImage(doc.mimeType) && (
                <Button variant="outline" onClick={() => setZoomed((z) => !z)}>
                  {zoomed ? (
                    <>
                      <Minimize2 className="size-4" aria-hidden /> Fit
                    </>
                  ) : (
                    <>
                      <Maximize2 className="size-4" aria-hidden /> Actual size
                    </>
                  )}
                </Button>
              )}
              <Button onClick={download}>
                <Download className="size-4" aria-hidden /> Download
              </Button>
            </div>
          </div>
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
