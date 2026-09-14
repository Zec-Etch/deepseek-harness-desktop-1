import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { resolveNsisCompiler } from './nsis-compiler.mjs'

const exec = promisify(execFile)
const desktop = resolve(import.meta.dirname, '..')
if (process.platform !== 'win32') throw new Error('Installer identity migration verification requires Windows')
const compiler = await resolveNsisCompiler()
const root = await mkdtemp(join(tmpdir(), 'dsh-installer-identity-'))

async function registryExists(key) {
  try {
    await exec('reg.exe', ['QUERY', `HKCU\\${key}`], { windowsHide: true })
    return true
  } catch {
    return false
  }
}

try {
  for (const owned of [true, false]) {
    const label = owned ? 'owned-legacy' : 'foreign-legacy'
    const directory = join(root, label)
    const legacyInstall = join(directory, 'legacy-install')
    const freshInstall = join(directory, 'fresh-install')
    const installer = join(directory, 'fixture.exe')
    const registry = `Software\\DeepSeekHarnessDesktopTests\\identity-${process.pid}-${label}`
    await mkdir(join(legacyInstall, 'resources'), { recursive: true })
    await mkdir(freshInstall, { recursive: true })
    await writeFile(join(legacyInstall, 'DeepSeek Harness Desktop.exe'), 'legacy executable')
    if (owned) {
      await writeFile(join(legacyInstall, 'resources', 'update-shutdown-v1'), 'dsh-desktop-update-shutdown-protocol=1\n')
    }
    await exec('reg.exe', ['ADD', `HKCU\\${registry}\\LegacyInstall`, '/v', 'InstallLocation', '/t', 'REG_SZ', '/d', legacyInstall, '/f'], { windowsHide: true })
    await exec('reg.exe', ['ADD', `HKCU\\${registry}\\LegacyUninstall`, '/v', 'DisplayVersion', '/t', 'REG_SZ', '/d', '3.5.0', '/f'], { windowsHide: true })
    try {
      await exec(compiler.path, [
        '/V2', `/DBUILD_RESOURCES_DIR=${join(desktop, 'build')}`,
        `/DTEST_OUTPUT=${installer}`, `/DTEST_FRESH_INSTALL=${freshInstall}`,
        `/DTEST_REGISTRY=${registry}`,
        join(desktop, 'test', 'fixtures', 'installer-identity-migration.nsi'),
      ], { windowsHide: true, timeout: 30_000, env: compiler.env })
      await exec(installer, ['/S'], { windowsHide: true, timeout: 30_000 })
      const selected = owned ? legacyInstall : freshInstall
      assert.equal(await readFile(join(selected, 'selected-install.txt'), 'utf8'), selected)
      await assert.rejects(stat(join(owned ? freshInstall : legacyInstall, 'selected-install.txt')), { code: 'ENOENT' })
      assert.equal(await registryExists(`${registry}\\CurrentInstall`), true)
      assert.equal(await registryExists(`${registry}\\LegacyInstall`), !owned)
      assert.equal(await registryExists(`${registry}\\LegacyUninstall`), !owned)
      console.log(`PASS installer identity ${label}: selected=${selected}`)
    } finally {
      await exec('reg.exe', ['DELETE', `HKCU\\${registry}`, '/f'], { windowsHide: true }).catch(() => {})
    }
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
