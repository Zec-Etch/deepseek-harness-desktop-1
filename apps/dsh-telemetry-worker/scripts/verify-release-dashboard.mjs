import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import worker from '../src/index.mjs'
import { createSession, sessionCookie } from '../src/admin-auth.mjs'

const db = new DatabaseSync(':memory:')
for (const file of (await readdir(new URL('../migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort()) db.exec(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'))
const today = new Date().toISOString().slice(0, 10)
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
db.prepare("INSERT INTO product_measurement_coverage VALUES ('release-observations', ?)").run(today)
db.prepare("INSERT INTO product_release_daily VALUES (?, ?, '3.3.0', 'feature_attachment', 'succeeded', 'file', 3)").run(today, 'a'.repeat(64))
db.prepare("INSERT INTO product_release_daily VALUES (?, ?, '3.3.0', 'app_launch', 'started', 'normal', 1)").run(today, 'a'.repeat(64))
db.prepare("INSERT INTO product_release_daily VALUES (?, ?, '4.0.0-rc.2', 'app_launch', 'started', 'normal', 1)").run(today, 'f'.repeat(64))
const releaseFeatureRows = [
  ['runtime_start_result', 'ready', 'pipe', '15-60s', 7],
  ['feature_agent_team', 'succeeded', 'enable', 'none', 5],
  ['feature_agent_team', 'failed', 'enable', 'none', 1],
  ['feature_local_lan', 'succeeded', 'enable', 'none', 4],
  ['feature_local_lan', 'failed', 'enable', 'none', 1],
  ['feature_local_lan', 'cancelled', 'enable', 'none', 2],
].map(([event, outcome, detail, bucket, count]) => ({
  event, app_version: '4.0.0-rc.2', channel: 'prerelease', os_family: 'windows-11', language: 'zh',
  outcome, detail, bucket, model: '', error_type: '', country_code: 'CN', source: '', position: '', strategy: '', count, sample_interval: 1,
}))
db.prepare('INSERT INTO analytics_daily (day, snapshot_at, data) VALUES (?, ?, ?)').run(today, new Date().toISOString(), JSON.stringify(releaseFeatureRows))
for (const [offset, actor] of [[-31, 'b'], [-8, 'c'], [-1, 'd'], [0, 'd'], [0, 'e']]) {
  db.prepare('INSERT INTO product_installation_daily (day, installation_actor) VALUES (?, ?)').run(day(offset), actor.repeat(64))
}
for (const [offset, actor] of [[-31, 'b'], [-8, 'c'], [-1, 'd'], [0, 'e']]) {
  db.prepare('INSERT INTO product_installation_first_seen (installation_actor, first_seen_day, first_version) VALUES (?, ?, ?)').run(actor.repeat(64), day(offset), '3.5.0')
}
const env = { ADMIN_PASSWORD_SHA256: 'a'.repeat(43), ADMIN_SESSION_SECRET: 'b'.repeat(43), METRICS: {
  prepare(sql) { let values = []; const s = { bind(...args) { values = args; return s }, async all() { return { results: db.prepare(sql).all(...values) } } }; return s },
} }
const cookie = sessionCookie(await createSession(env)).split(';')[0]
let failRelease = false
const server = createServer(async (req, res) => {
  try {
    if (failRelease && req.url.startsWith('/admin/api/release')) { res.writeHead(503); res.end(); return }
    const request = new Request('https://test.invalid' + req.url, { headers: { cookie } })
    const response = await worker.fetch(request, env)
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
  } catch { res.writeHead(500); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
let browser
try {
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:' + server.address().port + '/admin')
  await page.waitForFunction(() => document.querySelector('#release-export')?.disabled === false)
  await page.waitForFunction(() => document.querySelector('#metric-dau')?.textContent === '2')
  assert.match(await page.locator('#metric-mau-context').innerText(), /此前 30 日/)
  assert.match(await page.locator('#metric-active-coverage').innerText(), /共 32 天/)
  assert.ok(await page.locator('#active-dau-chart .trend-line').count() > 0)
  assert.ok(await page.locator('#active-mau-chart .trend-line').count() > 0)
  assert.match(await page.locator('#release-rows').innerText(), /普通文件添加/)
  assert.equal(await page.locator('#release-pipe-ready').innerText(), '7')
  assert.equal(await page.locator('#release-agent-team-enabled').innerText(), '5')
  assert.match(await page.locator('#release-agent-team-context').innerText(), /83\.3%/)
  assert.equal(await page.locator('#release-local-lan-enabled').innerText(), '4')
  assert.match(await page.locator('#release-local-lan-context').innerText(), /取消 2/)
  await page.selectOption('#release-version', '4.0.0-rc.2')
  await page.waitForFunction(() => document.querySelector('#release-export')?.disabled === false)
  assert.match(await page.locator('#release-rows').innerText(), /Agent Team/)
  const downloading = page.waitForEvent('download'); await page.click('#release-export'); const download = await downloading
  assert.match(download.suggestedFilename(), /4\.0\.0-rc\.2/)
  const csv = await readFile(await download.path(), 'utf8'); assert.match(csv, /feature_agent_team/); assert.doesNotMatch(csv, /aaaa|installation_actor/)
  await mkdir(new URL('../../../.tmp/analytics-qa/', import.meta.url), { recursive: true })
  await page.screenshot({ path: new URL('../../../.tmp/analytics-qa/release-dashboard.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true })
  await page.setViewportSize({ width: 720, height: 1000 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: new URL('../../../.tmp/analytics-qa/release-dashboard-narrow.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true })
  failRelease = true; await page.selectOption('#release-days', '7')
  await page.waitForFunction(() => document.querySelector('#release-coverage').textContent.includes('加载失败'))
  assert.equal(await page.locator('#release-active').innerText(), '--')
  assert.equal(await page.locator('#release-export').isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log('PASS release dashboard: exact DAU/WAU/MAU, 4.0 feature health, rolling trends, authenticated SQL, version filter, CSV, narrow layout, failure state; local fixtures only')
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); db.close() }
