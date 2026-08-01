'use client';

/**
 * The last resort: an error thrown by the root layout itself, before any of
 * the app's own providers or styles exist.
 *
 * Next.js replaces the whole document here, so this file must render its own
 * <html> and <body> and cannot use ErrorState, the theme tokens or anything
 * else from the component library — none of it has mounted. Hence the inline
 * styles, which are deliberate rather than lazy.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100dvh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '1rem',
        }}
      >
        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>The app failed to start</h1>
          <p style={{ color: '#555', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Something went wrong before the page could load. Reloading usually fixes it.
          </p>
          {error.digest && (
            <p style={{ color: '#888', fontSize: '0.75rem', marginBottom: '1.5rem' }}>
              Reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: 'pointer',
              border: '1px solid #ccc',
              borderRadius: '0.5rem',
              padding: '0.5rem 1rem',
              background: '#fff',
              font: 'inherit',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
