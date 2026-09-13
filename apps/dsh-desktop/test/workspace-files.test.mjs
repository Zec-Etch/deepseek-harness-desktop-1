import assert from 'node:assert/strict'
import test from 'node:test'

import { DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_HEADER } from '@linxin666/dsh-desktop-compat/workspace-file-open-policy'
import {
  isSafeWorkspaceFileOpenTarget,
  normalizeWorkspaceFileOpenRequest,
  openWorkspaceFile,
  resolveWorkspaceFileOpenTarget,
} from '../src/workspace-files.mjs'

const CAPABILITY_TOKEN = 'a'.repeat(43)

test('workspace file requests reject absolute paths, traversal, and shell-dispatched file types before host validation', () => {
  assert.deepEqual(normalizeWorkspaceFileOpenRequest({ root: 'C:\\work', path: 'src/main.ts' }), {
    root: 'C:\\work',
    path: 'src/main.ts',
  })
  for (const path of ['../secret.txt', '/etc/passwd', 'C:/Windows/system.ini', 'dir//file.txt']) {
    assert.throws(() => normalizeWorkspaceFileOpenRequest({ root: 'C:\\work', path }), /relative path/u)
  }
  for (const path of ['payload.cmd', 'payload.ps1', 'payload.lnk', 'payload.exe', 'safe.txt:payload.cmd']) {
    assert.throws(() => normalizeWorkspaceFileOpenRequest({ root: 'C:\\work', path }), /not allowed|relative path/u)
  }
})

test('Desktop native targets use an allowlist and never accept URLs or Windows ADS', () => {
  for (const path of ['C:\\work\\README.md', 'C:\\work\\image.PNG', '/work/report.pdf', '\\\\server\\share\\recording.mp4']) {
    assert.equal(isSafeWorkspaceFileOpenTarget(path), true)
  }
  for (const path of [
    'C:\\work\\payload.cmd',
    'C:\\work\\payload.ps1',
    'C:\\work\\payload.lnk',
    'C:\\work\\payload.exe',
    'C:\\work\\payload.cmd.',
    'C:\\work\\safe.txt:payload.cmd',
    'https://example.test/payload.pdf',
    'file:///C:/work/payload.pdf',
  ]) {
    assert.equal(isSafeWorkspaceFileOpenTarget(path), false)
  }
})

test('Desktop resolves native opening only through the active loopback workspace authority', async () => {
  const calls = []
  const target = await resolveWorkspaceFileOpenTarget({
    request: { root: 'C:\\work', path: 'reports/result.md' },
    getRuntimeOrigin: () => 'http://127.0.0.1:43125/',
    getWorkspaceFileOpenToken: () => CAPABILITY_TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true, value: { path: 'C:\\work\\reports\\result.md' } }), { status: 200 })
    },
  })
  assert.equal(target, 'C:\\work\\reports\\result.md')
  assert.equal(calls[0].url, 'http://127.0.0.1:43125/desktop/workspace-file-open-target')
  assert.deepEqual(JSON.parse(calls[0].init.body), { root: 'C:\\work', path: 'reports/result.md' })
  assert.equal(calls[0].init.headers[DESKTOP_WORKSPACE_FILE_OPEN_TOKEN_HEADER], CAPABILITY_TOKEN)
})

test('Desktop resolves native opening through the authenticated pipe carrier', async () => {
  const calls = []
  const target = await resolveWorkspaceFileOpenTarget({
    request: { root: 'C:\\work', path: 'README.md' },
    getRuntimeOrigin: () => 'dsh-runtime://app',
    getWorkspaceFileOpenToken: () => CAPABILITY_TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true, value: { path: 'C:\\work\\README.md' } }), { status: 200 })
    },
  })
  assert.equal(target, 'C:\\work\\README.md')
  assert.equal(calls[0].url, 'dsh-runtime://app/desktop/workspace-file-open-target')
})

test('Desktop does not contact the Host without its private current-runtime capability', async () => {
  await assert.rejects(
    resolveWorkspaceFileOpenTarget({
      request: { root: 'C:\\work', path: 'README.md' },
      getRuntimeOrigin: () => 'http://127.0.0.1:43125/',
      getWorkspaceFileOpenToken: () => undefined,
      fetchImpl: async () => { throw new Error('must not fetch') },
    }),
    /capability is unavailable/u,
  )
})

test('Desktop invokes Shell only after the workspace host authorizes a concrete target', async () => {
  const paths = []
  const result = await openWorkspaceFile({
    shell: { openPath: async (path) => { paths.push(path); return '' } },
    request: { root: 'C:\\work', path: 'README.md' },
    getRuntimeOrigin: () => 'http://127.0.0.1:43125/',
    getWorkspaceFileOpenToken: () => CAPABILITY_TOKEN,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { path: 'C:\\work\\README.md' } }), { status: 200 }),
  })
  assert.deepEqual(result, { opened: true })
  assert.deepEqual(paths, ['C:\\work\\README.md'])
})

test('Desktop never forwards a dangerous host response to Shell', async () => {
  const opened = []
  for (const path of ['payload.cmd', 'payload.ps1', 'payload.lnk', 'payload.exe']) {
    await assert.rejects(
      openWorkspaceFile({
        shell: { openPath: async (target) => { opened.push(target); return '' } },
        request: { root: 'C:\\work', path: 'README.md' },
        getRuntimeOrigin: () => 'http://127.0.0.1:43125/',
        getWorkspaceFileOpenToken: () => CAPABILITY_TOKEN,
        fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { path: `C:\\work\\${path}` } }), { status: 200 }),
      }),
      /invalid target/u,
    )
  }
  assert.deepEqual(opened, [])
})

test('non-loopback runtime origins cannot authorize external file opening', async () => {
  await assert.rejects(
    resolveWorkspaceFileOpenTarget({
      request: { root: 'C:\\work', path: 'README.md' },
      getRuntimeOrigin: () => 'https://example.test/',
      getWorkspaceFileOpenToken: () => CAPABILITY_TOKEN,
      fetchImpl: async () => { throw new Error('must not fetch') },
    }),
    /not ready/u,
  )
})
