import { defineConfig } from '@playwright/test'

/**
 * Playwright E2E test configuration for AgentHub.
 *
 * Tests use Electron's built-in Chromium, not a separate browser.
 * The `playwright-electron` integration launches the app binary.
 */
export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  retries: 0,
  workers: 1, // Electron tests must run serially
  reporter: [['list']],
  use: {
    trace: 'off',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'electron',
      use: {
        // Launch via electron-vite preview (serves built app)
        baseURL: 'http://localhost:4173'
      }
    }
  ],
  webServer: {
    command: 'npm run preview',
    port: 4173,
    timeout: 30_000,
    reuseExistingServer: true
  }
})
