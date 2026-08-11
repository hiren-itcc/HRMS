import { defineConfig, devices } from '@playwright/test';

const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

/**
 * The five golden flows (docs/11-roadmap.md §19), against a real API and a real
 * seeded Postgres.
 *
 * Two settings below are load-bearing rather than taste.
 *
 * **`timezoneId`.** The seeded organization runs in `Asia/Kolkata` and
 * attendance is keyed by date, computed with `dateKeyOf`. A runner in UTC
 * crossing IST midnight makes a check-in appear on yesterday — which surfaces
 * as one spec failing sometimes, and reads exactly like flake.
 *
 * **`workers: 1`.** Refresh tokens rotate with reuse detection, and two workers
 * replaying one session is precisely the pattern that revokes it. Auth is
 * minted per worker rather than shared through `storageState` for the same
 * reason. Raise this only after watching the suite be boring for a while.
 */
export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './global-setup.ts',

  use: {
    baseURL: WEB,
    timezoneId: 'Asia/Kolkata',
    locale: 'en-IN',

    /*
     * Clocking in asks the browser for a position, and headless Chromium
     * denies by default. `getPosition` resolves `refused`, and `clock-card.tsx`
     * deliberately *throws* on refused rather than punching — distinct from
     * `unavailable`, which punches with `locationUnavailable: true`. So the
     * button was clicked, nothing happened, and the request log showed zero
     * calls to `attendance/check-in`.
     *
     * Granting the permission makes the browser behave like somebody who
     * allowed location, which is what the flow assumes. The app is not changed:
     * refusing to punch on a denied fix is correct, and geofenced work-mode
     * detection depends on it.
     */
    permissions: ['geolocation'],
    geolocation: { latitude: 12.9716, longitude: 77.5946 },
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  /*
   * Chromium only, to start. Firefox and WebKit triple the flake surface for a
   * product making no cross-browser claim; add one when a rendering bug is
   * actually found rather than in advance.
   */
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /*
   * Built output, never `dev`. `next dev`'s first-compile latency is the
   * classic cause of a first-spec timeout, and CI has already run the build.
   *
   * `/health/ready` returns 503 until Postgres is reachable, so it is a real
   * readiness gate and not just "the port is open" — which means no `wait-on`.
   */
  webServer: [
    {
      command: 'pnpm --filter @hrms/api start:prod',
      url: `${API}/api/v1/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @hrms/web start',
      url: `${WEB}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
