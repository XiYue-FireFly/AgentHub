/**
 * AgentHub E2E tests.
 *
 * These tests verify the core user flows by interacting with the
 * running application. They require the app to be built and served
 * via `npm run preview`.
 *
 * Run: npx playwright test
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const mainEntry = join(process.cwd(), 'out', 'main', 'index.js')

async function launchAgentHub(): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  if (!existsSync(mainEntry)) {
    throw new Error('Missing built Electron main entry. Run `npm run build` before `npx playwright test`.')
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'agenthub-e2e-'))
  let app: ElectronApplication | null = null
  try {
    app = await electron.launch({
      args: [`--user-data-dir=${userDataDir}`, mainEntry],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AGENTHUB_USER_DATA_DIR: userDataDir
      }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return { app, page, userDataDir }
  } catch (error) {
    await app?.close().catch(() => {})
    rmSync(userDataDir, { recursive: true, force: true })
    throw error
  }
}

test.describe('AgentHub App', () => {
  let app: ElectronApplication | null = null
  let page: Page | null = null
  let userDataDir: string | null = null

  test.beforeEach(async () => {
    const launched = await launchAgentHub()
    app = launched.app
    page = launched.page
    userDataDir = launched.userDataDir
  })

  test.afterEach(async () => {
    await app?.close()
    if (userDataDir) {
      rmSync(userDataDir, { recursive: true, force: true })
    }
    app = null
    page = null
    userDataDir = null
  })

  test('app loads and shows main shell', async () => {
    expect(page).not.toBeNull()
    const mainPage = page
    if (!mainPage) throw new Error('Electron page was not initialized')
    // The app should render the main workbench shell
    await expect(mainPage.locator('.wb-root')).toBeVisible({ timeout: 10_000 })
  })

  test('settings page is accessible', async () => {
    expect(page).not.toBeNull()
    const mainPage = page
    if (!mainPage) throw new Error('Electron page was not initialized')
    await mainPage.waitForSelector('.wb-root', { timeout: 10_000 })
    // Click settings button (Ctrl+4)
    await mainPage.keyboard.press('Control+4')
    // Should see settings content
    await expect(mainPage.locator('.wb-settings-shell')).toBeVisible({ timeout: 5_000 })
  })

  test('settings providers render builtin cards with clean user data', async () => {
    expect(page).not.toBeNull()
    const mainPage = page
    if (!mainPage) throw new Error('Electron page was not initialized')
    await mainPage.waitForSelector('.wb-root', { timeout: 10_000 })
    await mainPage.keyboard.press('Control+4')
    await expect(mainPage.locator('.wb-settings-shell')).toBeVisible({ timeout: 5_000 })
    const announcement = mainPage.locator('.wb-announcement-backdrop')
    if (await announcement.isVisible().catch(() => false)) {
      await mainPage.getByRole('button', { name: /我知道了|Got it/ }).click()
      await expect(announcement).toBeHidden({ timeout: 5_000 })
    }

    await mainPage.locator('.wb-settings-nav button').nth(1).click()
    await expect(mainPage.locator('.wb-provider-card').filter({ hasText: 'OpenAI' }).first()).toBeVisible({ timeout: 5_000 })
    await expect(mainPage.locator('.wb-provider-card').filter({ hasText: 'Anthropic' }).first()).toBeVisible({ timeout: 5_000 })
    expect(await mainPage.locator('.wb-provider-card').count()).toBeGreaterThan(5)
  })

  test('composer input is focusable', async () => {
    expect(page).not.toBeNull()
    const mainPage = page
    if (!mainPage) throw new Error('Electron page was not initialized')
    await mainPage.waitForSelector('.wb-root', { timeout: 10_000 })
    // Focus composer with Ctrl+L
    await mainPage.keyboard.press('Control+l')
    const composer = mainPage.locator('.wb-composer-input')
    await expect(composer).toBeVisible({ timeout: 5_000 })
    await expect(composer).toBeFocused()
    await composer.fill('E2E composer smoke')
    await expect(composer).toHaveValue('E2E composer smoke')
  })
})
