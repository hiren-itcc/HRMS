'use client';

import { TooltipProvider } from '@hrms/ui/components/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ThemeProvider } from 'next-themes';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { SessionProvider } from '@/components/session-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser session; created lazily so SSR never shares state.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          {/*
            One provider for the whole app rather than one per screen: an icon
            button explains itself wherever it appears, and a page that forgets
            to wrap itself is a button that silently stops explaining. 200ms is
            long enough not to fire on a mouse passing through.
          */}
          <TooltipProvider delay={200}>
            {children}
            <Toaster richColors closeButton position="top-right" />
            {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
          </TooltipProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
