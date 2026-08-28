import { defineConfig, devices } from '@playwright/test';

/**
 * These tests assert behavioural invariants, not appearance: focus destinations,
 * the geometric relationship between the sticky dock and the active line, one
 * control per candidate, and the absence of TeX in accessible names. They are
 * meant to survive the Phase 2 term model and any redesign of the bracket
 * treatment, so they avoid pixel values, DOM structure and screenshots.
 */
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // A real 390px CSS viewport. The audit found that an earlier browser
    // override had silently reported 325px, so the width is asserted in-test.
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // Reusing a running dev server is convenient, but it will happily serve
    // stale CSS after a custom-property change, which reads as a layout bug in
    // these tests. If a geometry assertion fails inexplicably, restart the
    // server before believing it.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
  },
});
