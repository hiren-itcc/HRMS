import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

/**
 * A fresh provider tree, for `renderHook`'s `wrapper` option.
 *
 * `retry: false` matters: with the default the error branch of a component
 * never renders inside a test's lifetime, so an error state looks tested and
 * is not.
 */
export function queryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Renders a component with the providers every page assumes. */
export function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: queryWrapper() });
}

export * from '@testing-library/react';
