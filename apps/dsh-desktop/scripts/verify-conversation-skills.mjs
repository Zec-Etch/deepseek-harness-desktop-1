import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import electronPath from 'electron'
import { _electron as electron } from 'playwright'

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const screenshotArgument = process.argv.find((argument) => argument.toLowerCase().endsWith('.png'))
const screenshot = screenshotArgument ? resolve(screenshotArgument) : undefined
const packagedExecutable = process.env.DSH_DESKTOP_E2E_EXECUTABLE
const runtimeReadyTimeoutMs = packagedExecutable ? 120_000 : 60_000
const temporary = await mkdtemp(resolve(tmpdir(), 'dsh-conversation-skills-e2e-'))
let electronApp

try {
  electronApp = await electron.launch({
    executablePath: packagedExecutable || electronPath,
    args: packagedExecutable ? [] : [resolve(appDir, 'src', 'main.mjs')],
    cwd: appDir,
    env: {
      ...process.env,
      DSH_DESKTOP_DISABLE_UPDATES: '1',
      DSH_DESKTOP_USER_DATA: resolve(temporary, 'user-data'),
      DSH_HOME: resolve(temporary, 'dsh-home'),
    },
  })
  const page = await electronApp.firstWindow()
  try {
    await page.waitForURL(/^dsh-runtime:\/\/app\//u, { timeout: runtimeReadyTimeoutMs })
  } catch (error) {
    const runtimeLog = await readFile(resolve(temporary, 'user-data', 'logs', 'runtime.log'), 'utf8').catch(() => '')
    console.error(runtimeLog.slice(-4_000))
    throw error
  }
  await page.setViewportSize({ width: 1280, height: 800 })
  const continueButton = page.getByRole('button', { name: '继续', exact: true })
  await continueButton.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {})
  if (await continueButton.isVisible().catch(() => false)) await continueButton.click()
  const commandButton = page.getByRole('button', { name: '命令' })
  const skillsButton = page.getByRole('button', { name: '技能库' })
  await skillsButton.waitFor({ state: 'visible' })
  const [commandBounds, skillsBounds] = await Promise.all([commandButton.boundingBox(), skillsButton.boundingBox()])
  assert.ok(commandBounds && skillsBounds)
  assert.ok(skillsBounds.x > commandBounds.x)
  assert.ok(Math.abs(skillsBounds.y - commandBounds.y) <= 1)
  assert.ok(Math.abs(skillsBounds.height - commandBounds.height) <= 1)

  await skillsButton.hover()
  await page.getByRole('tooltip', { name: '技能库' }).waitFor({ state: 'visible' })
  await skillsButton.click()
  assert.equal(await skillsButton.getAttribute('aria-expanded'), 'true')
  const menu = page.getByRole('dialog', { name: '技能库' })
  const listbox = page.getByRole('listbox', { name: '已安装技能' })
  await menu.waitFor({ state: 'visible' })
  await listbox.getByRole('option').first().waitFor({ state: 'visible', timeout: 20_000 })
  const [menuBounds, openSkillsBounds] = await Promise.all([menu.boundingBox(), skillsButton.boundingBox()])
  assert.ok(menuBounds && openSkillsBounds)
  assert.ok(menuBounds.height <= 321, JSON.stringify(menuBounds))
  assert.ok(menuBounds.y + menuBounds.height <= openSkillsBounds.y)

  const firstName = (await listbox.getByRole('option').first().locator('strong').textContent())?.trim()
  assert.ok(firstName)
  const search = page.getByRole('searchbox', { name: '搜索技能' })
  await search.fill(firstName)
  assert.ok(await listbox.getByRole('option').count() >= 1)
  await page.keyboard.press('Escape')
  assert.equal(await skillsButton.getAttribute('aria-expanded'), 'false')
  await menu.waitFor({ state: 'hidden' })

  await skillsButton.click()
  await search.fill('')
  await page.keyboard.press('ArrowDown')
  assert.equal(await listbox.getByRole('option').nth(1).getAttribute('aria-selected'), 'true')
  await page.keyboard.press('Enter')
  await menu.waitFor({ state: 'hidden' })

  await skillsButton.click()
  // Dispatch the underlying navigation click intentionally while the modal
  // layer is open; this verifies that a real page transition closes it.
  await page.getByText('探索未至之境', { exact: true }).click({ force: true })
  await menu.waitFor({ state: 'hidden' })
  if (screenshot) {
    await page.locator('#dsh-desktop-skills-toast').waitFor({ state: 'detached', timeout: 4_000 }).catch(() => {})
    await skillsButton.click()
    await menu.waitFor({ state: 'visible' })
    await page.screenshot({ path: screenshot })
  }
  console.log(`verified conversation Skills menu at ${page.url()}`)
} finally {
  await electronApp?.close()
  await rm(temporary, { recursive: true, force: true })
}
