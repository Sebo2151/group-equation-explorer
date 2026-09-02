import { defineConfig, devices } from '@playwright/test';

/**
 * A small deployment smoke test, separate from the comprehensive browser suite.
 * It serves the completed static export at the GitHub Pages project path so the
 * test sees the same URLs that a student will see after deployment.
 */
export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'pages.spec.ts',
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'github-pages', use: { ...devices['Desktop Chrome'] } }],
});
