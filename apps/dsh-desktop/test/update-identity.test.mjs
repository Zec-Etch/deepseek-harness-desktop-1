import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { assertPackagedUpdateIdentity, assertUpdateIdentity } from '../src/update-identity.mjs'

test('update identity accepts only the community GitHub release feed', () => {
  assert.deepEqual(assertUpdateIdentity({
    provider: 'github',
    owner: 'ningbainb',
    repo: 'deepseek-harness-desktop',
  }), {
    provider: 'github',
    owner: 'ningbainb',
    repo: 'deepseek-harness-desktop',
  })
  assert.throws(() => assertUpdateIdentity({
    provider: 'generic',
    owner: 'deepseek-ai',
    repo: 'deepseek-harness',
  }), /unexpected provider/u)
  assert.throws(() => assertUpdateIdentity({
    provider: 'github',
    owner: 'deepseek-ai',
    repo: 'deepseek-harness',
  }), /unexpected owner/u)
})

test('packaged update metadata is parsed and checked before updater activation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-update-identity-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'app-update.yml')
  await writeFile(path, 'provider: github\nowner: ningbainb\nrepo: deepseek-harness-desktop\n')
  assert.equal((await assertPackagedUpdateIdentity(path)).repo, 'deepseek-harness-desktop')
  await writeFile(path, 'provider: generic\nurl: https://download.deepseek.com/\n')
  await assert.rejects(assertPackagedUpdateIdentity(path), /unexpected provider/u)
})
