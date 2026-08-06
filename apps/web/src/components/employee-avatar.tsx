'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@hrms/ui/components/avatar';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fetchBlob } from '@/lib/api-client';

/**
 * Somebody's face, or their initials.
 *
 * `avatarUrl` is a path this API serves, not a public URL — the storage bucket
 * is private and stays that way, so the bytes need the access token and an
 * `<img src>` cannot carry one. This fetches them the way document previews
 * already do and hands the browser an object URL instead.
 *
 * **The blob is cached, the object URL is not.** Caching bytes under the
 * photo's own path means a person appearing in the employee list, the
 * directory and the org chart costs one request, not three; creating the
 * object URL per mount and revoking it on unmount means none of them leak.
 * Caching the URL itself would have been shorter and would have leaked one
 * handle per photo for the life of the tab.
 *
 * The path carries a hash of the storage key, so a new photo is a new cache
 * key and nobody sees the old one.
 */
export function EmployeeAvatar({
  src,
  fallback,
  className,
  fallbackClassName,
}: {
  /** `Employee.avatarUrl` — the served path, or null when nobody set a photo. */
  src: string | null | undefined;
  /** Initials. Computed by the caller, which knows whether it holds a person or an account. */
  fallback: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const { data: blob } = useQuery({
    queryKey: ['avatar', src],
    queryFn: () => fetchBlob(src as string),
    // Nothing to fetch, and nothing to wait for: initials render immediately.
    enabled: Boolean(src),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    // A photo removed between one payload and this request is a 404, and the
    // answer is the initials — not three more attempts at it.
    retry: false,
  });

  const [objectUrl, setObjectUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setObjectUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return (
    <Avatar className={cn('size-8 shrink-0', className)}>
      {/* alt is empty on purpose: every one of these sits beside the person's
          name, and "Photo of Asha Verma" next to "Asha Verma" is noise. */}
      {objectUrl && <AvatarImage src={objectUrl} alt="" />}
      <AvatarFallback className={cn('text-xs', fallbackClassName)}>{fallback}</AvatarFallback>
    </Avatar>
  );
}
