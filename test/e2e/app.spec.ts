/**
 * AgentHub Electron E2E smoke tests.
 *
 * Run `npm run build` before `npm run test:e2e`.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const mainEntry = join(process.cwd(), 'out', 'main', 'index.js')

async function removeUserDataDir(userDataDir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(userDataDir, { recursive: true, force: true })
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

async function closeAgentHub(app: ElectronApplication | null): Promise<void> {
  if (!app) return
  const childProcess = app.process()
  if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null) return
  if (process.platform === 'win32' && childProcess.pid) {
    execFile('taskkill', ['/pid', String(childProcess.pid), '/t', '/f'], () => {})
    return
  }
  childProcess.kill('SIGKILL')
}

async function launchAgentHub(): Promise<{ app: ElectronApplication; page: Page; userDataDir: string }> {
  if (!existsSync(mainEntry)) {
    throw new Error('Missing built Electron main entry. Run `npm run build` before `npm run test:e2e`.')
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'agenthub-e2e-'))
  let app: ElectronApplication | null = null
  try {
    app = await electron.launch({
      args: [`--user-data-dir=${userDataDir}`, mainEntry],
      env: {
        ...process.env,
        AGENTHUB_E2E: '1',
        AGENTHUB_USER_DATA_DIR: userDataDir,
        NODE_ENV: 'test'
      }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return { app, page, userDataDir }
  } catch (error) {
    await closeAgentHub(app)
    await removeUserDataDir(userDataDir)
    throw error
  }
}

async function dismissAnnouncement(page: Page): Promise<void> {
  const announcement = page.locator('.wb-announcement-backdrop')
  if (!(await announcement.isVisible().catch(() => false))) return
  await page.evaluate(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.wb-announcement-backdrop button')
    buttons[buttons.length - 1]?.click()
  })
  await expect(announcement).toBeHidden({ timeout: 5_000 })
}

test.describe('AgentHub App', () => {
  test('core Electron smoke flows', async () => {
    test.setTimeout(180_000)
    const { app, page, userDataDir } = await launchAgentHub()

    try {
      await test.step('app loads and shows main shell', async () => {
        await expect(page.locator('.wb-root')).toBeVisible({ timeout: 20_000 })
      })

      await test.step('settings page is accessible', async () => {
        await dismissAnnouncement(page)
        await page.keyboard.press('Control+5')
        await expect(page.locator('.wb-settings-shell')).toBeVisible({ timeout: 10_000 })
      })

      await test.step('settings providers render builtin cards with clean user data', async () => {
        await page.evaluate(() => {
          document.querySelectorAll<HTMLButtonElement>('.wb-settings-nav button')[1]?.click()
        })
        await page.waitForFunction(() => {
          const cards = Array.from(document.querySelectorAll('.wb-provider-card'))
          return cards.length > 5 &&
            cards.some(card => card.textContent?.includes('OpenAI')) &&
            cards.some(card => card.textContent?.includes('Anthropic'))
        }, undefined, { timeout: 90_000 })
      })

      await test.step('composer input is focusable', async () => {
        await page.evaluate(() => {
          document.querySelector<HTMLButtonElement>('.wb-settings-back-btn')?.click()
        })
        await expect(page.locator('.wb-settings-shell')).toBeHidden({ timeout: 10_000 })
        await page.keyboard.press('Control+l')
        const composer = page.locator('.wb-composer-input')
        await expect(composer).toBeVisible({ timeout: 10_000 })
      })
    } finally {
      await closeAgentHub(app)
      await removeUserDataDir(userDataDir)
    }
  })
})
