'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/error-state';

/**
 * Catches a render error anywhere below the root layout.
 *
 * Without this, a component that throws takes the page down to a blank screen
 * with no way back — which is exactly what three Base UI context errors did
 * during the coss migration. `reset` re-renders the segment, which is enough
 * for a transient failure; a reload is the fallback for anything else.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what correlates this with the server log; the message is
    // redacted in production builds.
    console.error('Unhandled error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <div className="mx-auto max-w-lg py-16">
      <ErrorState
        title="Something went wrong on this page"
        hint="The rest of the app is still fine. Try again, and if it keeps happening tell your administrator."
        onRetry={reset}
      />
    </div>
  );
}
