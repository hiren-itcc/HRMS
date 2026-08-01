import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI state only (docs/09-nextjs-architecture.md §state-model).
 * Server data belongs to TanStack Query; session identity to SessionProvider.
 */
interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

/** Persisted: a collapse preference that resets on every reload is not a preference. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
    }),
    { name: 'hrms-ui' },
  ),
);
