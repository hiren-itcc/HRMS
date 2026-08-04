import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Renders a component with the providers every page assumes.
 *
 * `retry: false` matters: with the default the error branch of a component
 * never renders inside a test's lifetime, so an error state looks tested and
 * is not.
 */
export function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

export * from '@testing-library/react';
