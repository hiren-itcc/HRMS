import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI state only (docs/09-nextjs-architecture.md §state-model).
 * Server data belongs to TanStack Query; session identity to SessionProvider.
 */
/** How much vertical air table rows get. */
export type Density = 'comfortable' | 'compact';

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  density: Density;
  setDensity: (density: Density) => void;
}

/** Persisted: a collapse preference that resets on every reload is not a preference. */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      // Global rather than per-table: someone who wants dense rows wants them
      // everywhere, and re-setting it on each screen would be a chore.
      density: 'comfortable',
      setDensity: (density) => set({ density }),
    }),
    { name: 'hrms-ui' },
  ),
);
