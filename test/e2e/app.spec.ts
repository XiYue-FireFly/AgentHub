/**
 * AgentHub Electron E2E smoke tests.
 *
 * Run `npm run build` before `npm run test:e2e`.
 */

import { execFile } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { basename, dirname, join, resolve } from 'node:path'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { test, expect, _electron as electron } from '@playwright/test'
import type { ConsoleMessage, ElectronApplication, Page } from '@playwright/test'

const mainEntry = join(process.cwd(), 'out', 'main', 'index.js')
const userDataPrefix = 'agenthub-e2e-'
const rendererConsoleErrorAllowlist: readonly RegExp[] = []
const stylesheetFallbackWarning = '[AgentHub] Workbench stylesheet did not apply; installing fallback layout styles.'

interface RendererDiagnostics {
  consoleErrors: string[]
  pageErrors: string[]
  observedPages: Set<Page>
}

interface LaunchedAgentHub {
  app: ElectronApplication
  page: Page
  userDataDir: string
  diagnostics: RendererDiagnostics
  resources: ActiveAgentHubResources
}

interface ActiveAgentHubResources {
  app: ElectronApplication | null
  userDataDir: string
  launchSettled: Promise<void>
  cleanupInFlight: Promise<unknown[]> | null
}

interface NavigationProbe {
  url: string
  isMainFrame: boolean
  defaultPrevented: boolean
}

const activeAgentHubResources = new Set<ActiveAgentHubResources>()

function assertOwnedUserDataDir(userDataDir: string): void {
  const expectedParent = resolve(tmpdir())
  const candidate = resolve(userDataDir)
  const actualParent = dirname(candidate)
  const sameParent = process.platform === 'win32'
    ? actualParent.toLowerCase() === expectedParent.toLowerCase()
    : actualParent === expectedParent
  const name = basename(candidate)

  if (!sameParent || !name.startsWith(userDataPrefix) || name.length <= userDataPrefix.length) {
    throw new Error(`Refusing to remove non-E2E user data directory: ${userDataDir}`)
  }
}

async function removeUserDataDir(userDataDir: string): Promise<void> {
  assertOwnedUserDataDir(userDataDir)
  let lastError: unknown = null

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(userDataDir, { recursive: true, force: true })
      if (!existsSync(userDataDir)) return
    } catch (error) {
      lastError = error
    }

    if (attempt < 4) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 150 * (attempt + 1)))
    }
  }

  const detail = lastError instanceof Error ? `: ${lastError.message}` : ''
  throw new Error(`Failed to remove E2E user data directory ${userDataDir}${detail}`)
}

function waitForProcessExit(childProcess: ChildProcess, timeoutMs = 15_000): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return Promise.resolve()

  return new Promise((resolveExit, rejectExit) => {
    const onExit = () => {
      clearTimeout(timer)
      childProcess.removeListener('error', onError)
      resolveExit()
    }
    const onError = (error: Error) => {
      clearTimeout(timer)
      childProcess.removeListener('exit', onExit)
      rejectExit(error)
    }
    const timer = setTimeout(() => {
      childProcess.removeListener('exit', onExit)
      childProcess.removeListener('error', onError)
      rejectExit(new Error(`Timed out waiting for Electron process ${childProcess.pid ?? 'unknown'} to exit`))
    }, timeoutMs)

    childProcess.once('exit', onExit)
    childProcess.once('error', onError)
  })
}

function requestWindowsProcessTreeTermination(pid: number): Promise<Error | null> {
  return new Promise(resolveTermination => {
    execFile(
      'taskkill',
      ['/pid', String(pid), '/t', '/f'],
      { windowsHide: true },
      error => resolveTermination(error)
    )
  })
}

async function closeAgentHub(app: ElectronApplication | null): Promise<void> {
  if (!app) return
  const childProcess = app.process()
  if (!childProcess || childProcess.exitCode !== null || childProcess.signalCode !== null) return

  const exited = waitForProcessExit(childProcess)
  if (process.platform === 'win32' && childProcess.pid) {
    const taskkillError = await requestWindowsProcessTreeTermination(childProcess.pid)
    try {
      await exited
    } catch (exitError) {
      if (taskkillError) {
        throw new AggregateError([taskkillError, exitError], 'Failed to terminate AgentHub Electron process')
      }
      throw exitError
    }

    // taskkill can lose a benign race with a process that exits on its own. Once the
    // tracked ChildProcess has emitted exit, its lifecycle is closed for this test;
    // only combine taskkill and exit-wait errors when that exit was not observed.
    return
  }

  childProcess.kill('SIGKILL')
  await exited
}

function createRendererDiagnostics(): RendererDiagnostics {
  return {
    consoleErrors: [],
    pageErrors: [],
    observedPages: new Set<Page>()
  }
}

function addUniqueDiagnostic(collection: string[], diagnostic: string): void {
  if (!collection.includes(diagnostic)) collection.push(diagnostic)
}

function consoleMessageText(page: Page, message: ConsoleMessage): string {
  const location = message.location()
  const source = location.url
    ? `${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`
    : page.url()
  return `${message.text()} @ ${source}`
}

function observeRendererPage(page: Page, diagnostics: RendererDiagnostics): void {
  if (diagnostics.observedPages.has(page)) return
  diagnostics.observedPages.add(page)

  page.on('pageerror', error => {
    addUniqueDiagnostic(diagnostics.pageErrors, `${error.stack || error.message} @ ${page.url()}`)
  })
  page.on('console', message => {
    const text = message.text()
    if (message.type() === 'error' || (message.type() === 'warning' && text === stylesheetFallbackWarning)) {
      addUniqueDiagnostic(diagnostics.consoleErrors, consoleMessageText(page, message))
    }
  })
}

function assertCollectedRendererErrors(diagnostics: RendererDiagnostics): void {
  const unexpectedConsoleErrors = diagnostics.consoleErrors.filter(entry => (
    !rendererConsoleErrorAllowlist.some(pattern => pattern.test(entry))
  ))
  expect(diagnostics.pageErrors, 'uncaught renderer page errors').toEqual([])
  expect(unexpectedConsoleErrors, 'unexpected renderer console errors').toEqual([])
}

async function collectAndAssertRendererErrors(diagnostics: RendererDiagnostics): Promise<void> {
  for (const page of diagnostics.observedPages) {
    const [consoleMessages, pageErrors] = await Promise.all([
      page.consoleMessages({ filter: 'all' }),
      page.pageErrors({ filter: 'all' })
    ])
    for (const message of consoleMessages) {
      const text = message.text()
      if (message.type() === 'error' || (message.type() === 'warning' && text === stylesheetFallbackWarning)) {
        addUniqueDiagnostic(diagnostics.consoleErrors, consoleMessageText(page, message))
      }
    }
    for (const error of pageErrors) {
      addUniqueDiagnostic(diagnostics.pageErrors, `${error.stack || error.message} @ ${page.url()}`)
    }
  }

  assertCollectedRendererErrors(diagnostics)
}

async function performAgentHubFinalization(
  resources: ActiveAgentHubResources,
  diagnostics?: RendererDiagnostics
): Promise<unknown[]> {
  const failures: unknown[] = []
  let cleanupSucceeded = true

  if (diagnostics) {
    try {
      await collectAndAssertRendererErrors(diagnostics)
    } catch (error) {
      failures.push(error)
    }
  }

  try {
    await closeAgentHub(resources.app)
  } catch (error) {
    cleanupSucceeded = false
    failures.push(error)
  }

  if (diagnostics) {
    try {
      // Do not query closed pages here. The live listeners remain authoritative for
      // errors emitted between the historical snapshot and the observed process exit.
      await new Promise<void>(resolveEvents => setImmediate(resolveEvents))
      assertCollectedRendererErrors(diagnostics)
    } catch (error) {
      failures.push(error)
    }
  }

  try {
    await removeUserDataDir(resources.userDataDir)
  } catch (error) {
    cleanupSucceeded = false
    failures.push(error)
  }

  try {
    expect(existsSync(resources.userDataDir), `E2E user data residue: ${resources.userDataDir}`).toBe(false)
  } catch (error) {
    cleanupSucceeded = false
    failures.push(error)
  }

  if (cleanupSucceeded) activeAgentHubResources.delete(resources)
  return failures
}

async function finalizeAgentHubResources(
  resources: ActiveAgentHubResources,
  diagnostics?: RendererDiagnostics
): Promise<unknown[]> {
  await resources.launchSettled

  if (resources.cleanupInFlight) {
    await resources.cleanupInFlight
    if (!activeAgentHubResources.has(resources)) return []
  }

  const cleanupAttempt = performAgentHubFinalization(resources, diagnostics)
  resources.cleanupInFlight = cleanupAttempt
  try {
    return await cleanupAttempt
  } finally {
    if (resources.cleanupInFlight === cleanupAttempt) resources.cleanupInFlight = null
  }
}

async function launchAgentHub(): Promise<LaunchedAgentHub> {
  if (!existsSync(mainEntry)) {
    throw new Error('Missing built Electron main entry. Run `npm run build` before `npm run test:e2e`.')
  }

  const userDataDir = mkdtempSync(join(tmpdir(), userDataPrefix))
  const diagnostics = createRendererDiagnostics()
  let markLaunchSettled: () => void = () => {}
  const resources: ActiveAgentHubResources = {
    app: null,
    userDataDir,
    cleanupInFlight: null,
    launchSettled: new Promise(resolveLaunch => {
      markLaunchSettled = resolveLaunch
    })
  }
  activeAgentHubResources.add(resources)

  try {
    const app = await (async () => {
      try {
        const launchedApp = await electron.launch({
          args: [`--user-data-dir=${userDataDir}`, mainEntry],
          env: {
            ...process.env,
            AGENTHUB_E2E: '1',
            AGENTHUB_USER_DATA_DIR: userDataDir,
            NODE_ENV: 'test'
          }
        })
        resources.app = launchedApp
        return launchedApp
      } finally {
        markLaunchSettled()
      }
    })()

    const observePage = (candidate: Page) => observeRendererPage(candidate, diagnostics)
    app.context().on('page', observePage)
    app.context().pages().forEach(observePage)
    const page = await app.firstWindow()
    observePage(page)
    await page.waitForLoadState('domcontentloaded')
    return { app, page, userDataDir, diagnostics, resources }
  } catch (launchError) {
    const cleanupErrors = await finalizeAgentHubResources(resources, diagnostics)
    if (cleanupErrors.length === 0) throw launchError
    throw new AggregateError([launchError, ...cleanupErrors], 'AgentHub E2E launch and cleanup failures')
  }
}

async function withAgentHub(run: (launched: LaunchedAgentHub) => Promise<void>): Promise<void> {
  const launched = await launchAgentHub()
  let bodyFailed = false
  let bodyFailure: unknown
  let finalizationFailures: unknown[] = []

  try {
    await run(launched)
  } catch (error) {
    bodyFailed = true
    bodyFailure = error
  } finally {
    finalizationFailures = await finalizeAgentHubResources(launched.resources, launched.diagnostics)
  }

  const failures = bodyFailed ? [bodyFailure, ...finalizationFailures] : finalizationFailures
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'AgentHub E2E test and finalization failures')
}

function announcementDialog(page: Page) {
  return page.getByRole('dialog', {
    name: /^(开始前请先完成运行配置|Finish run setup before starting)$/
  })
}

async function dismissAnnouncement(page: Page): Promise<void> {
  const dialog = announcementDialog(page)
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await dialog.getByRole('button', { name: /^(我知道了|Got it)$/ }).click()
  await expect(dialog).toBeHidden({ timeout: 5_000 })
}

async function dismissAnnouncementIfPresent(page: Page): Promise<void> {
  const dialog = announcementDialog(page)
  if (!await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) return
  await dialog.getByRole('button').first().click()
  await expect(dialog).toBeHidden({ timeout: 5_000 })
}

function primaryNavigation(page: Page) {
  return page.getByRole('navigation', { name: /^(主要导航|Primary navigation)$/ })
}

test.afterEach(async ({ browserName: _browserName }, testInfo) => {
  // Playwright gives afterEach its own timeout window after a timed-out test body.
  // Keep a bounded, explicit budget for retrying every still-owned resource.
  testInfo.setTimeout(45_000)
  const failures: unknown[] = []

  for (const resources of [...activeAgentHubResources]) {
    failures.push(...await finalizeAgentHubResources(resources))
  }

  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'AgentHub E2E fallback cleanup failures')
})

test.describe('AgentHub App', () => {
  test('navigates settings with real controls and focuses the composer', async () => {
    test.setTimeout(180_000)
    await withAgentHub(async ({ page }) => {
      await expect(page.locator('.wb-root')).toBeVisible({ timeout: 20_000 })
      await dismissAnnouncement(page)

      const navigation = primaryNavigation(page)
      await navigation.getByRole('button', { name: /^(设置|Settings)$/ }).click()
      const settings = page.locator('.wb-settings-shell')
      await expect(settings).toBeVisible({ timeout: 10_000 })

      const settingsNavigation = settings.locator('.wb-settings-nav')
      await settingsNavigation.getByRole('button', { name: /^(供应商|Providers)$/ }).click()
      const providerCards = settings.locator('.wb-provider-card')
      await expect(providerCards.filter({ hasText: 'OpenAI' }).first()).toBeVisible({ timeout: 90_000 })
      await expect(providerCards.filter({ hasText: 'Anthropic' }).first()).toBeVisible({ timeout: 90_000 })

      await settings.getByRole('button', { name: /^(返回对话|Back to chat)$/ }).click()
      await expect(settings).toBeHidden({ timeout: 10_000 })

      const composer = page.getByPlaceholder(/^(输入后发送，系统会自动新建会话\.\.\.|Send to start a new session\.\.\.)$/)
      await composer.click()
      await expect(composer).toBeFocused()
    })
  })

  test('closes the first-run announcement with Escape', async () => {
    test.setTimeout(90_000)
    await withAgentHub(async ({ page }) => {
      await expect(page.locator('.wb-root')).toBeVisible({ timeout: 20_000 })
      const dialog = announcementDialog(page)
      await expect(dialog).toBeVisible({ timeout: 20_000 })
      await expect(dialog.getByRole('button', { name: /^(关闭公告|Close announcement)$/ })).toBeFocused()

      await page.keyboard.press('Escape')

      await expect(dialog).toBeHidden({ timeout: 5_000 })
      await expect(primaryNavigation(page)).toBeVisible()
    })
  })

  test('switches language and keeps navigation reachable at 200% zoom', async () => {
    test.setTimeout(120_000)
    await withAgentHub(async ({ app, page }) => {
      await expect(page.locator('.wb-root')).toBeVisible({ timeout: 20_000 })
      await dismissAnnouncement(page)

      await primaryNavigation(page).getByRole('button', { name: '设置', exact: true }).click()
      const settings = page.locator('.wb-settings-shell')
      await expect(settings).toBeVisible({ timeout: 10_000 })
      await settings.locator('.wb-settings-nav').getByRole('button', { name: '外观', exact: true }).click()

      const languageRow = settings.locator('.wb-appearance-row').filter({ hasText: '界面语言' })
      await languageRow.getByRole('button', { name: 'English', exact: true }).click()

      const englishNavigation = page.getByRole('navigation', { name: 'Primary navigation', exact: true })
      await expect(englishNavigation).toBeVisible()
      await englishNavigation.getByRole('button', { name: 'Settings', exact: true }).click()
      const englishSettings = page.locator('.wb-settings-shell')
      await expect(englishSettings).toBeVisible({ timeout: 10_000 })
      await englishSettings.locator('.wb-settings-nav').getByRole('button', { name: 'Appearance', exact: true }).click()
      await expect(englishSettings.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible()
      await expect(englishSettings.getByRole('button', { name: 'Back to chat', exact: true })).toBeVisible()

      await app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents
        if (!contents) throw new Error('Missing AgentHub BrowserWindow')
        contents.setZoomFactor(2)
      })

      await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents
        if (!contents) throw new Error('Missing AgentHub BrowserWindow')
        return contents.getZoomFactor()
      }), { timeout: 10_000 }).toBe(2)
      await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents
        if (!contents) throw new Error('Missing AgentHub BrowserWindow')
        return Number(await contents.executeJavaScript('window.innerWidth', true))
      }), { timeout: 10_000 }).toBeLessThanOrEqual(820)

      const sidebar = page.getByRole('complementary', { name: 'Workbench navigation', exact: true })
      await expect(sidebar).toBeVisible()
      const personalChat = sidebar.getByRole('button', { name: 'Personal chat', exact: true })
      await personalChat.scrollIntoViewIfNeeded()
      await expect(personalChat).toBeVisible()
      await personalChat.click()
    })
  })

  test('blocks a local top-level navigation attempt', async () => {
    test.setTimeout(90_000)
    const navigationDir = mkdtempSync(join(tmpdir(), 'agenthub-e2e-nav-'))
    const navigationTarget = join(navigationDir, 'blocked.html')
    writeFileSync(navigationTarget, '<!doctype html><title>blocked</title><main>blocked</main>', 'utf-8')
    const navigationUrl = pathToFileURL(navigationTarget).href
    await withAgentHub(async ({ app, page }) => {
      try {
        await expect(page.locator('.wb-root')).toBeVisible({ timeout: 20_000 })
        await dismissAnnouncementIfPresent(page)
        const initialUrl = page.url()
        expect(initialUrl.startsWith('file:')).toBe(true)

        await app.evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents
          if (!contents) throw new Error('Missing AgentHub BrowserWindow')
          const probedContents = contents as typeof contents & { __agentHubE2ENavigationProbe?: NavigationProbe }
          probedContents.__agentHubE2ENavigationProbe = undefined
          contents.once('will-navigate', details => {
            probedContents.__agentHubE2ENavigationProbe = {
              url: details.url,
              isMainFrame: details.isMainFrame,
              defaultPrevented: details.defaultPrevented
            }
          })
        })

        await page.evaluate(url => window.location.assign(url), navigationUrl)

        await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents
          if (!contents) throw new Error('Missing AgentHub BrowserWindow')
          const probedContents = contents as typeof contents & { __agentHubE2ENavigationProbe?: NavigationProbe }
          return probedContents.__agentHubE2ENavigationProbe ?? null
        }), {
          timeout: 10_000,
          message: 'local file navigation did not emit a preventable will-navigate event'
        }).toEqual({
          url: navigationUrl,
          isMainFrame: true,
          defaultPrevented: true
        })
        await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents
          if (!contents) throw new Error('Missing AgentHub BrowserWindow')
          return contents.getURL()
        }), { timeout: 10_000 }).toBe(initialUrl)
        await expect.poll(() => app.evaluate(async ({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0]?.webContents
          if (!contents) throw new Error('Missing AgentHub BrowserWindow')
          return Boolean(await contents.executeJavaScript('!!document.querySelector(".wb-root")', true))
        }), { timeout: 10_000 }).toBe(true)
      } finally {
        rmSync(navigationDir, { recursive: true, force: true })
      }
    })
  })
})
