import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  classifyLegacyHome,
  CommunityHomeMigration,
  COMMUNITY_HOME_MARKER,
} from '../src/community-home-migration.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'community-home-migration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return {
    root,
    source: join(root, 'legacy', '.dsh'),
    target: join(root, 'current', 'community-home'),
    journal: join(root, 'current', 'migration-v4.json'),
  }
}

async function writeCommunitySource(source) {
  await mkdir(join(source, 'profiles', 'desktop', 'node_modules', 'ignored'), { recursive: true })
  await mkdir(join(source, 'sessions'), { recursive: true })
  await mkdir(join(source, 'profiles', 'desktop', 'state', 'task-board'), { recursive: true })
  await writeFile(join(source, 'profiles', 'desktop', 'package.json'), JSON.stringify({
    dependencies: { '@linxin666/dsh-web-ui-all': '0.2.5' },
  }))
  await writeFile(join(source, 'profiles', 'desktop', 'pnpm-lock.yaml'), 'ignored')
  await writeFile(join(source, 'profiles', 'desktop', 'cordis.patch.yml'), '- name: "@linxin666/dsh-web-ui-all"\n')
  await writeFile(join(source, 'profiles', 'desktop', 'node_modules', 'ignored', 'index.js'), 'ignored')
  await writeFile(join(source, 'sessions', 'one.jsonl'), '{"type":"session"}\n')
  await writeFile(join(source, 'profiles', 'desktop', 'state', 'task-board', 'tasks-v3.json'), JSON.stringify({
    schemaVersion: 3,
    revision: 1,
    updatedAt: 1,
    projects: [],
    tasks: [{ id: 'scheduled-task', schedule: { enabled: true, cron: '0 9 * * *', lease: { ownerId: 'old' } } }],
    evidences: [],
  }))
}

test('migration classifies only evidenced community ownership for automatic import', async (t) => {
  const { root, source } = await fixture(t)
  assert.equal(await classifyLegacyHome(source), 'absent')
  await writeCommunitySource(source)
  assert.equal(await classifyLegacyHome(source), 'legacy-community')
  await writeFile(join(source, '.official-install'), '')
  assert.equal(await classifyLegacyHome(source), 'mixed')
  await rm(source, { recursive: true, force: true })
  await mkdir(join(root, 'official', 'profiles', 'web'), { recursive: true })
  assert.equal(await classifyLegacyHome(join(root, 'official')), 'official')
})

test('migration commits only after package rebuild and Runtime health, while retaining source', async (t) => {
  const { source, target, journal } = await fixture(t)
  await writeCommunitySource(source)
  const migration = new CommunityHomeMigration({
    sourceHome: source,
    targetHome: target,
    journalPath: journal,
    desktopVersion: '4.0.0',
  })
  const result = await migration.prepare()

  assert.deepEqual(result, {
    state: 'TARGET_PREPARED',
    transactionId: result.transactionId,
    migrated: true,
    classification: 'legacy-community',
    sourceRetained: true,
    manualRecoveryRequired: false,
    usable: true,
  })
  assert.equal((await readFile(join(target, 'sessions', 'one.jsonl'), 'utf8')).includes('session'), true)
  assert.equal((await readFile(join(target, 'profiles', 'desktop', 'cordis.patch.yml'), 'utf8')).includes('@linxin666/dsh-web-ui-all'), true)
  await assert.rejects(stat(join(target, 'profiles', 'desktop', 'package.json')), { code: 'ENOENT' })
  await assert.rejects(stat(join(target, 'profiles', 'desktop', 'node_modules')), { code: 'ENOENT' })
  assert.equal((await readFile(join(source, 'sessions', 'one.jsonl'), 'utf8')).includes('session'), true)
  const migratedTasks = JSON.parse(await readFile(join(target, 'profiles', 'desktop', 'state', 'task-board', 'tasks-v3.json'), 'utf8'))
  assert.equal(migratedTasks.tasks[0].schedule.enabled, false)
  assert.equal('lease' in migratedTasks.tasks[0].schedule, false)
  const takeover = JSON.parse(await readFile(join(target, 'community', 'migrations', `automation-takeover-${result.transactionId}.json`), 'utf8'))
  assert.equal(takeover.state, 'confirmation-required')
  assert.equal(takeover.schedules[0].taskId, 'scheduled-task')
  assert.equal(JSON.parse(await readFile(join(target, COMMUNITY_HOME_MARKER), 'utf8')).health, 'pending')
  const resumed = await migration.prepare()
  assert.equal(resumed.resumed, true)
  assert.equal(resumed.transactionId, result.transactionId)
  await migration.markPackagesValidated(result.transactionId)
  await migration.commitHealthy(result.transactionId)
  assert.equal(JSON.parse(await readFile(join(target, COMMUNITY_HOME_MARKER), 'utf8')).health, 'verified')
  const states = JSON.parse(await readFile(journal, 'utf8')).history.map((entry) => entry.state)
  assert.deepEqual(states, [
    'DISCOVERED', 'PREFLIGHT_OK', 'SOURCE_QUIESCENT', 'SNAPSHOT_READY',
    'INTENT_EXTRACTED', 'TARGET_PREPARED', 'PACKAGES_VALIDATED',
    'DATA_VALIDATED', 'TARGET_HEALTHY', 'COMMITTED', 'CLEANUP_PENDING',
  ])
  assert.equal((await migration.prepare()).migrated, false)
})

test('migration isolates unknown sources and refuses a pre-existing unowned target', async (t) => {
  const { root, source, target, journal } = await fixture(t)
  await mkdir(source, { recursive: true })
  const unknown = new CommunityHomeMigration({ sourceHome: source, targetHome: target, journalPath: journal, desktopVersion: '4.0.0' })
  const isolated = await unknown.prepare()
  assert.equal(isolated.state, 'TARGET_PREPARED')
  assert.equal(isolated.manualRecoveryRequired, true)
  assert.equal(isolated.usable, true)

  await rm(target, { recursive: true, force: true })
  await rm(source, { recursive: true, force: true })
  await writeCommunitySource(source)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'foreign.txt'), 'do not overwrite')
  const occupied = new CommunityHomeMigration({
    sourceHome: source,
    targetHome: target,
    journalPath: join(root, 'occupied-journal.json'),
    desktopVersion: '4.0.0',
  })
  const result = await occupied.run()
  assert.equal(result.state, 'MANUAL_RECOVERY_REQUIRED')
  assert.equal(await readFile(join(target, 'foreign.txt'), 'utf8'), 'do not overwrite')
})

for (const legacyDesktopVersion of ['3.3.0', '3.4.0', '3.5.0']) {
  test(`migration preserves 3.x user data from ${legacyDesktopVersion}`, async (t) => {
    const { source, target, journal } = await fixture(t)
    await writeCommunitySource(source)
    await mkdir(join(source, 'memory'), { recursive: true })
    await mkdir(join(source, 'prompts'), { recursive: true })
    await writeFile(join(source, 'memory', 'facts.json'), JSON.stringify({ legacyDesktopVersion, fact: 'retained' }))
    await writeFile(join(source, 'prompts', 'personal.md'), `legacy=${legacyDesktopVersion}\n`)
    await writeFile(join(source, COMMUNITY_HOME_MARKER), JSON.stringify({
      schemaVersion: 1,
      owner: 'deepseek-harness-community',
      desktopVersion: legacyDesktopVersion,
    }))

    const migration = new CommunityHomeMigration({
      sourceHome: source,
      targetHome: target,
      journalPath: journal,
      desktopVersion: '4.0.0-rc.1',
    })
    const prepared = await migration.prepare()
    await migration.markPackagesValidated(prepared.transactionId)
    await migration.commitHealthy(prepared.transactionId)

    assert.equal(JSON.parse(await readFile(join(target, 'memory', 'facts.json'), 'utf8')).legacyDesktopVersion, legacyDesktopVersion)
    assert.equal(await readFile(join(target, 'prompts', 'personal.md'), 'utf8'), `legacy=${legacyDesktopVersion}\n`)
    assert.equal((await readFile(join(target, 'sessions', 'one.jsonl'), 'utf8')).includes('session'), true)
    assert.equal((await readFile(join(source, 'sessions', 'one.jsonl'), 'utf8')).includes('session'), true)
    assert.equal(JSON.parse(await readFile(join(target, COMMUNITY_HOME_MARKER), 'utf8')).health, 'verified')
  })
}

test('rollback removes only the pending target owned by the transaction', async (t) => {
  const { source, target, journal } = await fixture(t)
  await writeCommunitySource(source)
  const migration = new CommunityHomeMigration({ sourceHome: source, targetHome: target, journalPath: journal, desktopVersion: '4.0.0' })
  const prepared = await migration.prepare()
  await migration.rollback(prepared.transactionId, 'test-failure')
  await assert.rejects(stat(target), { code: 'ENOENT' })
  assert.equal((await readFile(join(source, 'sessions', 'one.jsonl'), 'utf8')).includes('session'), true)
  await assert.rejects(migration.rollback(prepared.transactionId), /does not own/u)
})
