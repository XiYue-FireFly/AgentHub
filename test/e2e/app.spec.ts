/**
 * AgentHub E2E tests.
 *
 * These tests verify the core user flows by interacting with the
 * running application. They require the app to be built and served
 * via `npm run preview`.
 *
 * Run: npx playwright test
 */

import { test, expect } from '@playwright/test'

test.describe('AgentHub App', () => {
  test('app loads and shows main shell', async ({ page }) => {
    await page.goto('/')
    // The app should render the main workbench shell
    await expect(page.locator('.wb-root')).toBeVisible({ timeout: 10_000 })
  })

  test('settings page is accessible', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.wb-root', { timeout: 10_000 })
    // Click settings button (Ctrl+4)
    await page.keyboard.press('Control+4')
    // Should see settings content
    await expect(page.locator('.wb-settings-shell')).toBeVisible({ timeout: 5_000 })
  })

  test('composer input is focusable', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.wb-root', { timeout: 10_000 })
    // Focus composer with Ctrl+L
    await page.keyboard.press('Control+l')
    const composer = page.locator('.wb-composer-input')
    await expect(composer).toBeVisible({ timeout: 5_000 })
  })
})
